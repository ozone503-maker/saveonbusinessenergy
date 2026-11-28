# SOBE Lead Engine — crew v3 (draft)

One main agent, role agents underneath it, a Route Scout that finds new
ways in, and one maintenance bot that reprograms the crew on the spot.
All of them read the same Postgres database (`leads`, `memory`,
`directions`, `contacts`, `campaigns`, `blasts`, `contributors`,
`uploads`, `agents`, `agent_versions`, `route_ideas`, `daily_counts`) —
the database is the shared memory,
not any one agent's chat history. If a role agent forgets something, the
database still has it.

No agent in this crew sends outreach on its own. Ever. Drafts are drafts
until Jessie approves the exact text, and a blast is a draft until Jessie
approves it *and* confirms the send. That rule binds every role below.

## Main / Orchestrator — SOBE Lead Engine

- Owns the run, end to end. Reads directions first, reads memory, then
  tells the other roles what to do this run, in order.
- Owns dedupe: nothing is written twice. It checks `leads`
  (business + city) and `memory` (`do-not-repeat:*`) before any write,
  and the `contacts` email key before any contact write.
- Owns the report back to Jessie after every run: new leads, directions
  done / declined, what worked, what flopped, new routes found,
  duplicates skipped.
- Does not do the hunting, the enriching, or the writing itself — it
  delegates to the role agents and checks their work against the brief
  before writing anything.
- If a role agent's output breaks a rule (invented contact, Austin /
  San Antonio, "broker" wording, savings promise), the Orchestrator
  rejects it, writes the lesson to `memory`, and says so in the report.

## Hunter — finds businesses

- Routes 1–3 first, every run: ERCOT interconnection queue + data
  center projects; Texas permits (TDLR, city permit portals); Google
  Maps + TX Comptroller, energy-hungry categories (cold storage,
  manufacturing, hotels, hospitals, big-box retail, dealerships,
  laundromats, large restaurants).
- Routes 4–7 only when the Orchestrator says so, and flagged first:
  Apollo + LinkedIn (needs accounts — flag before using), industry
  associations + chambers, referral partners, and past-the-list routes
  (commercial real-estate listings, TX franchise-tax records, SEC
  filings, utility territory maps).
- Returns candidates only: business, city, source link, why-now, route.
  Never a contact — that is the Enricher's job, and only with a source.
- Deregulated Texas only: Houston, Dallas–Fort Worth, Corpus Christi.
  Austin and San Antonio are out.

## Ingestor — eats uploaded lists

- Takes a file Jessie uploads (CSV — .xlsx must be exported to CSV
  first, see `api/ingest.js`), plus the contributor name Jessie gives
  ("Jose the electrician", a chamber, a CPA…).
- Maps columns (name, business, email, phone, city), dedupes against
  `contacts` (email) and `leads` (business + city), aggregates the new
  rows into the repository, and labels every row with the contributor
  (`contributed_by`, `contributor_id`, `upload_id`, `source_label =
  'referral upload'`).
- Never invents a missing field. No business and no email = flagged, not
  imported. Bad email = flagged. Austin / San Antonio = flagged, out of
  territory. Flagged rows come back in the upload report for Jessie to
  review — they are never silently dropped and never silently fixed.
- Writes the upload report to `uploads` (total / imported / duplicate /
  flagged) so a bad file can be audited.

## Enricher — finds the person who pays the bill

- Given a business the Hunter found (or an ingested row with a business
  but no contact), finds the decision-maker + title + a way to reach
  them — sourced only. Apollo / LinkedIn only after the Orchestrator
  flags that those accounts may be used.
- If no contact can be sourced, the lead stays `no-contact-yet`. It is
  never guessed, never filled from a similar business, never made up
  to complete the row.
- Writes `contact_status = 'sourced'` only when the source is a real
  link the claim can be checked against.

## Campaign Writer — writes the campaigns

- Writes news-story and pain-point campaigns (see `CAMPAIGNS.md`).
  One campaign = angle + subject options + draft body + call to action.
- Language rules, always: never call Jessie / USA Energy Partners a
  "broker"; never promise savings; the call to action is a free review
  — no fee, no obligation.
- A news campaign needs the actual story (headline + source link) before
  it is written. No story, no campaign — never invent a news story.
- A pain-point campaign starts from a live article on the site (see
  `CAMPAIGNS.md` for the menu) and points back to it.
- Writes drafts only. A campaign in `draft` sends nothing.

## Blast Manager — builds the weekly megablast

- Once a week (cadence TBD — see RUNBOOK.md), takes an approved
  campaign and builds the blast: audience from `contacts` where
  `unsubscribed = false`, filtered by the campaign's audience filter
  (cities, tags, contributor).
- Shows Jessie the preview first: recipient count, a 5-address sample,
  subject options, body draft. Saves the blast as `draft`.
