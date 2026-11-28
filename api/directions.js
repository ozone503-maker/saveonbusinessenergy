// GET / POST /api/directions — Jessie & Gavin steer the agent (DRAFT).
// Same CommonJS style as api/tex-lead.js. No framework.
// v3: NO AUTH (see _auth.js) — anyone on the machine can push. No env vars are ever exposed.
//
// GET  -> { directions: [newest first, new ones first] }.
// POST { author: 'Jessie' | 'Gavin' | bot name, text } — author is audit-only, not verified.
//      -> inserts a direction with status 'new'. The scheduled Muse run
//         reads status='new' first, acts, then marks it 'done' with a
//         result_note — or 'declined' with the reason.
// Status changes are NOT done from the browser in v1; the run owns them.

const db = require('./_db');

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

function publicDirection(row) {
  return {
    id: row.id,
    author: row.author,
    text: row.text,
    created_at: row.created_at,
    status: row.status,
    result_note: row.result_note,
  };
}

module.exports = async function handler(req, res) {

  if (req.method === 'GET') {
    try {
      const r = await db.query(
        "SELECT * FROM directions ORDER BY (status = 'new') DESC, created_at DESC LIMIT 100"
      );
      return res.status(200).json({ directions: r.rows.map(publicDirection) });
    } catch (err) {
      console.error('directions GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load directions.' });
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'Body is not valid JSON.' });
    }
    // v3: author is audit-only — 'Jessie' or 'Muse' for now; 'Gavin' joins later.
    const author = String(body.author || 'Jessie').trim().slice(0, 80) || 'Jessie';
    const text = String(body.text || '').trim();
    if (!text || text.length > 2000) {
      return res.status(400).json({ error: 'Direction text is required (max 2000 characters).' });
    }
    try {
      const r = await db.query(
        "INSERT INTO directions (author, text, status) VALUES ($1, $2, 'new') RETURNING *",
        [author, text]
      );
      return res.status(201).json({ direction: publicDirection(r.rows[0]) });
    } catch (err) {
      console.error('directions POST failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not save direction.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
