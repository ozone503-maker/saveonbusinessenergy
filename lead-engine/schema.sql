-- SOBE Lead Engine — schema v3 (DRAFT)
-- Postgres (Vercel Postgres / Neon). Run once against the live database:
--   psql "$DATABASE_URL" -f schema.sql
-- Creates empty tables only. No seed data, no invented leads, no invented contacts.
-- Do NOT run until Postgres is provisioned (see SCHEMA.md).
-- v2 adds, on top of v1 (leads, memory, directions): contributors, contacts,
-- campaigns, blasts, uploads, login_codes, login_sessions, and new columns
-- on leads. v1 tables are untouched by the v2 additions.

-- ---------------------------------------------------------------- leads (v1, unchanged)
-- One row per business. Dedupe is enforced in the database, not just in
-- the agent's head: the same business + city can never be listed twice.
CREATE TABLE IF NOT EXISTS leads (
  id             SERIAL PRIMARY KEY,
  business       TEXT NOT NULL,
  city           TEXT NOT NULL,
  decision_maker TEXT,              -- full name, only if sourced; NULL if unknown
  title          TEXT,              -- e.g. Owner, Facilities Manager; NULL if unknown
  contact_email  TEXT,              -- only if sourced; NULL if not found
  contact_phone  TEXT,              -- only if sourced; NULL if not found
  contact_status TEXT NOT NULL DEFAULT 'no-contact-yet'
    CHECK (contact_status IN ('sourced', 'no-contact-yet')),
  source_url     TEXT NOT NULL,     -- where this lead was found; always required
  why_now        TEXT,              -- why this business is a fit right now
  route          TEXT NOT NULL,     -- e.g. ercot-queue, tx-permits, maps-comptroller
  date_found     DATE NOT NULL DEFAULT CURRENT_DATE,
  status         TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'approved', 'rejected', 'contacted')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business, city)
);

CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads (status);
CREATE INDEX IF NOT EXISTS leads_date_found_idx ON leads (date_found DESC);
CREATE INDEX IF NOT EXISTS leads_route_idx      ON leads (route);
-- Case-insensitive lookup, so the same business name in different cases
-- in the same city still collides instead of slipping in twice.
CREATE INDEX IF NOT EXISTS leads_business_ci_idx
  ON leads (lower(btrim(business)), lower(btrim(city)));

-- ---------------------------------------------------------------- memory (v1, unchanged)
CREATE TABLE IF NOT EXISTS memory (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  fact       TEXT NOT NULL,
  lesson     TEXT,
  route      TEXT,
  outcome    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_route_idx ON memory (route);

-- ---------------------------------------------------------------- directions (v1, unchanged)
CREATE TABLE IF NOT EXISTS directions (
  id          SERIAL PRIMARY KEY,
  author      TEXT NOT NULL CHECK (char_length(btrim(author)) > 0), -- v3: Jessie, Gavin, or a bot name (audit only, not verified)
  text        TEXT NOT NULL CHECK (char_length(btrim(text)) > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'done', 'declined')),
  result_note TEXT
);

CREATE INDEX IF NOT EXISTS directions_status_idx
  ON directions (status, created_at DESC);

