// GET /api/agents — read the Lead Engine crew (the agents table).
// Same CommonJS style as api/tex-lead.js. No framework.
// v3: NO AUTH (see _auth.js). No env vars are ever exposed.
//
// Why this endpoint exists: the scheduled run's step 0 reads the current
// agents from the database, and Muse cannot reach Postgres directly (the
// connection string lives in Vercel env vars, and there is no Neon
// CLI/MCP access from Muse). Before this endpoint the run had no read
// path for agents at all and fell back to CREW.md.
//
// GET  -> { agents: [ordered by name] }.
// GET  ?name=Hunter  -> { agents: [that one agent, if it exists] }.
// Read-only. Seeding and reprogramming go through POST /api/reprogram.

const db = require('./_db');

function publicAgent(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    current_version: row.current_version,
    current_version_id: row.current_version_id,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const name = String(req.query.name || '').trim();
  const params = [];
  let where = '';
  if (name) {
    params.push(name);
    where = ' WHERE lower(btrim(name)) = lower(btrim($1))';
  }
  const sql = 'SELECT * FROM agents' + where + ' ORDER BY name ASC';
  try {
    const r = await db.query(sql, params);
    return res.status(200).json({ agents: r.rows.map(publicAgent) });
  } catch (err) {
    console.error('agents GET failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not load agents.' });
  }
};
