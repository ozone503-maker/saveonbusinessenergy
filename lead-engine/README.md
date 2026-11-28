# SOBE Lead Engine — v3 (live 2026-11-27)

Pushed to ozone503-maker/saveonbusinessenergy on 2026-11-27 (Jessie's
order: match the site and push it). The hidden page is live at
/saveonbusinessenergy.com/leads.html, but the APIs cannot work yet:
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
2. **Bulk ingestion.** The dashboard eats entire mailing lists: upload a
   CSV, map the columns, and the Ingestor dedupes, aggregates, and
   labels every row with who gave it to us. See `api/ingest.js`.
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
   — Jessie, Gavin, or another bot. Every push carries an `author`
   field (Jessie / Gavin / bot name) for audit logging only; it is not
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

## Action buttons (dashboard, top of the page)

| Button | What it does |
|---|---|
| Send email | Scrolls to the Weekly megablast, shows the blast builder. It never sends on first tap — build the blast first (recipient count + preview), then approve, then confirm to send. |
| Craft campaign | Scrolls to the Campaigns builder (news-story or pain-point). |
| Import new list | Scrolls to Upload a mailing list (contributor name + CSV). |
| Sort by keyword | Scrolls to Leads and focuses the keyword search — search / sort leads and contacts by keyword, tag, route, city, contributor, status. |
| Find new leads | Saves a direction for the next run: run Hunter + Route Scout. The run reports back what it found. |
| Reprogram agent | Scrolls to the Reprogram box (paste a large instruction chunk, pick the agent, see version history). |
| Today vs 200 | Scrolls to the Goal Tracker and refreshes today's count vs 200. |

## Files

| File | What it is |
|---|---|
| `SCHEMA.md` + `schema.sql` | Postgres: v1 `leads`, `memory`, `directions` + v2 `contributors`, `uploads`, `contacts`, `campaigns`, `blasts` + v3 `agents`, `agent_versions`, `route_ideas`, `daily_counts`. `login_codes` / `login_sessions` RETIRED in v3. Run `schema.sql` once, after provisioning. |
| `leads.html` | Hidden dashboard (unlisted, `noindex`, no public links). NO LOGIN — opens straight to the dashboard (v3). Action bar, Goal Tracker (today vs 200), lead table with approve/reject + keyword search/sort, Upload a mailing list, "Tell the agent" directions, Reprogram box + version history, Route Scout log, Memory, Campaigns, Weekly megablast. |
| `api/_db.js` | Shared Postgres pool (`pg`, not installed yet) + public-row presenters for leads, contacts, campaigns, blasts, uploads. |
| `api/_auth.js` | v3: NO AUTH. Open-access note + audit-only author helper. No login check, no session, no code. |
| `api/leads-auth.js` | RETIRED in v3 — answers 410 Gone. Do not revive without Jessie's order. |
| `api/leads.js` | GET list (filter by status/route/city), POST approve/reject. No browser lead creation, no `contacted` from here. |
| `api/directions.js` | GET directions, POST a new one (Jessie / Gavin / bot name, audit only). |
| `api/memory.js` | GET memory. Read-only from the browser; the run writes it. |
| `api/ingest.js` | POST a contributor + JSON rows (browser parses the CSV). Dedupe on email + business+city, label with contributor, flag bad / out-of-territory rows for review. GET lists uploads + contributors. |
| `api/blasts.js` | Campaigns + blasts. Build (audience count + preview, draft), approve (arms, does not send), send (approved + confirm:true only), unsubscribe (public). |
| `CREW.md` | The crew: Orchestrator, Hunter, Ingestor, Enricher, Campaign Writer, Blast Manager, Route Scout, Maintenance Bot (now rebuilds agents from pasted chunks). Goal: 200 new addresses/day. |
| `api/reprogram.js` | Rebuild an agent from a large pasted chunk (up to 50,000 chars). New version, never overwrites history, hard rules still bind it. |
| `api/goal.js` | Goal Tracker counts: today vs 200, this week, breakdown by route/contributor. |
| `api/scout.js` | Route Scout idea log: propose an idea, mark it trying/worked/flopped with the address count. |
| `CAMPAIGNS.md` | Campaign menu: news-story template + 16 pain-point campaigns seeded by the live articles. |
| `RUNBOOK.md` | How a scheduled Muse run works in v2, step by step, with the exact lead record and the no-outreach rule. |

## The idea in one paragraph

Muse hunts Texas businesses with serious power bills (routes 1–3 first:
ERCOT queue, TX permits, Maps + Comptroller), writes sourced leads to
Postgres, and remembers what worked, what flopped, and which leads not
to repeat. Jessie and Gavin steer it from the hidden dashboard by leaving
directions — including reprogram directions, which the Maintenance Bot
turns into rules in the database so the next run behaves differently
with no deploy. Uploaded mailing lists join the same repository, labelled
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
