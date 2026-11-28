// Shared Postgres helper for the Lead Engine APIs (live 2026-11-27).
// Same CommonJS style as api/tex-lead.js. No framework.
//
// Requires the `pg` package (NOT installed in this repo yet — see SCHEMA.md)
// and a connection string in POSTGRES_URL or DATABASE_URL, set in Vercel
// (Project Settings -> Environment Variables). Server-side only.
// Never log the connection string. Never return it to the browser.

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString =
    process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
  if (!connectionString) {
    const err = new Error(
      'POSTGRES_URL / DATABASE_URL is not configured on the server.'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  let pg;
  try {
    pg = require('pg');
  } catch {
    const err = new Error(
      'The pg package is not installed. Run `npm i pg` before deploying.'
    );
    err.code = 'PG_NOT_INSTALLED';
    throw err;
  }
  pool = new pg.Pool({ connectionString, max: 5 });
  pool.on('error', (e) => console.error('lead-engine db pool error', e.message));
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params || []);
  } finally {
    client.release();
  }
}

// A row the browser is allowed to see. Strips nothing sensitive today
// (leads carry no secrets), but keeps one place where the allow-list lives
// if a sensitive column is ever added.
function publicLead(row) {
  return {
    id: row.id,
    business: row.business,
    city: row.city,
    decision_maker: row.decision_maker,
    title: row.title,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    contact_status: row.contact_status,
    source_url: row.source_url,
    why_now: row.why_now,
    route: row.route,
    date_found:
      row.date_found instanceof Date
        ? row.date_found.toISOString().slice(0, 10)
        : row.date_found,
    status: row.status,
    created_at: row.created_at,
  };
}

function publicContact(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    business: row.business,
    city: row.city,
    source: row.source,
    contributed_by: row.contributed_by,
    tags: row.tags || [],
    consent_status: row.consent_status,
    unsubscribed: row.unsubscribed,
    date_added:
      row.date_added instanceof Date
        ? row.date_added.toISOString().slice(0, 10)
        : row.date_added,
    created_at: row.created_at,
  };
}

function publicCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    angle: row.angle,
    news_story: row.news_story,
    news_story_url: row.news_story_url,
    pain_point: row.pain_point,
    article_slug: row.article_slug,
    subject_options: row.subject_options || [],
    body_draft: row.body_draft,
    cta: row.cta,
    audience_filter: row.audience_filter || {},
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function publicBlast(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    name: row.name,
    audience_filter: row.audience_filter || {},
    recipient_count: row.recipient_count,
    scheduled_for: row.scheduled_for,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    sent_at: row.sent_at,
    sent_count: row.sent_count,
    status: row.status,
    created_at: row.created_at,
  };
}

function publicUpload(row) {
  return {
    id: row.id,
    contributor_name: row.contributor_name,
    filename: row.filename,
    source_label: row.source_label,
    file_type: row.file_type || 'file',
    rows_total: row.rows_total,
    rows_imported: row.rows_imported,
    rows_duplicate: row.rows_duplicate,
    rows_flagged: row.rows_flagged,
    status: row.status,
    received_at: row.received_at,
    received_by: row.received_by,
  };
}

module.exports = { query, publicLead, publicContact, publicCampaign, publicBlast, publicUpload };
