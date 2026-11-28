# SOBE Lead Engine — v3 (live 2026-11-27)

Pushed to ozone503-maker/saveonbusinessenergy on 2026-11-27 (Jessie's
order: match the site and push it). The hidden page is live at
/saveonbusinessenergy.com/leads, but the APIs cannot work yet:
Postgres is not provisioned and schema.sql has not been run — every
API call fails until that is done. No cron, nothing sent.
Live public pages and `api/tex-lead.js` / `api/tex-session.js` are untouched.

Brain runs on Muse tokens (this Muse hunts on a schedule). Vercel only
hosts the hidden dashboard and the Postgres database. Jessie + Muse only.

## What changed in v2 (Jessie's orders, 2026-11-27)

1. **Password-free access.** The shared-password gate is gone. Jessie
   and Gavin sign in with a 6-digit code emailed to them (Resend, 15
   minutes, single use) or the magic link in that same email. No
   password to remember or type. See `api/_auth.js` + `api/leads-auth.js`.
2. **Bulk ingestion.** The dashboard eats entire mailing lists in
   whatever shape they're in — CSV, spreadsheet (.xlsx/.xls, read
   right in the browser), or a photo of a list (queued, read on the
   next run). Upload, map the columns, and the Ingestor dedupes,
   aggregates, and labels every row with who gave it to us. See
   `api/ingest.js` + `api/ingest-photo.js`.
3. **Giant email repository + weekly megablasts.** `contacts` is one row
   per email, with source, contributor, tags, consent, and unsubscribe
   tracked. Campaigns (news / pain-point) become blasts, and a blast is
   draft-only until Jessie approves it *and* confirms the send.
   See `api/blasts.js`, `CAMPAIGNS.md`.
4. **Multi-agent crew.** One main agent, five role agents, and a
   Maintenance Bot that reprograms the crew on the spot by writing rules
   to the database — no code deploy. See `CREW.md`.
5. **Campaign options.** News-story and pain-point menus, seeded by the
   live articles. See `CAMPAIGNS.md`.

## What changed in v3 (Jessie's orders, 2026-11-27)

1. **NO AUTH — no security need.** The password-free code login from
   v2 is REMOVED, on Jessie's explicit call: nobody else will ever know
   the hidden page's address, so there is no security need. The page
   opens straight to the dashboard. Anyone using the machine can push
   — Jessie + Muse (Gavin joins later). Every push carries an `author`
   field (Jessie / Muse) for audit logging only; it is not
   verified. See `api/_auth.js` (open-access note) and `api/leads-auth.js`
   (retired stub, answers 410). The `login_codes` / `login_sessions`
   tables are retired — never read or written.
2. **Reprogram Bot rebuilds agents in the website.** Paste a large
   chunk of instructions from another bot (up to 50,000 characters)
   and the Maintenance Bot rebuilds that agent inside the database
   (`agents` + `agent_versions`) — new version, full history, raw text
   kept verbatim. See `api/reprogram.js`, `CREW.md`.
3. **Route Scout.** A new role agent whose only job is finding new
   creative ways to get leads. Even 20–30 new addresses counts. Ideas
   live in `route_ideas`. See `CREW.md`, `api/scout.js`.
4. **Goal: minimum 200 new addresses per day.** Counted, never guessed
   — deduped contacts with a real email. Goal Tracker on the dashboard
   (`api/goal.js`, `daily_counts`). Replaces the old 25/run draft target.
5. **Action buttons.** One bar at the top of the dashboard with big
   phone-friendly buttons, each doing one named thing (below).

## What changed in v4 — simplified (Jessie's ruling, 2026-11-27)

The dashboard as built was not user friendly. Simplified: phone-first,
plain words, fewest taps, no jargon on the page.

First view is three things only, in order:
1. **How to use this** — 3 short lines right under the title.
2. **Today** — one big number: "X of 200 new emails today". Nothing else
   about the goal on first view.
3. **Add leads** (one big button — opens "Upload a list" and "Find new
   leads" underneath) and **Send email** (one big button — preview first,
   then approve, then confirm, same gate as before).
Then the leads list, as cards only: business, person, Approve / Skip.
No tables, no filters row on first view.

Everything else lives behind one closed **More** section at the bottom,
with one dropdown per job, each labelled in plain words:

