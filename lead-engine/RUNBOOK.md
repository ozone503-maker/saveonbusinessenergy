# SOBE Lead Engine — runbook v3 (draft)

Brain: Muse tokens. This Muse does the hunting, on a schedule.
Vercel only hosts the hidden dashboard (`leads.html`) and the Postgres
database. This project is Jessie + Muse only. No outside bots.
Crew: see `CREW.md`. Campaigns: see `CAMPAIGNS.md`.

## Cadence (not decided yet — Jessie to pick)

The brief leaves these open. Draft proposals, not decisions:

- Lead runs: weekday mornings (Muse runs)
  — but 200/day is the goal, so if one morning run lands short, run
  again later in the day or lean on uploads + Scout finds. Cadence to
  hit 200/day is still Jessie's pick (see "Open questions" in README).
- Batch: NO fixed per-run batch any more. The goal is the day: minimum
  200 NEW addresses (deduped contacts with a real email) per day,
  from hunting + uploads + Scout finds combined. A run that finds 25
  good leads is fine; it is not the day's target on its own.
- Megablast: weekly (day TBD — Jessie to pick).
- Report: back to Jessie in chat after every run. Gavin sees the list on
  the dashboard; whether he also gets the chat report is still TBD.

Do not lock a cron until Jessie picks the cadence and batch size.

## One run, in order

### 0. Preconditions (fail the run loudly if any is missing)

- Postgres is live and the nine tables exist (`schema.sql` applied).
- The Muse schedule (cron) can reach the database — connection string
  from the same Vercel env vars, server-side only.
- No run is already in progress.

### 0. Read the current agents first — they live in the database

```sql
SELECT a.name, a.role, a.current_version, v.instructions
FROM agents a JOIN agent_versions v ON v.id = a.current_version_id;
```

The agents are NOT the code in this repo and NOT the text in CREW.md
alone — the current version of each agent in `agents` /
`agent_versions` is the instruction set this run uses. If the
Maintenance Bot rebuilt an agent since the last run (see step 1),
this run uses the rebuilt version. If the table is empty (fresh
database), seed it from CREW.md roles first and note that in the report.

### 1. Read directions first — including reprogram directions

```sql
SELECT * FROM directions WHERE status = 'new' ORDER BY created_at ASC;
```

Directions override the default route order. If a direction says
"focus on cold storage in Houston this week", that is the run's focus.

**Maintenance Bot step (runs first, before the hunt).** A direction
that reprograms the crew — "stop doing X, start doing Y", "never use
that route again", "always tag cold-storage leads" — is applied
immediately, with no code deploy. There are two kinds:

(a) A short reprogram direction: restate it as a rule and write it to
`memory` as a `rule:*` row (and update the affected `route:*` row if
it retires a route). The instruction set lives in the database, so
the rest of this run already uses the new rule.

(b) A large pasted chunk (via the Reprogram box / `api/reprogram.js`,
from Jessie, Gavin, or another bot): parse it into role +
instructions, create a NEW `agent_versions` row (never overwrite
history), store the raw chunk verbatim as `source_text`, and point
the agent at the new version. A new agent name creates a new agent.
The rest of this run already uses the rebuilt version (see step 0).

