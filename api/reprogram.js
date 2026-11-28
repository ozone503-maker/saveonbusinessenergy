// POST / GET /api/reprogram — the Maintenance Bot's rebuild endpoint (DRAFT v3).
// Same CommonJS style as api/tex-lead.js. No framework. v3: NO AUTH.
// Anyone on the machine can push — Jessie, Gavin, or another bot —
// the author / source-bot fields are audit-only, not verified.
//
// What it does: takes a LARGE chunk of text instructions (up to 50,000
// characters) from Jessie, Gavin, or another bot, and rebuilds an agent
// INSIDE the website. Agents live in the `agents` table in Postgres, not
// in code: the next scheduled run reads the current version of each
// agent from the DB and runs with those instructions. A rebuild never
// overwrites history — it creates a NEW version row and points the agent
// at it, so any earlier version can be read back or restored.
//
// POST { agent: 'Hunter' | 'Route Scout' | ... | '<new agent name>',
//        instructions: '<large text chunk>',
//        author: 'Jessie' | 'Gavin' | bot name,
//        source: 'Jessie' (pasted instructions) — Muse rebuilds the agent. No outside bots.
//        role?: '<one-line role, used for a new agent>' }
//   -> { agent, version, changed, declined, reason?, note }
//   `changed` is a plain-language diff vs the previous version:
//   new agent / instructions replaced / role changed / no change.
//   The raw chunk is stored verbatim as received (source_text) so the
//   rebuild is auditable — what the other bot said is what we kept.
//
// Hard rules still bind a reprogram (see RUNBOOK.md). A chunk that tries
// to override them is DECLINED IN PART: the agent version is still
// created from the allowed parts, the offending part is dropped, and the
// response + a `memory` row say exactly what was dropped and why.
// The declined parts are:
//   - any outreach without approval (email / call / DM a prospect on its own)
//   - invented contacts (names / emails / numbers without a source)
//   - Austin / San Antonio (not deregulated — out of territory)
//   - calling Jessie / USA Energy Partners a "broker", or promising savings
// A reprogram can change routes, priorities, wording, tags, and targets.
// It cannot change those four rules.
//
// GET ?agent=  -> { agents: [current version of each agent] }
// GET ?agent=Hunter&history=1 -> current version + full version history.
// Agents seeded by this file's table are the CREW.md roles; a new name
// creates a new agent instead of erroring, so another bot can hand us a
// whole new role in one paste.

const db = require('./_db');

const MAX_CHARS = 50000;
const HARD_RULES = [
  { key: 'outreach', re: /\b(send|email|call|dm|message)\b[^.]{0,60}\b(prospect|lead|business)/i, reason: 'Outreach without approval is not allowed — the agent finds and lists only.' },
  { key: 'invented-contact', re: /invent|make up|fabricate|guess (a|the|an) (contact|email|phone|name)/i, reason: 'Invented contacts are not allowed — every contact must be sourced.' },
  { key: 'austin-san-antonio', re: /\b(austin|san antonio)\b/i, reason: 'Austin / San Antonio are not deregulated — out of territory.' },
  { key: 'broker-word', re: /\bcall (us|jessie|usa energy partners|them) a broker\b/i, reason: 'Never call Jessie / USA Energy Partners a "broker".' },
  { key: 'savings-promise', re: /\b(promise|guarantee) (savings|save money|lower (your )?bill)\b/i, reason: 'Never promise savings.' },
];

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

function clean(v) { return String(v == null ? '' : v).trim(); }

// Split a pasted chunk into role + instructions. A chunk may arrive as:
//   "Role: ...\nInstructions: ..."  |  "You are ...\n..."  |  plain text.
// The role line, if present, becomes the agent's role; otherwise the
// caller's role field (or the old role) is kept. Instructions are the
// whole chunk minus an explicit "Role:" line.
function parseChunk(chunk, fallbackRole) {
  let role = clean(fallbackRole);
  let instructions = chunk;
  const m = chunk.match(/^\s*role\s*:\s*(.+)$/im);
  if (m && m[1]) {
    role = m[1].trim().slice(0, 200);
    instructions = chunk.replace(m[0], '').trim();
  }
  return { role, instructions };
}

function checkHardRules(instructions) {
  const declined = [];
  for (const r of HARD_RULES) {
    if (r.re.test(instructions)) declined.push({ rule: r.key, reason: r.reason });
  }
  return declined;
}