-- ---------------------------------------------------------------- v2: contributors
-- Who gave us a list. Every ingested row is labelled with its contributor,
-- so Jessie can always answer "where did this contact come from?"
-- kind is free text in v2: 'referral partner' (e.g. an electrician),
-- 'chamber', 'association', 'client', 'other'.
CREATE TABLE IF NOT EXISTS contributors (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,      -- e.g. 'Jose the electrician' — as Jessie names them
  kind          TEXT,               -- referral partner / chamber / association / client / other
  contact_email TEXT,               -- the contributor's own email, if known (not a lead)
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contributors_name_ci_idx
  ON contributors (lower(btrim(name)));

-- ---------------------------------------------------------------- v2: uploads (ingest batches)
-- One row per file Jessie uploads. The ingest report (imported / duplicate /
-- flagged) lives here, so a bad upload can be audited instead of guessed at.
CREATE TABLE IF NOT EXISTS uploads (
  id              SERIAL PRIMARY KEY,
  contributor_id  INTEGER REFERENCES contributors (id),
  contributor_name TEXT NOT NULL,   -- denormalised copy, so the label survives even if the contributor row changes
  filename        TEXT NOT NULL,
  source_label    TEXT NOT NULL DEFAULT 'referral upload',
  rows_total      INTEGER NOT NULL DEFAULT 0,
  rows_imported   INTEGER NOT NULL DEFAULT 0,
  rows_duplicate  INTEGER NOT NULL DEFAULT 0,
  rows_flagged    INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'done'
    CHECK (status IN ('done', 'partial', 'failed')),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_by     TEXT NOT NULL CHECK (char_length(btrim(received_by)) > 0), -- v3: Jessie, Gavin, or a bot name (audit only)
);

CREATE INDEX IF NOT EXISTS uploads_contributor_idx ON uploads (contributor_id);

-- v2 columns on leads: where the lead came from when it arrived via upload.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contributor_id INTEGER REFERENCES contributors (id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contributed_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS upload_id INTEGER REFERENCES uploads (id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_label TEXT;
CREATE INDEX IF NOT EXISTS leads_contributor_idx ON leads (contributor_id);
CREATE INDEX IF NOT EXISTS leads_upload_idx ON leads (upload_id);

-- ---------------------------------------------------------------- v2: contacts
-- THE giant email repository. Separate from leads: a lead is a business to
-- win; a contact is a person/address we can email. One row per email
-- address, ever. Email is the dedupe key, lowercased at write time.
-- A contact with no email cannot live here (there is nothing to send to);
-- that business stays a lead with contact_status = 'no-contact-yet'.
CREATE TABLE IF NOT EXISTS contacts (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL,    -- always lowercased + trimmed on write
  name            TEXT,             -- person name, only if supplied/sourced
  business        TEXT,             -- business name, if known
  city            TEXT,             -- deregulated Texas only for blasts; other cities are stored, flagged, and excluded from audiences
  source          TEXT NOT NULL,    -- where it came from: 'referral upload', 'lead hunt', 'erbot', 'manual', ...
  contributor_id  INTEGER REFERENCES contributors (id),
  contributed_by  TEXT,             -- e.g. 'Jose the electrician' — the human label, shown on the dashboard
  upload_id       INTEGER REFERENCES uploads (id),
  lead_id         INTEGER REFERENCES leads (id),
  tags            TEXT[] NOT NULL DEFAULT '{}',
  consent_status  TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consent_status IN ('unknown', 'given', 'implied-business', 'withdrawn')),
  unsubscribed    BOOLEAN NOT NULL DEFAULT FALSE,
  unsubscribed_at TIMESTAMPTZ,
  date_added      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS contacts_city_idx ON contacts (lower(btrim(city)));
CREATE INDEX IF NOT EXISTS contacts_contributor_idx ON contacts (contributor_id);
CREATE INDEX IF NOT EXISTS contacts_tags_idx ON contacts USING gin (tags);
CREATE INDEX IF NOT EXISTS contacts_mailable_idx ON contacts (unsubscribed, consent_status)
  WHERE unsubscribed = FALSE;

-- ---------------------------------------------------------------- v2: campaigns
-- One row per campaign idea. A campaign is a draft until Jessie approves
-- its blast — creating a campaign never sends anything.
-- type: 'news' (built around a specific Texas energy news story) or
-- 'pain-point' (built around a pain point from the live articles).
-- audience_filter is JSONB so the Blast Manager can build the exact
-- audience without new code per campaign, e.g.
--   {"cities": ["Houston", "Dallas"], "tags": ["contract-ending"], "exclude_unsubscribed": true}
CREATE TABLE IF NOT EXISTS campaigns (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('news', 'pain-point')),
  angle           TEXT,             -- the argument in one or two sentences
  news_story      TEXT,             -- for type='news': headline + source link, as reported — never invented
  news_story_url  TEXT,
  pain_point      TEXT,             -- for type='pain-point': e.g. 'contract ending', 'summer bill spikes'
  article_slug    TEXT,             -- live article on saveonbusinessenergy.com this campaign points to, if any
  subject_options TEXT[] NOT NULL DEFAULT '{}',
  body_draft      TEXT,             -- draft email body; no savings promise, no 'broker' word
  cta             TEXT NOT NULL DEFAULT 'Get a free review — no fee, no obligation.',
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent', 'archived')),
  created_by      TEXT NOT NULL CHECK (created_by IN ('Jessie', 'Gavin', 'Campaign Writer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_type_idx ON campaigns (type);

-- ---------------------------------------------------------------- v2: blasts
-- One row per weekly megablast (or any blast). The approval gate lives
-- here: status stays 'draft' until Jessie approves it on the hidden page
-- (approved_by + approved_at), and sent_at is only set after a send that
-- was approved. A blast is never sent from 'draft'.
CREATE TABLE IF NOT EXISTS blasts (
  id              SERIAL PRIMARY KEY,
  campaign_id     INTEGER REFERENCES campaigns (id),
  name            TEXT NOT NULL,    -- e.g. 'Weekly megablast — week of Dec 7'
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipient_count INTEGER NOT NULL DEFAULT 0,  -- counted at build time, shown before approval
  scheduled_for   TIMESTAMPTZ,
  approved_by     TEXT, -- v3: Jessie, Gavin, or a bot name (audit only)
  approved_at     TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'queued', 'sent', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blasts_status_idx ON blasts (status);
CREATE INDEX IF NOT EXISTS blasts_campaign_idx ON blasts (campaign_id);

-- ---------------------------------------------------------------- v3: agents (live inside the website)
-- Agents are NOT code. Each agent is a row here, and each rebuild is a
-- new version row. The next scheduled run reads the CURRENT version of
-- each agent from this table and runs with those instructions.
-- previous_version_id chains the history so any version can be restored
-- by pointing current_version_id back at it.
CREATE TABLE IF NOT EXISTS agents (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,      -- e.g. 'Hunter', 'Route Scout', 'Campaign Writer'
  role               TEXT NOT NULL,      -- one-line role
  current_version    INTEGER NOT NULL DEFAULT 1,
  current_version_id INTEGER,           -- FK to agent_versions, set after the first version row
  updated_by         TEXT,               -- Jessie, Gavin, or a bot name (audit only)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_name_ci_idx ON agents (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS agent_versions (
  id                  SERIAL PRIMARY KEY,
  agent_id            INTEGER NOT NULL REFERENCES agents (id),
  version             INTEGER NOT NULL,
  role                TEXT NOT NULL,
  instructions        TEXT NOT NULL,     -- parsed instructions for this version
  source_text         TEXT NOT NULL,     -- the pasted chunk, verbatim as received
  updated_by          TEXT,              -- who pushed it (audit only)
  source              TEXT,              -- where the text came from: Jessie, pasted in
  previous_version_id INTEGER,           -- version number of the version this replaced (NULL for v1)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
CREATE INDEX IF NOT EXISTS agent_versions_agent_idx ON agent_versions (agent_id, version DESC);

-- ---------------------------------------------------------------- v3: route_ideas (Route Scout's log)
-- One row per creative lead-finding idea. Small wins count: 20-30 new
-- addresses from a new idea is a contribution, and the Orchestrator
-- counts it toward the 200/day goal.
CREATE TABLE IF NOT EXISTS route_ideas (
  id              SERIAL PRIMARY KEY,
  idea            TEXT NOT NULL,        -- the new source / angle, in plain words
  source          TEXT,                 -- where the idea came from (who/what suggested it)
  proposed_by     TEXT NOT NULL DEFAULT 'Route Scout',
  status          TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'trying', 'worked', 'flopped')),
  tried_at        TIMESTAMPTZ,
  result          TEXT,                 -- what happened when it was tried
  addresses_found INTEGER NOT NULL DEFAULT 0, -- deduped new addresses this idea produced
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_ideas_status_idx ON route_ideas (status, created_at DESC);

-- ---------------------------------------------------------------- v3: daily_counts (goal tracker — 200 new addresses/day)
-- One row per day, counted — never guessed. new_contacts counts ONLY
-- deduped, newly added contacts with a real email (contacts.date_added).
-- new_leads counts deduped new business leads (leads.date_found).
-- The Orchestrator writes (or refreshes) today's row at the end of each
-- run; the dashboard reads it. target is 200, every day.
CREATE TABLE IF NOT EXISTS daily_counts (
  date           DATE PRIMARY KEY,
  new_contacts   INTEGER NOT NULL DEFAULT 0,
  new_leads      INTEGER NOT NULL DEFAULT 0,
  by_route       JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {"ercot-queue": 40, "route-scout:…": 25}
  by_contributor JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {"Jose the electrician": 30}
  target         INTEGER NOT NULL DEFAULT 200,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- v3: login tables RETIRED
-- login_codes / login_sessions are UNUSED from v3 on. Auth was removed
-- 2026-11-27 (Jessie: no security need — nobody else knows the address).
-- The tables below are kept in this file so a database created from v2
-- does not break on a missing-table reference; they are never read or
-- written by any v3 endpoint. Do not create them on a fresh database
-- unless you need them for history. Fresh installs may skip this block.
-- login_codes: one-time 6-digit codes. Only the SHA-256 hash is stored —
-- never the code itself. 15-minute expiry, single use (used_at).
-- login_sessions: the cookie session. Only the SHA-256 hash of a random
-- 32-byte token is stored — never the token itself. 7-day expiry.
CREATE TABLE IF NOT EXISTS login_codes (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,          -- lowercased; must be an allowlisted address
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_codes_email_idx ON login_codes (lower(btrim(email)), expires_at);

CREATE TABLE IF NOT EXISTS login_sessions (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,          -- lowercased; allowlisted address only
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_sessions_token_idx ON login_sessions (token_hash);
CREATE INDEX IF NOT EXISTS login_sessions_email_idx ON login_sessions (lower(btrim(email)));

-- ---------------------------------------------------------------- updated_at triggers
CREATE OR REPLACE FUNCTION lead_engine_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_touch ON leads;
CREATE TRIGGER leads_touch
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();

DROP TRIGGER IF EXISTS memory_touch ON memory;
CREATE TRIGGER memory_touch
  BEFORE UPDATE ON memory
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();

DROP TRIGGER IF EXISTS contacts_touch ON contacts;
CREATE TRIGGER contacts_touch
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();

DROP TRIGGER IF EXISTS campaigns_touch ON campaigns;
CREATE TRIGGER campaigns_touch
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();

DROP TRIGGER IF EXISTS blasts_touch ON blasts;
CREATE TRIGGER blasts_touch
  BEFORE UPDATE ON blasts
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();

DROP TRIGGER IF EXISTS agents_touch ON agents;
CREATE TRIGGER agents_touch
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();
DROP TRIGGER IF EXISTS route_ideas_touch ON route_ideas;
CREATE TRIGGER route_ideas_touch
  BEFORE UPDATE ON route_ideas
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();
DROP TRIGGER IF EXISTS daily_counts_touch ON daily_counts;
CREATE TRIGGER daily_counts_touch
  BEFORE UPDATE ON daily_counts
  FOR EACH ROW EXECUTE FUNCTION lead_engine_touch_updated_at();
