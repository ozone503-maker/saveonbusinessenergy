# SOBE Lead Engine — the full protocol, idea to implementation

Save on Business Energy (saveonbusinessenergy.com) — Texas commercial
electricity lead generation for USA Energy Partners. Written 2026-11-27.
Live at https://saveonbusinessenergy.com/leads (hidden page, unlisted,
noindex, linked from nowhere). Repo: ozone503-maker/saveonbusinessenergy.
People: Jessie + Muse build and run it; Gavin joins later. No outside
bot runs the backend — the front end accepts lists from anyone, Grok
included; the backend is Jessie + Muse only.

Companion files: `lead-engine-brief.md` (the original brief),
`README.md` (version history), `RUNBOOK.md` (one run, in order),
`CREW.md` (the agents), `SCHEMA.md` + `schema.sql` (the database),
`CAMPAIGNS.md` (the campaign menu), `GAVIN.md` (the plain-words
description for Gavin). This file is the whole protocol in one place,
step by step, from the idea to the running implementation.

---

## STEP 1 — The idea

Find every Texas business that pays a serious power bill, and the
person who pays it. Every route counts, including ones nobody has
thought of yet. Build whatever agents are needed, run them however
fits, keep growing the crew as new angles appear.

## STEP 2 — The lead record (one row per business)

Business | Decision-maker + title | Contact (email/phone) |
Source (link) | Why now | Route | Date found

## STEP 3 — The hard rules (bind everything below; nothing overrides them)

1. Every field sourced. No invented names, emails, or numbers. If a
   contact can't be sourced, the lead goes in as "business + source,
   no contact yet" — never guessed, never filled from a similar
   business.
2. Never list the same business twice. Dedupe on business name + city
   (the database enforces `UNIQUE (business, city)` as the backstop).
3. Deregulated Texas only: Houston, Dallas–Fort Worth, Corpus Christi
   are in; Austin and San Antonio are out.
4. Finds and lists only. No emails, calls, or DMs to prospects without
   Jessie's explicit go — a go that names the lead, the message, and
   the channel. Drafts are drafts until he approves the exact text.
5. Language, in anything the engine writes: never call Jessie / USA
   Energy Partners a "broker". Never promise savings. The call to
   action is a free review — no fee, no obligation.
6. A blast is a draft until Jessie approves it on the hidden page
   *and* confirms the send. Approval alone never sends anything.
7. Uploaded lists are not consent (`consent_status = 'unknown'`).
   Unsubscribed addresses are excluded from every blast audience by
   the query itself.
8. ERBOT callers are separate — straight to Gavin's email, never
   auto-joining the blast list.

## STEP 4 — The routes (in order)

1. ERCOT interconnection queue + data-center projects (biggest loads,
   public).
2. Texas permits — new commercial construction, expansions,
   change-of-use (TDLR, city permit portals).
3. Google Maps + TX Comptroller — cold storage, manufacturing,
   hotels, hospitals, big-box retail, dealerships, laundromats,
   large restaurants.
4. Apollo + LinkedIn — the decision-maker, once the business is
   identified. Needs accounts; flag before using.
5. Industry associations + chambers of commerce (member lists).
6. Referral partners — CPAs, contractors, property managers.
7. Past the list: commercial real-estate listings (large sq ft =
   large load), TX franchise-tax records (revenue as size proxy),
   SEC filings for Texas operators, utility territory maps.

Routes 1–3 first, every run — no logins needed. Routes 4–7 only when
the Orchestrator says so. New routes the agent discovers get a
`route:*` memory row and are named in the run report.

## STEP 5 — The crew (the agents)

The database is the shared memory, not any one agent's chat history.
Every role reads and writes rows; every decision is a row Jessie can
open on the dashboard. No role sends outreach on its own. Ever.

- **Orchestrator (Main)** — owns the run end to end. Reads
  directions first, reads memory, tells the other roles what to do,
  in order. Owns dedupe and the report back to Jessie after every
  run. Rejects any output that breaks a hard rule and writes the
  lesson to memory.
- **Hunter** — finds businesses on routes 1–3 first (then 4–7 when
  told). Returns candidates only: business, city, source link,
  why-now, route. Never a contact.
- **Ingestor** — eats uploaded lists in whatever shape they're in
  (Step 7). Maps columns, dedupes, labels every row with the
  contributor. Never invents a missing field; flagged rows come back
  for Jessie to review — never silently dropped, never silently fixed.
