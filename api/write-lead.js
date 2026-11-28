// POST /api/write-lead — the scheduled Muse run's write path for hunted leads.
// Same CommonJS style as api/tex-lead.js. No framework. v3: NO AUTH —
// author is audit-only (Jessie / Muse), stored nowhere except the
// directions/questions logs; the write itself carries no author column.
//
// Why this endpoint exists: Muse cannot reach Postgres directly (the
// connection string lives in Vercel env vars, and there is no Neon
// CLI/MCP access from Muse). The run hunts with the browser, then
// writes the sourced leads through this endpoint. The ingest endpoint
// is NOT the write path for hunts — it labels everything
// 'referral upload' / route 'referral-partners', which would mislabel
// hunted leads.
//
// POST { author?, leads: [{ business, city, decision_maker?, title?,
//   email?, phone?, source_url, why_now?, route }] }
//   business: required, as the source names it.
//   city: required. Deregulated Texas only — Houston, Dallas, Fort
//     Worth, Corpus Christi. Austin / San Antonio are rejected.
//   decision_maker / title: only if sourced. Blank if unknown.
//   email / phone: only if sourced. No contact -> lead is written
//     as 'no-contact-yet'. Never guessed, never filled from a
//     similar business.
//   source_url: REQUIRED — a real http(s) URL the claim can be
//     checked against. No source, no lead.
//   why_now: why this business is a fit right now, per the source.
//   route: required, one of 'ercot-queue', 'tx-permits',
//     'maps-comptroller' (routes 1–3 only).
//   Returns { imported, duplicate, skipped: [{row, reason}] }.
//   Dedupe: email in contacts, or business+city in leads. A collision
//   is counted as duplicate, never as a second row and never an error
//   (the DB UNIQUE constraints are the backstop).
//   After writing, today's daily_counts row is refreshed from the
//   real tables — counted, never guessed.
const db = require('./_db');

