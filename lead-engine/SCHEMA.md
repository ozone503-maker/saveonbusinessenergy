# SOBE Lead Engine — schema v3 (draft)

Postgres (Vercel Postgres / Neon). Twelve tables, empty by design — this
schema creates no leads, no contacts, nothing invented.

v1 tables: `leads`, `memory`, `directions`.
v2 tables: `contributors`, `uploads`, `contacts`, `campaigns`, `blasts`.
v3 tables: `agents`, `agent_versions`, `route_ideas`, `daily_counts`.
RETIRED in v3: `login_codes`, `login_sessions` — auth was removed
2026-11-27 (Jessie: no security need). They are never read or written
by any v3 endpoint; the CREATE TABLEs are kept in schema.sql only so a
v2 database does not break. Fresh installs may skip them.

## Tables

### `leads` — one row per business (v1 + v2 columns)

Same v1 columns and rules (`UNIQUE (business, city)` dedupe,
`contact_status` sourced / no-contact-yet, `source_url` required,
`status` new / approved / rejected / contacted). New in v2:

| Column | Notes |
|---|---|
| `contributor_id`, `contributed_by` | Who gave us this lead, when it arrived via an upload (e.g. 'Jose the electrician'). NULL for hunted leads. |
| `upload_id` | Which upload file it came from, if any. |
| `source_label` | Human label, e.g. 'referral upload'. |

Deregulated Texas only: Houston, Dallas–Fort Worth, Corpus Christi.
Austin and San Antonio are out — customers there cannot choose their
provider. That rule lives in `memory` too, so a future run cannot
forget it. The Ingestor flags Austin / San Antonio rows instead of
importing them.

### `memory` — the agent remembers (v1, unchanged)

`key` (unique), `fact`, `lesson`, `route`, `outcome`. Key patterns:
`route:<route>`, `rule:<short-name>`, `do-not-repeat:<business>|<city>`.
The Maintenance Bot writes `rule:*` rows when Jessie/Gavin reprogram
the crew — that is how a reprogram takes effect with no code deploy.

### `directions` — Jessie, Gavin, or another bot steers the agent (v1, v3 widened)

v3: `author` is 'Jessie' or 'Muse' for now; 'Gavin' joins later. No outside bots.
It is audit-only, not verified. The old Jessie/Gavin-only CHECK is gone.

`author` (Jessie / Gavin), `text`, `status` (new / done / declined),
`result_note`. A direction that conflicts with the brief is marked
`declined` with the reason, never silently followed.

### `contributors` — who gave us a list (v2)

| Column | Notes |
|---|---|
| `name` | As Jessie names them, e.g. 'Jose the electrician'. Unique, case-insensitive. |
| `kind` | Free text: referral partner / chamber / association / client / other. |
| `contact_email` | The contributor's own email, if known (not a lead). |
| `notes` | Anything Jessie wants remembered about them. |

### `uploads` — one row per file Jessie uploads (v2)

`contributor_id`, `contributor_name` (denormalised copy), `filename`,
`source_label` ('referral upload'), `rows_total`, `rows_imported`,
`rows_duplicate`, `rows_flagged`, `status` (done / partial / failed),
`received_at`, `received_by` (Jessie / Gavin). The ingest report lives
here, so a bad upload can be audited.

### `contacts` — the giant email repository (v2)

Separate from leads: a lead is a business to win; a contact is a
person/address we can email. One row per email address, ever.

| Column | Notes |
|---|---|
| `email` | UNIQUE, always lowercased + trimmed on write. The dedupe key. |
| `name`, `business`, `city` | Only if supplied / sourced. A contact with no email cannot live here — that business stays a lead with `no-contact-yet`. |
| `source` | Where it came from: 'referral upload', 'lead hunt', 'erbot', 'manual'. |
| `contributor_id`, `contributed_by`, `upload_id`, `lead_id` | Full provenance — every contact can answer "who gave us this?" |
| `tags` | `TEXT[]`, e.g. `['contract-ending', 'cold-storage']`. Used by campaign audiences. |
| `consent_status` | `unknown` (default — an uploaded list is NOT consent) / `given` / `implied-business` / `withdrawn`. Shown in the blast preview. |
| `unsubscribed`, `unsubscribed_at` | Unsubscribe is honoured immediately; the blast audience query excludes unsubscribed addresses by construction. |

### `campaigns` — one row per campaign idea (v2)