- **Enricher** — finds the person who pays the bill: decision-maker
  + title + a way to reach them, sourced only. If no contact can be
  sourced, the lead stays `no-contact-yet`.
- **Route Scout** — only new angles. Proposes 1–2 new ways to get
  leads every run, writes them to `route_ideas`. Even 20–30 new
  addresses counts. If the day is tracking short of 200, the Scout
  goes first next run.
- **Campaign Writer** — writes news-story and pain-point campaigns
  (Step 11). Drafts only.
- **Blast Manager** — builds the weekly megablast from an approved
  campaign: audience count + 5-address preview + subject options +
  body draft. Draft until Jessie approves, then confirm to send.
- **Maintenance Bot ("reprogram on the spot")** — watches the
  directions inbox. A reprogram direction changes how the crew works
  immediately, with no code deploy: short ones become `rule:*` memory
  rows; large pasted chunks (up to 50,000 chars) rebuild an agent as a
  new version in `agent_versions` (history never overwritten, raw
  chunk kept verbatim). Hard rules still bind it — offending parts
  are dropped with a reason logged.
- **Lead Agent (admin assistant)** — answers Jessie's and Gavin's
  questions from the database only ("How many emails total?", "How
  many in Dallas?", "What are the latest pain points?"). No LLM,
  never invents a number. Reads and reports only; never sends,
  approves, or changes anything. Every Q&A logged to `questions`.

## STEP 6 — The database (Neon Postgres "sobe-leads", live)

Free plan, US East. `POSTGRES_URL` set in Vercel for Production +
Preview. 15 live tables (plus 2 retired):

- `leads` — one row per business. `UNIQUE (business, city)`,
  `contact_status` sourced / no-contact-yet, `source_url` required,
  `status` new / approved / rejected / contacted.
- `contacts` — the email repository. One row per email, lowercased,
  UNIQUE. Source, contributor, tags, `consent_status`,
  `unsubscribed` tracked.
- `memory` — `route:*` (what worked/flopped), `rule:*` (standing
  rules), `do-not-repeat:<business>|<city>` (rejected leads).
- `directions` — Jessie / Gavin / bot steering, status new / done /
  declined, with a `result_note`. Conflicting directions are
  declined with a reason, never silently followed.
- `contributors` — who gave us a list. `uploads` — one row per file
  (total / imported / duplicate / flagged). `upload_files` — the
  photo itself, cleared after the run reads it.
- `campaigns`, `blasts` — campaigns (draft until approved) and
  blasts (draft / approved / queued / sent / cancelled).
- `agents`, `agent_versions` — the crew lives in the database; the
  current version is the instruction set each run uses.
- `route_ideas` — the Scout's log (proposed / trying / worked /
  flopped, with addresses found).
- `daily_counts` — one row per date: new contacts, new leads,
  by-route / by-contributor breakdowns, target 200.
- `questions` — the Lead Agent's Q&A log.
- RETIRED in v3: `login_codes`, `login_sessions` — no auth any more
  (Jessie's call: nobody else knows the hidden address, so there is
  no security need).

## STEP 7 — Getting leads in (three ways)

**A. The hunt (Hunter, routes 1–3 first).** Sourced businesses,
written through `POST /api/write-lead` only — never through
`/api/ingest` (that labels everything 'referral upload'). The
endpoint validates every row (business, city, real source URL,
route in ercot-queue / tx-permits / maps-comptroller; Austin /
San Antonio rejected), dedupes on email and business+city, inserts
the lead + contact, and refreshes today's `daily_counts`.

**B. Upload a list (Ingestor, any shape).** CSV, spreadsheet
(.xlsx/.xls — read right in the browser with the vendored SheetJS
reader, first sheet, first row = headers, any order/casing), or a
photo of a list (JPG/PNG, up to 3 MB). A photo is QUEUED, not
imported on the spot — the next run reads it and imports the rows
through `/api/ingest` under the same contributor label and rules,
then clears the image data. Contributor ("Who gave us this list?")
is required on every upload, whatever the shape. 5,000-row cap.
Bad email, no business and no email, Austin / San Antonio = flagged
for Jessie, never silently imported.

**C. The Scout.** 1–2 new ideas per run; the best one gets tried
the same run and logged worked/flopped with its address count.

