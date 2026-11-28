// GET / POST /api/memory — the agent's memory.
// Same CommonJS style as api/tex-lead.js. No framework.
// v3: NO AUTH (see _auth.js). No env vars are ever exposed.
//
// GET  ?route=  -> { memory: [newest first] }. Default limit 200.
// POST { key, fact, lesson?, route?, outcome? }            (one row)
// POST { rows: [{ key, fact, lesson?, route?, outcome? }] } (up to 50)
//   -> upserts into memory (INSERT ... ON CONFLICT (key) DO UPDATE).
//   This is the scheduled Muse run's write path for what it learned:
//   route:* lessons, rule:* rules, do-not-repeat:* rejections.
//   Keys are a closed set — anything else is rejected, so a bad write
//   cannot poison what the agent remembers. outcome, when given, must
//   be worked / flopped / mixed. fact is required on every row.

const db = require('./_db');

const KEY_RE = /^(route:[a-z0-9][a-z0-9_-]*|rule:[a-z0-9][a-z0-9_-]*|do-not-repeat:.+)$/i;
const OUTCOMES = ['worked', 'flopped', 'mixed'];
const MAX_ROWS = 50;

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

function publicMemory(row) {
  return {
    id: row.id,
    key: row.key,
    fact: row.fact,
    lesson: row.lesson,
    route: row.route,
    outcome: row.outcome,
    created_at: row.created_at,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const route = String(req.query.route || '');
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1),
      500
    );
    const params = [];
    let where = '';
    if (route) {
      params.push(route);
      where = ' WHERE route = $1';
    }
    params.push(limit);
    const sql =
      'SELECT * FROM memory' + where +
      ' ORDER BY created_at DESC LIMIT $' + params.length;
    try {
      const r = await db.query(sql, params);
      return res.status(200).json({ memory: r.rows.map(publicMemory) });
    } catch (err) {
      console.error('memory GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load memory.' });
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

  const rows = Array.isArray(body.rows) ? body.rows : [body];
  if (!rows.length || rows.length > MAX_ROWS) {
    return res
      .status(400)
      .json({ error: 'rows must have 1 to ' + MAX_ROWS + ' entries.' });
  }

  const skipped = [];
  let written = 0;
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNo = i + 1;
      const key = clean(row.key);
      const fact = clean(row.fact);
      const lesson = clean(row.lesson) || null;
      const route = clean(row.route) || null;
      const outcomeRaw = clean(row.outcome);
      const outcome = outcomeRaw ? outcomeRaw.toLowerCase() : null;

      if (!key || !KEY_RE.test(key)) {
        skipped.push({
          row: rowNo,
          reason:
            'Key must be route:<name>, rule:<name>, or do-not-repeat:<business>|<city> — got: ' +
            (key || '(blank)'),
        });
        continue;
      }
      if (!fact) {
        skipped.push({ row: rowNo, reason: 'fact is required — what happened?' });
        continue;
      }
      if (outcome && !OUTCOMES.includes(outcome)) {
        skipped.push({
          row: rowNo,
          reason: 'outcome must be worked, flopped, or mixed — got: ' + outcomeRaw,
        });
        continue;
      }

      await db.query(
        'INSERT INTO memory (key, fact, lesson, route, outcome) VALUES ($1, $2, $3, $4, $5) ' +
          'ON CONFLICT (key) DO UPDATE SET fact = EXCLUDED.fact, lesson = EXCLUDED.lesson, ' +
          'route = EXCLUDED.route, outcome = EXCLUDED.outcome, updated_at = now()',
        [key, fact, lesson, route, outcome]
      );
      written += 1;
    }
    return res.status(201).json({ written, skipped, db_live: true });
  } catch (err) {
    console.error('memory POST failed', err.code || err.message);
    if (err.code === 'DB_NOT_CONFIGURED' || err.code === 'PG_NOT_INSTALLED') {
      return res.status(500).json({ error: 'Database is not set up yet.' });
    }
    return res.status(500).json({ error: 'Could not write memory.' });
  }
};
