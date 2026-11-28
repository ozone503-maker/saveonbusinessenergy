// POST / GET /api/ingest — eat entire mailing lists (DRAFT v2 — not live).
// Same CommonJS style as api/tex-lead.js. No framework. Auth required.
//
// The browser (leads.html) parses the uploaded CSV in the browser and
// POSTs JSON rows — the server never parses multipart uploads, and .xlsx
// files must be exported to CSV first (see the Upload section on the
// dashboard; that limit is documented, not hidden).
//
// POST { contributor_name, contributor_kind?, filename?, rows: [...] }
//   contributor_name is REQUIRED and is the label on every row — e.g.
//   'Jose the electrician'. A contributor row is created on first use.
//   Each row: { name?, business?, email?, phone?, city? }.
//   Rules, in order per row:
//     1. No business AND no email -> flagged, not imported.
//     2. Email present but not a plausible email -> flagged, not imported.
//     3. City is Austin or San Antonio -> flagged (out of territory),
//        not imported as a lead. It is not silently dropped: it comes
//        back in the flagged list for Jessie to review.
//     4. Email already in contacts (case-insensitive) -> duplicate.
//        Business+city already in leads -> duplicate (contact is still
//        linked to the existing lead when the email is new).
//     5. Otherwise: insert the contact (email lowercased, source
//        'referral upload', contributed_by = contributor, consent_status
//        'unknown' — an uploaded list is NOT consent, and the blast
//        builder treats it that way) and, when a business is given,
//        insert the lead with contact_status 'sourced' or 'no-contact-yet'.
//   Nothing is invented: a missing field stays missing. A row with no
//   email becomes a lead only (no contact row — there is nothing to send to).
// GET  -> { uploads: [...], contributors: [...] } (newest first).

const db = require('./_db');

const MAX_ROWS = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OUT_OF_TERRITORY = ['austin', 'san antonio'];

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