## STEP 8 — One scheduled run, in order

0. **Preconditions** — Postgres live, tables exist, `/api/write-lead`
   answers, no run already in progress. (Muse cannot reach Postgres
   directly — the connection string lives in Vercel env vars only,
   and there is no Neon CLI/MCP access. The run hunts with the
   browser and writes through the API.)
0. **Read the current agents first** — from `agents` /
   `agent_versions` in the database, not from CREW.md alone. Seed
   from CREW.md if the table is empty (fresh database).
1. **Read directions first, including reprogram directions** —
   Maintenance Bot applies reprograms immediately (Step 5). Anything
   conflicting with the brief is declined with a reason.
2. **Read memory** — `rule:*`, `route:*`, `do-not-repeat:*`. Flopped
   routes go last or are skipped; rejected leads are never re-added.
3. **Process the ingest queue** — uploads with status partial /
   failed / queued. Queued photos: fetch the image, read the rows,
   import through `/api/ingest`, mark done/partial, clear the image.
   Unreadable photo = `failed` with a note; tell Jessie so he can
   re-take it. Never guess at rows you can't read.
4. **Hunt** — routes 1–3 first (Step 4).
4b. **Scout** — 1–2 new ideas, try the best one this run.
5. **Enrich** — the person who pays the bill, sourced only, or the
   lead stays `no-contact-yet`.
6. **Dedupe** — check all three before writing: `leads`
   (business+city), `memory` (`do-not-repeat:*`), `contacts`
   (email). Any hit = skip. A skip is not a failure.
7. **Write** — hunted leads through `POST /api/write-lead`
   (author 'Muse', batches up to 200). Insert with `status = 'new'`.
8. **Draft a campaign only if asked** — the run does not invent
   campaign occasions. News campaigns need the actual story first.
9. **Update memory** — at least one `route:*` row per route tried,
   one `do-not-repeat:*` row per rejected lead.
9b. **Count the day vs 200** — refresh `daily_counts` from the real
   tables. Counted, never guessed.
10. **Close the directions** — every `new` direction becomes `done`
    with a `result_note`, or `declined` with the reason.
11. **Report back to Jessie in chat, after every run** — today vs
    200 FIRST, then new leads, uploads processed, directions
    done/declined, what's working/flopped, new routes, duplicates
    skipped, campaigns drafted (draft only — never sent). No
    outreach happened — say so plainly if it matters.

## STEP 9 — Ask the lead agent

Jessie or Gavin types a question in the "Ask the lead agent" box on
the dashboard (under Today, above Add leads) and gets a plain-words
answer computed from the database: total emails, emails/leads in any
city, leads total, today vs 200, latest pain points, latest leads,
unsubscribed count, who gave us lists. Anything it can't answer
gets "I don't have that from the list yet" plus what it CAN answer.
Three quick-tap examples on the page. No LLM, never invents.

## STEP 10 — The goal: 200 new addresses a day

Minimum 200 NEW addresses per day — deduped contacts with a real
email, counted in `daily_counts`. Not the Hunter's job alone: a
realistic day is hunting (40–80) + an uploaded list (50–150) +
Scout finds (20–30 per idea — they add up). If today lands short,
say so in the report and lead the next run with the Scout + the
ingest queue. Never inflate the count with duplicates, bad emails,
or Austin / San Antonio rows.

## STEP 11 — Campaigns become the weekly megablast

1. Campaign Writer writes the campaign (draft) — news or pain-point.
   News needs the actual story (headline + source link). Pain-point
   starts from a live article on the site (16 seeded in
   `CAMPAIGNS.md`: contract ending, summer spikes, demand charges,
   TDU charges, fixed vs variable vs indexed, REP out of business,
   renegotiating value, reading the bill, power factor, choosing a
   partner, ERCOT plain English, how contracts work, data centers,
   solar + storage, Texas energy future, locking a rate).
2. Blast Manager builds the blast: audience from `contacts` where
   `unsubscribed = false`, filtered by the campaign's audience
   filter. Preview first: recipient count, 5-address sample,
   subject options, body draft. Blast status: `draft`.
3. Jessie reviews the preview on the hidden page and approves the
   blast (`approved_by` + `approved_at`). Approval arms it; it does
   not send it.
4. Sending needs a separate confirm (`confirm: true`) on an
   `approved` blast only. Then Resend sends one email per recipient,
   each with its own unsubscribe link.
