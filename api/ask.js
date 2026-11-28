// POST /api/ask — Lead Agent (admin assistant). No framework. v4: NO AUTH.
// Gavin or Jessie asks a question about the list and gets a fast answer
// from the real numbers in Postgres. No LLM call — the answer is computed
// from database rows. The answer is never invented: if the question cannot
// be answered from the database, the reply says so in plain words and
// lists the questions it CAN answer.
// POST {question, author} -> {answer, numbers, source, db_live}
// If the database is not set up yet, the answer is the honest
// "no numbers yet" message — never a made-up number.
// Every question + answer is logged to the `questions` table (best effort:
// a logging failure never blocks the answer).
const db = require('./_db');

const CAN_ANSWER = [
  'How many emails total?',
  'How many in Dallas? (any city works)',
  'How many leads total?',
  'How many today? (vs the 200 goal)',
  'What are the latest pain points?',
  'What are the latest leads?',
  'How many unsubscribed?',
  'Who gave us lists?',
];

const KNOWN_CITIES = [
  'corpus christi', 'fort worth', 'san antonio', 'houston', 'dallas', 'austin',
];

function extractCity(q) {
  for (const c of KNOWN_CITIES) {
    if (q.indexOf(c) !== -1) return c;
  }
  const m = q.match(/\bin\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (m) {
    const city = m[1].replace(/\b(total|many|emails?|leads?|there|are|we|have|do)\b/g, '').trim();
    return city || null;
  }
  return null;
}

function titleCity(city) {
  return city.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Pure function: question -> {intent, city}. Exported for local testing.
function detectIntent(question) {
  const q = String(question || '').toLowerCase().replace(/[^a-z0-9\s?]/g, ' ').replace(/\s+/g, ' ').trim();
  const city = extractCity(q);
  if (/\bpain\b/.test(q) || /\bsore spot/.test(q)) return { intent: 'painPoints', city: null };
  if (/unsubscrib/.test(q)) return { intent: 'unsubscribed', city: null };
  if (/\btoday\b/.test(q) || /\b200\b/.test(q) || /goal/.test(q)) return { intent: 'today', city: null };
  if (/who gave|contributor|who sent|who shared/.test(q)) return { intent: 'contributors', city: null };
  if (/(latest|newest|recent)\b/.test(q) && /lead/.test(q)) return { intent: 'latestLeads', city: null };
  if (/how many/.test(q) && /lead|business/.test(q)) return { intent: 'leadsTotal', city: null };
  if (/how many/.test(q) && city) return { intent: 'cityEmails', city };
  if (/how many/.test(q) && /email|address|contact/.test(q)) return { intent: 'totalEmails', city: null };
  if (/how many/.test(q)) return { intent: 'totalEmails', city: null };
  return { intent: 'help', city: null };
}

function helpAnswer() {
  return 'I don\'t have that from the list yet — here is what I can tell you:\n' +
    CAN_ANSWER.map((x) => '• ' + x).join('\n');
}

async function answerQuestion(question) {
  const { intent, city } = detectIntent(question);
  let r;
  switch (intent) {
    case 'totalEmails': {
      r = await db.query(
        'SELECT (SELECT COUNT(*)::int FROM contacts WHERE unsubscribed = false) AS mailable, ' +
        '(SELECT COUNT(*)::int FROM contacts) AS total');
      const row = r.rows[0];
      return {
        answer: 'We have ' + row.total + ' emails in the list, ' + row.mailable +
          ' of them still on it (the rest asked to stop getting email).',
        numbers: { total: row.total, mailable: row.mailable },
        source: 'contacts table',
      };
    }
    case 'cityEmails': {
      const name = titleCity(city);
      r = await db.query(
        'SELECT (SELECT COUNT(*)::int FROM contacts WHERE unsubscribed = false AND lower(btrim(city)) = lower($1)) AS mailable, ' +
        '(SELECT COUNT(*)::int FROM contacts WHERE lower(btrim(city)) = lower($1)) AS total, ' +
        '(SELECT COUNT(*)::int FROM leads WHERE lower(btrim(city)) = lower($1)) AS leads',
        [city]);
      const row = r.rows[0];
      return {
        answer: 'In ' + name + ': ' + row.total + ' emails (' + row.mailable +
          ' still on the list) and ' + row.leads + ' leads.',
        numbers: { city: name, total: row.total, mailable: row.mailable, leads: row.leads },
        source: 'contacts and leads tables',
      };
    }
    case 'leadsTotal': {
      r = await db.query('SELECT COUNT(*)::int AS n FROM leads');
      const n = r.rows[0].n;
      return {
        answer: 'We have ' + n + ' leads in total.',
        numbers: { leads: n },
        source: 'leads table',
      };
    }
    case 'today': {
      r = await db.query(
        'SELECT new_contacts, new_leads, target FROM daily_counts WHERE date = CURRENT_DATE');
      let today;
      if (r.rows.length) {
        today = r.rows[0];
      } else {
        const live = await db.query(
          'SELECT (SELECT COUNT(*)::int FROM contacts WHERE date_added = CURRENT_DATE) AS new_contacts, ' +
          '(SELECT COUNT(*)::int FROM leads WHERE date_found = CURRENT_DATE) AS new_leads');
        today = { new_contacts: live.rows[0].new_contacts, new_leads: live.rows[0].new_leads, target: 200 };
      }
      const left = Math.max(0, today.target - today.new_contacts);
      return {
        answer: 'Today: ' + today.new_contacts + ' new emails of the ' + today.target +
          ' goal (' + today.new_leads + ' new leads). ' +
          (left > 0 ? left + ' still to go.' : 'Goal hit for today.'),
        numbers: { new_contacts: today.new_contacts, new_leads: today.new_leads, target: today.target },
        source: 'daily_counts table',
      };
    }
    case 'painPoints': {
      r = await db.query(
        "SELECT name, pain_point FROM campaigns WHERE type = 'pain-point' " +
        'ORDER BY created_at DESC LIMIT 5');
      if (!r.rows.length) {
        return {
          answer: 'No pain-point emails have been written yet.',
          numbers: {},
          source: 'campaigns table',
        };
      }
      const list = r.rows.map((c) => '• ' + (c.pain_point || c.name)).join('\n');
      return {
        answer: 'Latest pain points:\n' + list,
        numbers: { count: r.rows.length },
        source: 'campaigns table',
      };
    }
    case 'latestLeads': {
      r = await db.query(
        'SELECT business, city, decision_maker FROM leads ' +
        'ORDER BY date_found DESC, created_at DESC LIMIT 5');
      if (!r.rows.length) {
        return {
          answer: 'No leads yet — check back after the next run.',
          numbers: {},
          source: 'leads table',
        };
      }
      const list = r.rows.map((l) => '• ' + l.business + ' — ' + l.city +
        (l.decision_maker ? ' (' + l.decision_maker + ')' : '')).join('\n');
      return {
        answer: 'Latest leads:\n' + list,
        numbers: { count: r.rows.length },
        source: 'leads table',
      };
    }
    case 'unsubscribed': {
      r = await db.query('SELECT COUNT(*)::int AS n FROM contacts WHERE unsubscribed = true');
      const n = r.rows[0].n;
      return {
        answer: n + ' people have asked to stop getting email. They are never on a send list.',
        numbers: { unsubscribed: n },
        source: 'contacts table',
      };
    }
    case 'contributors': {
      r = await db.query(
        'SELECT COALESCE(contributed_by, \'hunted\') AS who, COUNT(*)::int AS n ' +
        'FROM contacts GROUP BY contributed_by ORDER BY n DESC');
      if (!r.rows.length) {
        return {
          answer: 'No lists have been added yet.',
          numbers: {},
          source: 'contacts table',
        };
      }
      const list = r.rows.map((c) => '• ' + c.who + ': ' + c.n + ' emails').join('\n');
      return {
        answer: 'Who gave us lists:\n' + list,
        numbers: { contributors: r.rows.length },
        source: 'contacts table',
      };
    }
    default: {
      return { answer: helpAnswer(), numbers: {}, source: 'none — question not covered' };
    }
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const question = String(body.question || '').trim();
  const author = String(body.author || 'Jessie').trim() || 'Jessie';
  if (!question) {
    return res.status(400).json({ error: 'Ask a question first.' });
  }
  // The list is not live yet — say so plainly, never guess a number.
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    return res.status(200).json({
      answer: 'The list isn\'t live yet — the database isn\'t set up, so I have no numbers yet.',
      numbers: {},
      source: 'none — database not set up',
      db_live: false,
    });
  }
  try {
    const result = await answerQuestion(question);
    try {
      await db.query(
        'INSERT INTO questions (question, answer, author) VALUES ($1, $2, $3)',
        [question, result.answer, author]);
    } catch (logErr) {
      console.error('ask log failed', logErr.code || logErr.message);
    }
    return res.status(200).json({
      answer: result.answer,
      numbers: result.numbers,
      source: result.source,
      db_live: true,
    });
  } catch (err) {
    console.error('ask failed', err.code || err.message);
    if (err.code === 'DB_NOT_CONFIGURED' || err.code === 'PG_NOT_INSTALLED') {
      return res.status(200).json({
        answer: 'The list isn\'t live yet — the database isn\'t set up, so I have no numbers yet.',
        numbers: {},
        source: 'none — database not set up',
        db_live: false,
      });
    }
    return res.status(500).json({ error: 'Could not answer that — try again.' });
  }
}

handler.detectIntent = detectIntent;
handler.extractCity = extractCity;
module.exports = handler;