If the reprogram conflicts with the brief (asks for outreach,
invented contacts, Austin / San Antonio, "broker" wording, savings
promises), decline that part with a reason — reprogramming cannot
override the brief. Mark the direction `done` with a `result_note`
saying what changed ("Rule added: never use route X again. Takes
effect next run." / "Hunter rebuilt to v4 from Jessie's paste.").

Ordinary directions that conflict with the brief are also declined,
never silently followed and never silently dropped:

- asks for outreach (email / call / DM to a prospect) → decline it.
- asks for an invented contact, or a contact without a source → decline it.
- asks for Austin or San Antonio → decline it (not deregulated).
- asks for anything that names Jessie / USA Energy Partners as a
  "broker", or promises savings → decline that wording.

### 2. Read memory — the agent does not start cold

```sql
SELECT * FROM memory ORDER BY created_at DESC;
```

Pay attention to:

- `rule:*` rows — standing rules (deregulated-only, no invented
  contacts, no outreach without a go), including any the Maintenance
  Bot just wrote in step 1.
- `route:*` rows — which routes worked and which flopped last time.
  Flopped routes go last, or are skipped for a run if the lesson says so.
- `do-not-repeat:<business>|<city>` rows — rejected leads. Never
  re-add one, even if a route surfaces it again.

### 3. Process the ingest queue — lists Jessie uploaded

Before hunting, check for uploads the Ingestor has not yet fully
processed (in v2 the dashboard upload imports synchronously via
`api/ingest.js`, so this step is usually a check, not a job — but a
failed / partial upload is re-checked here):

```sql
SELECT * FROM uploads WHERE status IN ('partial', 'failed') ORDER BY received_at DESC;
```

For each one, report the flagged rows to Jessie and ask whether to fix
or drop them. Flagged rows are never silently fixed or silently
imported. New contributors get a `contributors` row on first use, and
every ingested row keeps its `contributed_by` label.

### 4. Hunt — routes 1–3 first (Hunter)

1. ERCOT interconnection queue + data-center projects (biggest loads, public).
2. Texas permits — new commercial construction, expansions, change-of-use
   (TDLR, city permit portals).
3. Google Maps + TX Comptroller — energy-hungry categories: cold storage,
   manufacturing, hotels, hospitals, big-box retail, dealerships,
   laundromats, large restaurants.

Routes 4–7 only after the first three are working, and with a flag:

4. Apollo + LinkedIn — decision-maker once the business is identified.
   Needs accounts. Flag before using; do not log in anywhere without
   Jessie's go.
5. Industry associations + chambers of commerce (member lists).
6. Referral partners — CPAs, contractors, property managers.
7. Past the list: commercial real-estate listings (large sq ft = large
   load), TX franchise-tax records (revenue as size proxy), SEC filings
   for Texas operators, utility territory maps.

New routes the agent discovers get a `route:*` memory row and are named
in the run report.

### 4b. Scout — one or two new ideas, every run (Route Scout)

The Scout proposes 1–2 NEW creative ways to get leads and writes them
to `route_ideas` (status 'proposed'). The Orchestrator tries the best
one this run — a new list, a new public source, a new partnership —
and logs the result ('worked' / 'flopped') with the deduped new
address count. Even 20–30 new addresses counts: log it, count it
toward the 200, do not dismiss it. If today is tracking short of 200
(see step 9b), the Scout goes FIRST next run, before the Hunter.

### 5. Enrich — the person who pays the bill (Enricher)

For each hunted business (and each ingested lead with a business but no
contact), find the decision-maker + title + a way to reach them —
sourced only. If no contact can be sourced, the lead stays
`no-contact-yet`. Never guessed, never filled from a similar business.

### 6. Dedupe — before writing anything

For every candidate, check ALL THREE:

```sql
SELECT id FROM leads
 WHERE lower(btrim(business)) = lower(btrim($1))
   AND lower(btrim(city)) = lower(btrim($2));
SELECT key FROM memory WHERE key = 'do-not-repeat:' || $1 || '|' || $2;
SELECT id FROM contacts WHERE email = lower(btrim($3)); -- when an email is known
```

If any hits, skip it. Do not write a second row, do not "update" the
old one into a duplicate. A skip is not a failure — note it in the report
if a route keeps surfacing the same businesses (that is a signal the
route is exhausted).

### 7. Write the leads + contacts

Exact lead record — every field sourced, or left empty:

| Field | Rule |
|---|---|
| Business | Required. As the source names it. |
| City | Required. Deregulated areas only (below). |
| Decision-maker + title | Only if sourced. Leave blank if unknown. |
| Contact (email / phone) | Only if sourced. If none can be sourced, `contact_status = 'no-contact-yet'` — never guessed, never filled from a similar business. |
| Source (link) | Required, every lead. A real URL the claim can be checked against. For uploaded rows: 'referral upload: <contributor> — <filename>'. |
| Why now | Why this business is a fit right now (permit filed, expansion, new facility, contract timing — whatever the source actually says). |
| Route | Which route found it. |
| Date found | Today. |
| Contributor | `contributed_by` / `contributor_id` / `upload_id` when the row came from an upload. |

Insert with `status = 'new'`, `contact_status = 'sourced'` or
`'no-contact-yet'`. The database's `UNIQUE (business, city)` is the
backstop — an insert that collides is a bug in step 6, not a second lead.

Contacts: one row per email, lowercased, `source` set, `contributed_by`
set when from an upload, `consent_status = 'unknown'` for uploaded
lists (an uploaded list is NOT consent). A business with no email gets
no contact row.

Deregulated areas only: Houston, Dallas–Fort Worth, Corpus Christi.
Out: Austin, San Antonio. If a source is unclear about territory, check
before writing — do not write it and hope.

### 8. Draft a campaign if asked — Campaign Writer (only when directed)

A campaign is drafted only when Jessie/Gavin asked for one (direction,
or the weekly megablast slot) — the run does not invent campaign
occasions. News campaigns need the actual story (headline + source
link) before they are written. Pain-point campaigns start from a live
article (see `CAMPAIGNS.md`). Every campaign is saved as `draft`
in `campaigns`; the Blast Manager may build a blast preview from it,
but nothing is approved and nothing is sent by the run.

### 9. Update memory — what the run learned

Write at least one `memory` row per route tried:

- `key = 'route:<route>'`, `fact` = what happened (counts, what the
  source actually yielded), `outcome` = `worked` / `flopped` / `mixed`,
  `lesson` = what to do differently next time.

And one row per rejected lead seen this run (or per Jessie/Gavin
rejection since the last run):

- `key = 'do-not-repeat:<business>|<city>'`, `fact` = the real reason
  (e.g. "Rejected by Jessie: already a customer").

Use `INSERT ... ON CONFLICT (key) DO UPDATE` so a route's memory row is
kept current instead of piling up duplicates.

### 10. Close the directions

For every `new` direction read in step 1, set `status = 'done'` with a
`result_note` saying what was done ("Focused on Houston cold storage —
11 of the 25 leads are cold storage"; for a reprogram, what rule changed)
— or `declined` with the reason (see step 1). No direction stays `new`
after a run has read it.

### 9b. Count the day — vs 200 (Goal Tracker)

At the end of the run, refresh today's `daily_counts` row from the
real tables — counted, never guessed:

```sql
-- new_contacts: contacts added today (real email, deduped by design)
-- new_leads: leads found today
-- by_route / by_contributor: today's breakdowns, as JSONB
```

The math, plainly: 200/day does NOT come from the Hunter alone.
A realistic day is hunting (say 40–80) + an uploaded list (a single
contributor list can be 50–150) + Scout finds (20–30 per idea, and
they add up). If today lands short, say so in the report and lead
the next run with the Scout + the ingest queue — do not pretend a
25-lead run hit 200, and do not inflate the count with duplicates,
bad emails, or Austin / San Antonio rows (those were never imported).

### 11. Report back to Jessie (in chat, after every run)

- TODAY VS 200 FIRST: new addresses today (contacts, deduped, real
  email only) vs the 200 target, plus new leads, plus the breakdown
  (Hunter / uploads by contributor / Scout ideas).
- New leads this run (count + the list, or a link to the dashboard).
- Uploads processed: imported / duplicate / flagged, by contributor.
- Which directions were done / declined, and any reprogram that took effect.
- What's working, what's flopped, any new route found.
- Duplicates skipped, if a route is running dry.
- Campaigns drafted (if any) and blasts built (draft only — never sent).
- Nothing else. No outreach happened — say so plainly if it matters.

## Ask the lead agent — questions from Jessie / Gavin

Gavin (or Jessie) types a question in the "Ask the lead agent" box on
the dashboard and gets a fast answer from the real numbers — the Lead
Agent (`api/ask.js`, role in `CREW.md`). It answers from the database
only: total emails, emails/leads in any city, leads total, today vs
200, latest pain points, latest leads, unsubscribed count, who gave
us lists. Anything it can't answer gets a plain "I don't have that
from the list yet" plus what it CAN answer. It never invents a number,
never sends or approves anything — it only reads and reports. Every
question + answer is logged to the `questions` table. Until Postgres
is provisioned, Ask answers "The list isn't live yet — the database
isn't set up, so I have no numbers yet." That is by design.

## The no-outreach rule (absolute)

The agent finds and lists ONLY. No emails, calls, or DMs to prospects
without Jessie's explicit go — a go that names the lead, the message,
and the channel. Drafts (LinkedIn note, follow-up, cold email, posts)
are drafts only until he approves the exact text. The dashboard's
Approve button means "this lead is good", not "contact them". A blast
is a draft until Jessie approves it on the hidden page *and* confirms
the send — approval alone never sends anything.

Language in anything the agent writes, drafts included:

- Never call Jessie or USA Energy Partners a "broker".
- Never promise savings.
- Never present a generated image or claim as a real photo, farm, or product.

## Env vars the run needs

- `POSTGRES_URL` / `DATABASE_URL` — Postgres connection string.
- `RESEND_API_KEY` — blast sending only in v3 (already exists).
  No sign-in codes are sent any more.
- `TEX_FROM_EMAIL` — verified sender for blasts.
- Existing, unchanged: `SPEKO_API_KEY`, `TEX_LEAD_EMAIL`,
  `SPEKO_WEBHOOK_SECRET`.
- REMOVED in v2: `LEADS_PASSWORD` — there is no password any more.
- None of these go in the repo, in browser code, or in a chat message.

## What blocks a live push

1. **Auth** — REMOVED in v3: no login, no code, no session (Jessie's
   call). No auth env to set; do not re-add a gate.
2. **Postgres provisioning** — Vercel dashboard → Storage → create the
   Postgres database; `pg` package install (`npm i pg` — the repo has
   no `package.json` today); run `schema.sql` once.
3. **Resend sender** — `TEX_FROM_EMAIL` must be a verified Resend
   sender, or blasts will not arrive. (Codes are gone, so they are no
   longer a blocker.)
4. **Cadence to hit 200/day** — weekday mornings is a draft proposal,
   not a decision; 200/day needs hunting + uploads + Scout finds, and
   may need more than one run a day. Weekly megablast day TBD.
5. **Moving the drafts live** — copy `lead-engine/api/*.js` to `api/`,
   copy `lead-engine/leads.html` to the site root (or a hidden path),
   redeploy via empty-commit push (never the dashboard Redeploy button
   — see AGENTS.md). Do NOT link the page from any public nav, page, or
   sitemap.
6. **First-run QC** — the first Muse run's leads get checked row by row
   against this runbook before Jessie approves any of them. The 26
   No outside leads are carried over; the project starts clean from Muse hunting. They are
   not carried over automatically. The first blast is also QC'd
   (preview + recipient count) before Jessie approves it.