**Out in the open (everyday):** finding leads, adding a list, sending
email — Add leads, Send email, Approve / Skip on each lead card.
**In dropdowns, closed by default (rarely needed):**
- Send an email to the list — the weekly email builder + preview + approve
  (the Sender's work; the send gate is unchanged).
- Write a new email — the Email Writer's builder (news story / sore spot).
- Tell the agent what to do — directions for the next run.
- Change how the agent works — the Fixer: paste a big chunk of words,
  rebuild a worker in the website, version history kept.
- Find new ways to get leads — the Scout's idea log.
- What the agent has learned — memory + today's detail (still to go,
  where they came from, this week).
- Find a lead by word — search + sort. The person-finder has no buttons:
  it works on its own during a run.

Visible page copy is plain words only — no dedupe, contributor, Postgres,
API, audience, ingest, enrich, orchestrator, or reprogram jargon, and no
"another bot" wording. The page says Jessie + Muse, Gavin joins later.
Underlying API field names are unchanged, so nothing breaks.

## What changed in v5 — Lead Agent, the admin assistant (Jessie's order, 2026-11-27)

Gavin (or Jessie) asks a question and gets a fast answer from the real
numbers — like an administrative assistant.

1. **Ask the lead agent** — a box on the main view, right under Today
   and above Add leads: a text input + Ask button, answer shows below
   in plain words. Three quick-tap examples underneath: "How many
   emails total?", "How many in Dallas?", "What are the latest pain
   points?" See `api/ask.js`.
2. **No LLM call, no invented numbers.** The answer is computed from
   database rows: total emails, emails/leads in any city, leads total,
   today vs 200, latest pain points, latest leads, unsubscribed count,
   who gave us lists. Anything it can't answer from the database gets
   a plain "I don't have that from the list yet" plus the list of
   questions it CAN answer.
3. **Honest limit:** until Postgres is provisioned, Ask answers "The
   list isn't live yet — the database isn't set up, so I have no
   numbers yet." That is by design, not a bug.
4. **Log.** Every question + answer goes to a new `questions` table
   (best effort — a log failure never blocks the answer).
5. **New role in CREW.md:** Lead Agent — reads and reports only. It
   never sends, approves, or changes anything.

## What changed in v6 — any shape of list (Jessie's order, 2026-11-27)

Front end accepts everything — Grok lists included, any list from
anyone. Backend stays Jessie + Muse only, Gavin later: no outside bot
runs the backend or the agents.

1. **Spreadsheet, direct.** `.xlsx` / `.xls` files upload as-is — no
   more "export to CSV first". The browser reads the first sheet
   (first row = headers, any order/casing) with the vendored SheetJS
   reader (`vendor/xlsx.full.min.js`, served from the site itself, no
   CDN, no new server dependency), then the same column-matching +
   import flow as CSV. Same 5,000-row cap, same rules.
2. **Photo of a list.** JPG/PNG (up to 3 MB) uploads too. There is no
   OCR service on this stack, so a photo is QUEUED, not imported on
   the spot: `api/ingest-photo.js` stores it (`uploads` row, status
   `queued`, file_type `photo` + `upload_files` row holding the image)
   and the next scheduled run reads it and imports the rows through
   `/api/ingest` under the same contributor label and rules. The page
   says so plainly: "Photo lists get read on the next run — check back
   after it runs." The run clears the image data after import; the
   record stays for audit.
3. **Contributor still required on every upload, whatever the shape**
   — front end accepts everything, and every row is still labelled
   with who gave it to us.
4. **Migration needed (not yet run live):**
   `lead-engine/migrations/001-any-shape-uploads.sql` — adds
   `uploads.file_type`, the `queued` status, and the `upload_files`
   table. Run it once against the live Neon database before the first
   photo upload; CSV/xlsx uploads work without it. `schema.sql` itself
   already carries the v6 columns for a fresh install.

## Files