module.exports = async function handler(req, res) {
  // v3: no auth. received_by is the body's author field (audit only, not verified).

  if (req.method === 'GET') {
    try {
      const uploads = await db.query(
        'SELECT * FROM uploads ORDER BY received_at DESC LIMIT 50'
      );
      const contributors = await db.query(
        'SELECT c.*, (SELECT COUNT(*) FROM contacts WHERE contributor_id = c.id) AS contact_count, ' +
          '(SELECT COUNT(*) FROM leads WHERE contributor_id = c.id) AS lead_count ' +
          'FROM contributors c ORDER BY c.name ASC'
      );
      return res.status(200).json({
        uploads: uploads.rows.map(db.publicUpload),
        contributors: contributors.rows,
      });
    } catch (err) {
      console.error('ingest GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load uploads.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON.' });
  }

  // v3: author is audit-only (Jessie / Gavin / bot name), stored verbatim.
  const receivedBy = String(body.author || 'Jessie').trim().slice(0, 80) || 'Jessie';
  const contributorName = clean(body.contributor_name);
  const filename = clean(body.filename) || 'upload.csv';
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!contributorName) {
    return res.status(400).json({ error: 'contributor_name is required — who gave us this list?' });
  }
  if (!rows.length || rows.length > MAX_ROWS) {
    return res.status(400).json({ error: 'rows must have 1 to ' + MAX_ROWS + ' entries.' });
  }

  try {
    const contrib = await db.query(
      'INSERT INTO contributors (name, kind) VALUES ($1, $2) ' +
        'ON CONFLICT (lower(btrim(name))) DO UPDATE SET name = EXCLUDED.name RETURNING *',
      [contributorName, clean(body.contributor_kind) || 'referral partner']
    );
    const contributor = contrib.rows[0];

    const upload = await db.query(
      "INSERT INTO uploads (contributor_id, contributor_name, filename, source_label, rows_total, received_by) " +
        "VALUES ($1, $2, $3, 'referral upload', $4, $5) RETURNING *",
      [contributor.id, contributorName, filename, rows.length, receivedBy]
    );
    const uploadId = upload.rows[0].id;

    let imported = 0;
    let duplicate = 0;
    const flagged = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const name = clean(row.name) || null;
      const business = clean(row.business) || null;
      const emailRaw = clean(row.email);
      const email = emailRaw ? emailRaw.toLowerCase() : null;
      const phone = normalisePhone(row.phone);
      const city = clean(row.city) || null;
      const rowNo = i + 1;

      if (!business && !email) {
        flagged.push({ row: rowNo, reason: 'No business and no email — nothing to keep.' });
        continue;
      }
      if (email && !EMAIL_RE.test(email)) {
        flagged.push({ row: rowNo, reason: 'Email does not look like an email: ' + emailRaw });
        continue;
      }
      if (city && OUT_OF_TERRITORY.includes(city.toLowerCase())) {
        flagged.push({ row: rowNo, reason: 'Out of territory (' + city + ' — Austin / San Antonio are not deregulated). Not imported.' });
        continue;
      }

      // Dedupe: email in contacts, or business+city in leads.
      let existingContact = null;
      if (email) {
        const c = await db.query('SELECT id, lead_id FROM contacts WHERE email = $1 LIMIT 1', [email]);
        existingContact = c.rows[0] || null;
      }
      let existingLead = null;
      if (business && city) {
        const l = await db.query(
          'SELECT id FROM leads WHERE lower(btrim(business)) = lower(btrim($1)) AND lower(btrim(city)) = lower(btrim($2)) LIMIT 1',
          [business, city]
        );
        existingLead = l.rows[0] || null;
      }
      if (existingContact && (!business || existingLead)) {
        duplicate += 1;
        continue;
      }
      if (!email && existingLead) {
        duplicate += 1;
        continue;
      }

      // Lead first (when there is a business), so the contact can link to it.
      let leadId = existingLead ? existingLead.id : null;
      if (business && !existingLead) {
        const sourceUrl = 'referral upload: ' + contributorName + ' — ' + filename;
        try {
          const l = await db.query(
            'INSERT INTO leads (business, city, contact_email, contact_phone, contact_status, source_url, why_now, route, contributor_id, contributed_by, upload_id, source_label) ' +
              "VALUES ($1, $2, $3, $4, $5, $6, $7, 'referral-partners', $8, $9, $10, 'referral upload') RETURNING id",
            [
              business,
              city || 'Unknown',
              email,
              phone,
              email ? 'sourced' : 'no-contact-yet',
              sourceUrl,
              'Referred by ' + contributorName + ' — supplied on a mailing list.',
              contributor.id,
              contributorName,
              uploadId,
            ]
          );
          leadId = l.rows[0].id;
        } catch (err) {
          // Unique collision that slipped past the check above: count as duplicate.
          if (err.code === '23505') {
            duplicate += 1;
            continue;
          }
          throw err;
        }
      }

      if (email && !existingContact) {
        await db.query(
          'INSERT INTO contacts (email, name, business, city, source, contributor_id, contributed_by, upload_id, lead_id, consent_status) ' +
            "VALUES ($1, $2, $3, $4, 'referral upload', $5, $6, $7, $8, 'unknown')",
          [email, name, business, city, contributor.id, contributorName, uploadId, leadId]
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

    const status = flagged.length && !imported ? 'failed' : flagged.length ? 'partial' : 'done';
    await db.query(
      'UPDATE uploads SET rows_imported = $1, rows_duplicate = $2, rows_flagged = $3, status = $4 WHERE id = $5',
      [imported, duplicate, flagged.length, status, uploadId]
    );

    return res.status(201).json({
      upload_id: uploadId,
      contributor: contributorName,
      rows_total: rows.length,
      rows_imported: imported,
      rows_duplicate: duplicate,
      rows_flagged: flagged.length,
      flagged: flagged.slice(0, 100),
      status,
    });
  } catch (err) {
    console.error('ingest POST failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not import the list.' });
  }
};