const ROUTES = ['ercot-queue', 'tx-permits', 'maps-comptroller'];
const OUT_OF_TERRITORY = ['austin', 'san antonio'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/\S+$/;
const MAX_ROWS = 200;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function normalisePhone(v) {
  const digits = clean(v).replace(/\D/g, '');
  return digits || null;
}

async function refreshDailyCounts() {
  const counts = await db.query(
    'SELECT (SELECT COUNT(*)::int FROM contacts WHERE date_added = CURRENT_DATE) AS new_contacts, ' +
      '(SELECT COUNT(*)::int FROM leads WHERE date_found = CURRENT_DATE) AS new_leads'
  );
  const byRoute = await db.query(
    "SELECT route, COUNT(*)::int AS n FROM leads WHERE date_found = CURRENT_DATE GROUP BY route"
  );
  const byContributor = await db.query(
    "SELECT COALESCE(contributed_by, 'hunted') AS who, COUNT(*)::int AS n " +
      'FROM contacts WHERE date_added = CURRENT_DATE GROUP BY contributed_by'
  );
  const routeObj = {};
  for (const r of byRoute.rows) routeObj[r.route] = r.n;
  const contribObj = {};
  for (const r of byContributor.rows) contribObj[r.who] = r.n;
  await db.query(
    'INSERT INTO daily_counts (date, new_contacts, new_leads, by_route, by_contributor) ' +
      'VALUES (CURRENT_DATE, $1, $2, $3, $4) ' +
      'ON CONFLICT (date) DO UPDATE SET new_contacts = EXCLUDED.new_contacts, ' +
      'new_leads = EXCLUDED.new_leads, by_route = EXCLUDED.by_route, ' +
      'by_contributor = EXCLUDED.by_contributor, updated_at = now()',
    [counts.rows[0].new_contacts, counts.rows[0].new_leads,
      JSON.stringify(routeObj), JSON.stringify(contribObj)]
  );
  return {
    new_contacts: counts.rows[0].new_contacts,
    new_leads: counts.rows[0].new_leads,
    target: 200,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON.' });
  }
  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (!leads.length || leads.length > MAX_ROWS) {
    return res.status(400).json({ error: 'leads must have 1 to ' + MAX_ROWS + ' entries.' });
  }

  let imported = 0;
  let duplicate = 0;
  const skipped = [];

  try {
    for (let i = 0; i < leads.length; i++) {
      const row = leads[i] || {};
      const rowNo = i + 1;
      const business = clean(row.business) || null;
      const city = clean(row.city) || null;
      const decisionMaker = clean(row.decision_maker) || null;
      const title = clean(row.title) || null;
      const emailRaw = clean(row.email);
      const email = emailRaw ? emailRaw.toLowerCase() : null;
      const phone = normalisePhone(row.phone);
      const sourceUrl = clean(row.source_url) || null;
      const whyNow = clean(row.why_now) || null;
      const route = clean(row.route) || null;

      if (!business) {
        skipped.push({ row: rowNo, reason: 'No business — nothing to keep.' });
        continue;
      }
      if (!city) {
        skipped.push({ row: rowNo, reason: 'No city — nothing to keep.' });
        continue;
      }
      if (OUT_OF_TERRITORY.includes(city.toLowerCase())) {
        skipped.push({ row: rowNo, reason: 'Out of territory (' + city + ' — Austin / San Antonio are not deregulated). Not imported.' });
        continue;
      }
      if (!sourceUrl || !URL_RE.test(sourceUrl)) {
        skipped.push({ row: rowNo, reason: 'No real source URL — every lead needs one to check against.' });
        continue;
      }
      if (!ROUTES.includes(route)) {
        skipped.push({ row: rowNo, reason: 'Unknown route: ' + (route || '(blank)') + ' — must be ercot-queue, tx-permits, or maps-comptroller.' });
        continue;
      }
      if (email && !EMAIL_RE.test(email)) {
        skipped.push({ row: rowNo, reason: 'Email does not look like an email: ' + emailRaw });
        continue;
      }

      // Dedupe: email in contacts, or business+city in leads.
      let existingContact = null;
      if (email) {
        const c = await db.query('SELECT id, lead_id FROM contacts WHERE email = $1 LIMIT 1', [email]);
        existingContact = c.rows[0] || null;
      }
      let existingLead = null;
      const l = await db.query(
        'SELECT id FROM leads WHERE lower(btrim(business)) = lower(btrim($1)) AND lower(btrim(city)) = lower(btrim($2)) LIMIT 1',
        [business, city]
      );
      existingLead = l.rows[0] || null;
      if (existingContact && existingLead) {
        duplicate += 1;
        continue;
      }
      if (!email && existingLead) {
        duplicate += 1;
        continue;
      }

      // Lead first (when it is new), so the contact can link to it.
      let leadId = existingLead ? existingLead.id : null;
      if (!existingLead) {
        try {
          const ins = await db.query(
            'INSERT INTO leads (business, city, decision_maker, title, contact_email, contact_phone, contact_status, source_url, why_now, route) ' +
              'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [
              business,
              city,
              decisionMaker,
              title,
              email,
              phone,
              email ? 'sourced' : 'no-contact-yet',
              sourceUrl,
              whyNow,
              route,
            ]
          );
          leadId = ins.rows[0].id;
        } catch (err) {
          // Unique collision that slipped past the check above: duplicate.
          if (err.code === '23505') {
            duplicate += 1;
            continue;
          }
          throw err;
        }
      }

      if (email && !existingContact) {
        await db.query(
          'INSERT INTO contacts (email, name, business, city, source, lead_id, consent_status) ' +
            "VALUES ($1, $2, $3, $4, $5, $6, 'unknown')",
          [email, decisionMaker, business, city, 'lead hunt: ' + route, leadId]
        );
      } else if (email && existingContact && leadId && !existingContact.lead_id) {
        await db.query('UPDATE contacts SET lead_id = $1, business = COALESCE(business, $2) WHERE id = $3', [
          leadId,
          business,
          existingContact.id,
        ]);
      }
      imported += 1;
    }

    const today = await refreshDailyCounts();
    return res.status(201).json({
      imported,
      duplicate,
      skipped,
      today,
      db_live: true,
    });
  } catch (err) {
    console.error('write-lead POST failed', err.code || err.message);
    if (err.code === 'DB_NOT_CONFIGURED' || err.code === 'PG_NOT_INSTALLED') {
      return res.status(500).json({ error: 'Database is not set up yet.' });
    }
    return res.status(500).json({ error: 'Could not write leads.' });
  }
};