`name`, `type` ('news' / 'pain-point'), `angle`, `news_story` +
`news_story_url` (news only — headline + source as reported, never
invented), `pain_point` + `article_slug` (pain-point only — a live
article on the site), `subject_options` (`TEXT[]`), `body_draft`,
`cta` (default: free review, no fee, no obligation),
`audience_filter` (JSONB, e.g. `{"cities": ["Houston"], "tags":
["contract-ending"]}`), `status` (draft / approved / sent / archived),
`created_by` (Jessie / Gavin / Campaign Writer). A campaign is a draft
until its blast is approved — creating one never sends anything.

### `blasts` — one row per megablast (v2)

`campaign_id`, `name` (e.g. 'Weekly megablast — week of Dec 7'),
`audience_filter` (JSONB), `recipient_count` (counted at build time,
shown before approval), `scheduled_for`, `approved_by` +
`approved_at` (set on the hidden page after Jessie sees the preview),
`sent_at`, `sent_count`, `status` (draft / approved / queued / sent /
cancelled). The approval gate lives here: a blast stays `draft` until
approved, and only an `approved` blast can be sent — and only with an
explicit `confirm: true` in the send call.

### `agents` + `agent_versions` — agents live in the website (v3)

`agents`: name (unique, case-insensitive), role, current_version,
current_version_id, updated_by (audit only). `agent_versions`: one row
per rebuild — version, role, instructions (parsed), source_text (the
pasted chunk, verbatim as received), updated_by, source_bot (which bot
the text came from, if any), previous_version_id. A rebuild never
overwrites history: it inserts a new version row and points the agent
at it. The next run reads the current version from here.

### `route_ideas` — Route Scout's log (v3)

idea, source, proposed_by (default 'Route Scout'), status
(proposed / trying / worked / flopped), tried_at, result, addresses_found
(deduped new addresses that idea produced — even 20–30 counts).

### `daily_counts` — goal tracker, 200 new addresses/day (v3)

One row per date: new_contacts (deduped contacts with a real email,
added that day — counted, never guessed), new_leads, by_route and
by_contributor (JSONB breakdowns), target (200, every day). The
Orchestrator refreshes today's row at the end of each run; the dashboard
(`api/goal.js`) also computes live from contacts/leads so it is never stale.

### `login_codes` + `login_sessions` — RETIRED in v3 (was password-free login, v2)

Password-free access (Jessie's order). There is no password anywhere.

- `login_codes`: `email` (lowercased, allowlisted only), `code_hash`
  (SHA-256 of the 6-digit code — never the code itself), `expires_at`
  (15 minutes), `used_at` (single use).
- `login_sessions`: `email`, `token_hash` (SHA-256 of a random 32-byte
  token — never the token itself), `expires_at` (7 days).
- Allowlist: `ozone503@gmail.com` (Jessie) and `gavindawson22@gmail.com`
  (Gavin) only, enforced in `api/_auth.js`. Any other email gets the
  same generic reply and no code is sent.

## Provisioning (live push only — not done in this draft)

1. Vercel dashboard → the `saveonbusinessenergy` project → Storage →
   create a Postgres database (Vercel Postgres, or Neon via the
   marketplace). This creates `POSTGRES_URL` / `DATABASE_URL` env vars.
2. Add the `pg` package to the project (`npm i pg`) — the repo has no
   `package.json` today, so this is a real step, not a given.
3. Run once: `psql "$DATABASE_URL" -f lead-engine/schema.sql`
   (or paste `schema.sql` into the database's SQL editor).
4. Verify: the tables exist and are empty (v3: twelve live tables +
   the two retired login tables if you kept them). Do not seed leads or
   contacts.

## Env vars the live version needs

- `POSTGRES_URL` (or `DATABASE_URL`) — Postgres connection string.
  Server-side only, never in browser code or the repo.
- `RESEND_API_KEY` — already exists; used for blast sending only in v3.
  No sign-in codes are sent any more, so no code email is needed.
- `TEX_FROM_EMAIL` — sender for code emails and blasts (default
  `leads@saveonbusinessenergy.com`). Must be a verified Resend sender
  for the emails to arrive — same rule as the ERBOT lead emails.
- `SITE_URL` (optional) — base URL for unsubscribe links in blasts;
  defaults to `https://saveonbusinessenergy.com`.
- Existing, unchanged: `SPEKO_API_KEY`, `TEX_LEAD_EMAIL`,
  `SPEKO_WEBHOOK_SECRET`.
- REMOVED in v2: `LEADS_PASSWORD` — there is no password any more.
  Do not set it; nothing reads it.

## What is NOT in this draft

- No seed data, no sample leads, no sample contacts, no sample campaigns.
- No live sending: `api/blasts.js` builds and previews only until a
  blast is approved + confirmed, and the file is not deployed, so
  nothing can send from this draft.