| File | What it is |
|---|---|
| `SCHEMA.md` + `schema.sql` | Postgres: v1 `leads`, `memory`, `directions` + v2 `contributors`, `uploads`, `contacts`, `campaigns`, `blasts` + v3 `agents`, `agent_versions`, `route_ideas`, `daily_counts` + v5 `questions` + v6 `uploads.file_type` / `queued` status / `upload_files`. `login_codes` / `login_sessions` RETIRED in v3. Run `schema.sql` once, after provisioning. |
| `lead-engine/migrations/001-any-shape-uploads.sql` | v6 migration for the live DB — adds `uploads.file_type`, the `queued` status, and `upload_files`. Run once against Neon before the first photo upload. |
| `leads.html` | Hidden dashboard (unlisted, `noindex`, no public links). NO LOGIN — opens straight to the dashboard. v4 simplified: How-to note, Today number, Add leads + Send email big buttons, lead cards with Approve / Skip, everything else behind one closed More section with one plain-words dropdown per job. v5: Ask the lead agent box under Today. |
| `api/_db.js` | Shared Postgres pool (`pg`, not installed yet) + public-row presenters for leads, contacts, campaigns, blasts, uploads. |
| `api/_auth.js` | v3: NO AUTH. Open-access note + audit-only author helper. No login check, no session, no code. |
| `api/leads-auth.js` | RETIRED in v3 — answers 410 Gone. Do not revive without Jessie's order. |
| `api/leads.js` | GET list (filter by status/route/city), POST approve/reject. No browser lead creation, no `contacted` from here. |
| `api/directions.js` | GET directions, POST a new one (Jessie / Gavin / bot name, audit only). |
| `api/memory.js` | GET memory. Read-only from the browser; the run writes it. |
| `api/ingest.js` | POST a contributor + JSON rows (browser parses the file — CSV, or a spreadsheet read with the vendored SheetJS reader). Dedupe on email + business+city, label with contributor, flag bad / out-of-territory rows for review. GET lists uploads + contributors. |
| `api/ingest-photo.js` | POST a photo of a list (JPG/PNG, up to 3 MB) + contributor — queues it (status `queued`, file_type `photo`, image in `upload_files`) for the next run to read and import. GET lists queued photos; GET ?upload_id=N returns the full image for the run. |
| `vendor/xlsx.full.min.js` | Vendored SheetJS 0.20.3 reader, served from the site — the browser reads .xlsx/.xls with no new server dependency and no CDN. |
| `api/blasts.js` | Campaigns + blasts. Build (audience count + preview, draft), approve (arms, does not send), send (approved + confirm:true only), unsubscribe (public). |
| `CREW.md` | The crew: Orchestrator, Hunter, Ingestor, Enricher, Campaign Writer, Blast Manager, Route Scout, Maintenance Bot (now rebuilds agents from pasted chunks), Lead Agent (answers questions from the real numbers). Goal: 200 new addresses/day. |
| `api/reprogram.js` | Rebuild an agent from a large pasted chunk (up to 50,000 chars). New version, never overwrites history, hard rules still bind it. |
| `api/goal.js` | Goal Tracker counts: today vs 200, this week, breakdown by route/contributor. |
| `api/ask.js` | Lead Agent: POST a question, get a plain-words answer computed from the database. Never invents a number; logs to `questions`. |
| `api/scout.js` | Route Scout idea log: propose an idea, mark it trying/worked/flopped with the address count. |
| `CAMPAIGNS.md` | Campaign menu: news-story template + 16 pain-point campaigns seeded by the live articles. |
| `RUNBOOK.md` | How a scheduled Muse run works in v2, step by step, with the exact lead record and the no-outreach rule. |

## The idea in one paragraph

Muse hunts Texas businesses with serious power bills (routes 1–3 first:
ERCOT queue, TX permits, Maps + Comptroller), writes sourced leads to
Postgres, and remembers what worked, what flopped, and which leads not
to repeat. Jessie steers it from the hidden dashboard by leaving
directions — including reprogram directions, which the Maintenance Bot
turns into rules in the database so the next run behaves differently
with no deploy. Gavin joins later. Uploaded mailing lists join the same repository, labelled
by who gave them, and the Campaign Writer + Blast Manager turn the
repository into weekly megablasts — drafts until Jessie approves and
confirms each one. No outreach without Jessie's explicit go.

## Open questions (block a live push)

1. ~~Auth~~ REMOVED in v3: no login, no code, no session (Jessie's call —
   nobody else knows the address). Nothing reads `LEADS_PASSWORD` and
   nothing sends a sign-in code.
2. Postgres: provision in Vercel dashboard + `npm i pg` + run `schema.sql`.
3. Resend sender: `TEX_FROM_EMAIL` (or `leads@saveonbusinessenergy.com`)
   must be a verified Resend sender, or the blasts will not arrive.
   (No codes are sent any more, so codes are no longer a blocker.)
4. Cadence to hit 200/day: weekday mornings is the draft proposal, but
   200/day needs hunting + uploads + Scout finds combined, and more
   than one run a day if a single morning run lands short — Jessie to
   pick the run times and the weekly megablast day.
5. No outside leads are carried over — the project starts clean from Muse hunting.