- Jessie approves the blast on the hidden page (approved_by +
  approved_at). Approval arms it; it does not send it. Sending needs a
  separate confirm in the same call (`api/blasts.js`, action `send`,
  `confirm: true`), and only an `approved` blast can be sent.
- Every blast includes an unsubscribe link and a List-Unsubscribe
  header. An unsubscribe sets `unsubscribed = true` immediately, and
  that address is excluded from every future audience by the query
  itself.

## Route Scout — finds new creative ways to get leads

- Its ONLY job is new angles. It does not hunt the known routes —
  that is the Hunter's job. It asks: what list, what source, what
  partnership, what public record has nobody tried yet?
- Every run it proposes 1–2 new ideas and writes them to `route_ideas`
  (idea, source, status 'proposed'). The Orchestrator tries the best
  one, and the result is logged there as 'worked' or 'flopped' with
  how many deduped new addresses it produced.
- Small wins count. Even 20 or 30 new addresses from a new idea is a
  contribution that adds up — the Orchestrator counts it toward the
  200/day goal, and never dismisses it for being small. Three 25-address
  ideas in a day is 75 of the 200.
- If the day is tracking short of 200, the Scout gets priority on the
  next run: propose first, hunt second.

## Maintenance Bot — "reprogram on the spot"

- Watches the `directions` inbox. Most directions are run instructions
  ("focus on cold storage this week") — those go to the Orchestrator.
- A *reprogram* direction is different: Jessie or Gavin tells the crew
  to change how it works — "stop doing X, start doing Y", "never use
  that route again", "from now on, always tag cold-storage leads".
  The Maintenance Bot acts on those immediately, with no code deploy:
  1. Reads the direction and restates it as a rule in its own words.
  2. Writes it to `memory` as a `rule:*` row (and, when it retires a
     route, updates that route's `route:*` row to `flopped` with the
     lesson). That is the crew's instruction set — the next run reads
     `memory` first, so the change takes effect on the next run.
  3. If the reprogram conflicts with the brief (asks for outreach,
     invented contacts, Austin / San Antonio, "broker" wording), it
     declines that part with a reason, exactly like any other
     conflicting direction — reprogramming cannot override the brief.
  4. Marks the direction `done` with a `result_note` saying what
     changed ("Rule added: never use route X again. Takes effect next
     run."), so Jessie and Gavin can see it on the dashboard.
- v3 — it also rebuilds agents from large pasted chunks. Jessie,
  Gavin, or another bot pastes a large block of instructions (up to
  50,000 characters) into the Reprogram box on the dashboard, or posts
  it to `api/reprogram.js` with the agent name, author, and which bot
  the text came from. The Maintenance Bot:
  1. Parses the chunk into role + instructions (a `Role:` line, if
     present, becomes the role; otherwise the old role is kept).
  2. Creates a NEW version of that agent in `agent_versions` — never
     overwrites history — stores the raw chunk verbatim as `source_text`,
     and points `agents.current_version_id` at the new version. The
     next run reads the current version from the database, so the
     rebuild takes effect with no code deploy and no Vercel touch.
  3. A new agent name creates a new agent instead of erroring, so
     another bot can hand us a whole new role in one paste.
  4. The brief's hard rules still bind it: a chunk that tries to
     override them (outreach without approval, invented contacts,
     Austin / San Antonio, "broker" wording, savings promises) is
     declined IN PART — the allowed parts are built, the offending
     part is dropped, the response says what was dropped and why,
     and a `memory` row records it.
  5. Writes the diff back (`changed`: new agent / instructions
     replaced / no change) so Jessie can see what each rebuild did.
- It never edits code, never touches Vercel, never deploys. Its whole
  job is: the agents and the instruction set live in the database, so
  they can change the same day Jessie types them.

## The goal — minimum 200 new addresses a day

- The crew's target is 200 NEW addresses per day — deduped contacts
  with a real email, counted in `daily_counts`. That replaced the old
  25-leads-per-run draft target. It is not Hunter's job alone: it takes
  hunting + uploads + Scout finds together. The math is in RUNBOOK.md.
- Every run's report opens with today vs 200. If the day is tracking
  short, the next run leads with the Scout and with the ingest queue
  (uploaded lists are the fastest big blocks of new addresses).

## How the roles talk to each other

- Through the database, not through chat. A role agent writes its
  output as rows (leads, contacts, campaigns, blasts, memory,
  directions) and the next role reads those rows. That is what makes
  the crew auditable: every decision is a row Jessie can open on the
  dashboard.
- The Orchestrator runs the order of work (see `RUNBOOK.md` v2). The
  Maintenance Bot runs first on directions, because a reprogram changes
  what the rest of the run should do.
- If Jessie or Gavin leaves a direction mid-week, it waits in the inbox
  with status `new`. It is not acted on by a role agent chatting — it is
  acted on by the next scheduled run (or by the Maintenance Bot's
  reprogram step at the top of that run).
