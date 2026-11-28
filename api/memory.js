// GET /api/memory — read the agent's memory (DRAFT — not live).
// Same CommonJS style as api/tex-lead.js. No framework.
// v3: NO AUTH (see _auth.js). No env vars are ever exposed.
// Read-only in v1: memory is WRITTEN by the scheduled Muse run
// (see RUNBOOK.md), not from the browser, so a bad write cannot
// poison what the agent remembers.
//
// GET  ?route=  -> { memory: [newest first] }. Default limit 200.

const db = require('./_db');

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

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
};
