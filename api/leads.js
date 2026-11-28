// GET / POST /api/leads — lead list + approve/reject (DRAFT — not live).
// Same CommonJS style as api/tex-lead.js. No framework.
// v3: NO AUTH (see _auth.js) — anyone on the machine can push. No env vars are ever exposed.
//
// GET  ?status=new|approved|rejected|contacted &route=&city=&limit=
//      -> { leads: [public lead rows, newest first] }. Default limit 100.
// POST { id, action: 'approve' | 'reject' }
//      -> sets status to approved / rejected. Returns the updated lead.
//      'contacted' is NOT settable here — only Jessie can mark a lead
//      contacted, after he explicitly approves outreach, and the agent
//      never does outreach on its own (see RUNBOOK.md).
// There is deliberately no POST that creates a lead from the browser:
// leads are written by the scheduled Muse run, after sourcing.

const db = require('./_db');

const STATUSES = ['new', 'approved', 'rejected', 'contacted'];

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

module.exports = async function handler(req, res) {

  if (req.method === 'GET') {
    const status = String(req.query.status || '');
    const route = String(req.query.route || '');
    const city = String(req.query.city || '');
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1),
      200
    );
    const where = [];
    const params = [];
    if (status) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Unknown status.' });
      }
      params.push(status);
      where.push('status = $' + params.length);
    }
    if (route) {
      params.push(route);
      where.push('route = $' + params.length);
    }
    if (city) {
      params.push(city);
      where.push('lower(btrim(city)) = lower(btrim($' + params.length + '))');
    }
    params.push(limit);
    const sql =
      'SELECT * FROM leads' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY date_found DESC, id DESC LIMIT $' + params.length;
    try {
      const r = await db.query(sql, params);
      return res.status(200).json({ leads: r.rows.map(db.publicLead) });
    } catch (err) {
      console.error('leads GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load leads.' });
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'Body is not valid JSON.' });
    }
    const id = Number(body.id);
    const action = String(body.action || '');
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'A valid lead id is required.' });
    }
    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
    if (!nextStatus) {
      return res.status(400).json({ error: "Action must be 'approve' or 'reject'." });
    }
    try {
      const r = await db.query(
        'UPDATE leads SET status = $1 WHERE id = $2 RETURNING *',
        [nextStatus, id]
      );
      if (!r.rows.length) {
        return res.status(404).json({ error: 'Lead not found.' });
      }
      // A rejected lead becomes a do-not-repeat memory row, so the next
      // run never re-adds it. The runbook owns that write; the API only
      // records the decision. If the memory write is ever moved here,
      // it must use the business + city from this same row.
      return res.status(200).json({ lead: db.publicLead(r.rows[0]) });
    } catch (err) {
      console.error('leads POST failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not update lead.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