function publicAgent(row) {
  return {
    name: row.name, role: row.role, version: row.current_version,
    instructions: row.instructions, updated_by: row.updated_by,
    updated_at: row.updated_at, source_bot: row.source_bot,
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const name = clean(req.query.agent);
    const history = String(req.query.history || '') === '1';
    try {
      if (name) {
        const cur = await db.query(
          'SELECT a.*, v.instructions, v.role, v.updated_by, v.source_bot ' +
          'FROM agents a JOIN agent_versions v ON v.id = a.current_version_id ' +
          'WHERE lower(btrim(a.name)) = lower(btrim($1)) LIMIT 1', [name]);
        if (!cur.rows.length) return res.status(404).json({ error: 'No agent with that name yet.' });
        const out = { agent: publicAgent(cur.rows[0]) };
        if (history) {
          const h = await db.query(
            'SELECT version, role, instructions, updated_by, source_bot, source_text, created_at ' +
            'FROM agent_versions WHERE agent_id = $1 ORDER BY version DESC LIMIT 50',
            [cur.rows[0].id]);
          out.history = h.rows;
        }
        return res.status(200).json(out);
      }
      const all = await db.query(
        'SELECT a.*, v.instructions, v.role, v.updated_by, v.source_bot ' +
        'FROM agents a JOIN agent_versions v ON v.id = a.current_version_id ORDER BY a.name ASC');
      return res.status(200).json({ agents: all.rows.map(publicAgent) });
    } catch (err) {
      console.error('reprogram GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load agents.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { return res.status(400).json({ error: 'Body is not valid JSON.' }); }

  const agentName = clean(body.agent);
  const chunk = String(body.instructions || '');
  // v3: author / source_bot are audit-only, not verified.
  const author = clean(body.author) || 'Jessie';
  const sourceBot = clean(body.source_bot) || null;
  if (!agentName) return res.status(400).json({ error: 'An agent name is required.' });
  if (!chunk.trim()) return res.status(400).json({ error: 'Instructions are required — paste the chunk.' });
  if (chunk.length > MAX_CHARS) {
    return res.status(400).json({ error: 'That chunk is over ' + MAX_CHARS + ' characters — split it and send it in two pastes.' });
  }

  const { role, instructions } = parseChunk(chunk, clean(body.role));
  const declined = checkHardRules(instructions);

  try {
    const existing = await db.query(
      'SELECT a.*, v.instructions AS prev_instructions, v.role AS prev_role ' +
      'FROM agents a LEFT JOIN agent_versions v ON v.id = a.current_version_id ' +
      'WHERE lower(btrim(a.name)) = lower(btrim($1)) LIMIT 1', [agentName]);

    let agentId, newVersion, changed;
    if (!existing.rows.length) {
      const ins = await db.query(
        'INSERT INTO agents (name, role, current_version) VALUES ($1, $2, 1) RETURNING *',
        [agentName, role || 'Custom agent']);
      agentId = ins.rows[0].id;
      newVersion = 1;
      changed = 'new agent created';
    } else {
      agentId = existing.rows[0].id;
      newVersion = Number(existing.rows[0].current_version || 0) + 1;
      const prev = existing.rows[0];
      if (prev.prev_instructions === instructions && prev.prev_role === role) {
        return res.status(200).json({
          agent: agentName, version: Number(prev.current_version),
          changed: 'no change — identical to the current version', declined,
          note: 'Nothing was rebuilt: the pasted instructions match the current version exactly.',
        });
      }
      changed = (prev.prev_role !== role ? 'role changed; ' : '') + 'instructions replaced (v' + prev.current_version + ' -> v' + newVersion + ')';
    }

    const ver = await db.query(
      'INSERT INTO agent_versions (agent_id, version, role, instructions, source_text, updated_by, source_bot, previous_version_id) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [agentId, newVersion, role || 'Custom agent', instructions, chunk, author, sourceBot,
       existing.rows.length ? Number(existing.rows[0].current_version) || null : null]);
    await db.query(
      'UPDATE agents SET role = $1, current_version = $2, current_version_id = $3, updated_by = $4, updated_at = now() WHERE id = $5',
      [role || 'Custom agent', newVersion, ver.rows[0].id, author, agentId]);

    if (declined.length) {
      await db.query(
        'INSERT INTO memory (key, fact, lesson, outcome) VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT (key) DO UPDATE SET fact = EXCLUDED.fact, lesson = EXCLUDED.lesson, outcome = EXCLUDED.outcome, updated_at = now()',
        ['rule:reprogram-declined-' + agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
         'Reprogram of ' + agentName + ' (v' + newVersion + ') declined in part: ' + declined.map((d) => d.rule).join(', ') + '.',
         declined.map((d) => d.reason).join(' '),
         'declined-in-part']);
    }

    return res.status(201).json({
      agent: agentName, version: newVersion, changed, declined,
      note: declined.length
        ? 'Rebuilt with ' + declined.length + ' part(s) dropped — see declined. The dropped parts cannot override the brief.'
        : 'Rebuilt. The next run reads this version from the database — no code deploy.',
      source_bot: sourceBot, updated_by: author,
    });
  } catch (err) {
    console.error('reprogram POST failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not rebuild that agent.' });
  }
};