5. Unsubscribes are honoured immediately and excluded from every
   future audience by the query itself.

## STEP 12 — Steering it (Jessie and Gavin)

- **Directions** — leave one on the dashboard ("Tell the agent what
  to do"). The next run reads it first. Directions override the
  default route order.
- **Reprogram** — "Change how the agent works": paste a big chunk of
  words (up to 50,000 chars) and the Maintenance Bot rebuilds that
  agent in the database as a new version. No code deploy, no Vercel
  touch. Hard rules still bind it.
- **Approve / Skip** — on each lead card. Approve means "this lead
  is good", not "contact them".
- **Ask** — the Lead Agent box (Step 9).

## STEP 13 — The dashboard (v4 simplified, v5 Lead Agent)

Hidden page, no login, phone-first, plain words, fewest taps.
First view, in order: the 3-line how-to note; Today (one big number,
"X of 200 new emails"); the "Ask the lead agent" box; one big
**Add leads** button (Upload a list / Find new leads); one big
**Send email** button (preview → approve → confirm). Then leads as
cards with Approve / Skip. Everything else is in one closed "More"
section with plain-words dropdowns: Send an email to the list,
Write a new email, Tell the agent what to do, Change how the agent
works, Find new ways to get leads, What the agent has learned, Find
a lead by word. No jargon on the page. It says Jessie + Muse;
Gavin joins later.

## STEP 14 — Deployment (how it got live)

- Repo: ozone503-maker/saveonbusinessenergy, branch `main`, hosted
  on Vercel. Live files at repo root: `leads.html`,
  `api/*.js` (`ask`, `ingest`, `ingest-photo`, `write-lead`,
  `leads`, `directions`, `memory`, `blasts`, `goal`, `reprogram`,
  `scout`, plus the untouched `tex-lead`, `tex-session`,
  `quote-lead`), `package.json` (`pg` only), `vercel.json`
  (`{"cleanUrls": true}` — canonical URL is
  `saveonbusinessenergy.com/leads`, no `.html`), `vendor/`
  (vendored SheetJS, no CDN).
- Drafts live in `lead-engine/` (this file, README, RUNBOOK, CREW,
  SCHEMA, CAMPAIGNS, GAVIN, `schema.sql`, `api/` draft copies,
  `migrations/001-any-shape-uploads.sql`).
- Pushes go through the GitHub Contents API. Vercel auto-deploys on
  push — never use the dashboard Redeploy button, and never make
  Jessie relay verification codes (look codes up in his connected
  Gmail). The page is never linked from public nav, a page, or a
  sitemap.
- Env vars (server-side only, never in the repo or browser code):
  `POSTGRES_URL`, `RESEND_API_KEY`, `TEX_FROM_EMAIL` (verified
  Resend sender, or blasts will not arrive). Existing, unchanged:
  `SPEKO_API_KEY`, `TEX_LEAD_EMAIL`, `SPEKO_WEBHOOK_SECRET`.
  `LEADS_PASSWORD` is removed — do not set it.

## STEP 15 — Status, 2026-11-27 evening (what's live, what's open)

Live and verified: database (Neon "sobe-leads", 15 tables, migration
001 run); dashboard at `/leads` (v4 simplified + Lead Agent, verified
in a real browser); Ask endpoint (verified end to end, real counts);
any-shape uploads (CSV + .xlsx direct, photo queued — migration
live); write path (`api/write-lead.js`); first hunt DONE — 37 real
Texas businesses in (6 ERCOT/data centers, 6 TX permits, 25
Maps/Comptroller), 8 with a sourced phone, 0 with a sourced email.

Open: Enricher accounts — Apollo signup created but login loops back
to the sign-in screen on every browser; support email sent
2026-11-27 to support@apollo.io, awaiting reply; LinkedIn
(manual/backup) not started. 2 fake test contacts still in the list
(Jessie hasn't answered the offer to clear them). Memory-write endpoint
live (`POST /api/memory`, verified with the first hunt's route lessons).
Route Scout not run yet. No scheduled runs yet — cadence is Jessie's pick
(weekday mornings is the draft proposal; weekly megablast day TBD).
No real .xlsx and no real photo has gone through the live page yet.
Neon agent integration not installed — the setup page failed a
safety check; install only if Jessie approves another route.
