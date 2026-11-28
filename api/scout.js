// GET / POST /api/scout — Route Scout's idea log (DRAFT v3). v3: NO AUTH.
// The Scout proposes new creative ways to get leads; the Orchestrator
// tries the best one and logs the result here. Even 20-30 new addresses
// from an idea counts — it is logged, not dismissed.
// GET  -> { ideas: [newest first] }
// POST { idea, source?, proposed_by? } -> creates a 'proposed' idea.
// POST { id, action: 'trying' | 'worked' | 'flopped', result?, addresses_found? }
//      -> updates the idea's outcome. 'worked'/'flopped' require a result note.
const db = require('./_db');
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}
module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const r = await db.query('SELECT * FROM route_ideas ORDER BY created_at DESC LIMIT 100');
      return res.status(200).json({ ideas: r.rows });
    } catch (err) {
      console.error('scout GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load scout ideas.' });
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'Body is not valid JSON.' }); }
  try {
    if (body.action === 'trying' || body.action === 'worked' || body.action === 'flopped') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'An idea id is required.' });
      if (body.action !== 'trying' && !String(body.result || '').trim()) {
        return res.status(400).json({ error: 'Say what happened — a result note is required for worked/flopped.' });
      }
      const r = await db.query(
        "UPDATE route_ideas SET status = $1, result = $2, addresses_found = $3, tried_at = COALESCE(tried_at, now()), updated_at = now() WHERE id = $4 RETURNING *",
        [body.action, String(body.result || '').trim() || null, Math.max(0, parseInt(body.addresses_found, 10) || 0), id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Idea not found.' });
      return res.status(200).json({ idea: r.rows[0] });
    }
    const idea = String(body.idea || '').trim();
    if (!idea) return res.status(400).json({ error: 'An idea is required.' });
    const r = await db.query(
      "INSERT INTO route_ideas (idea, source, proposed_by) VALUES ($1, $2, $3) RETURNING *",
      [idea, String(body.source || '').trim() || null, String(body.proposed_by || 'Route Scout').trim().slice(0, 80)]);
    return res.status(201).json({ idea: r.rows[0] });
  } catch (err) {
    console.error('scout POST failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not save that idea.' });
  }
};
