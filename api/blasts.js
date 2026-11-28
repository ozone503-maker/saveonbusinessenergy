// GET / POST /api/blasts — weekly megablast builder (DRAFT v2 — not live).
// Same CommonJS style as api/tex-lead.js. No framework. Auth required,
// except the public unsubscribe action (see below).
//
// DRAFT-ONLY BUILDER: this file builds the audience and the draft email.
// It NEVER sends without Jessie's explicit approval, and the approval
// gate is in the database, not in a comment:
//   blast.status 'draft'  -> built, preview shown, nothing approved.
//   blast.status 'approved' (approved_by + approved_at set on the hidden
//      page, after Jessie sees the preview + recipient count) -> ready.
//   send requires status 'approved' AND { confirm: true } in the same
//      call. A blast in 'draft' cannot be sent, by design.
// A campaign is the idea (news story or pain point, see CAMPAIGNS.md);
// a blast is one send of one campaign to one audience.
//
// Audience: contacts where unsubscribed = false. The audience_filter is
// JSONB, e.g. {"cities": ["Houston"], "tags": ["contract-ending"],
// "contributed_by": "Jose the electrician"}. Consent is tracked per
// contact (consent_status) and shown in the preview — an uploaded list
// is 'unknown', never treated as consent. Unsubscribed addresses are
// excluded by the query itself, not by a filter someone can forget.
//
// Compliance (design, enforced by the send path):
// - Track source + consent per contact; never blast an unsubscribed address.
// - Every blast includes an unsubscribe link + List-Unsubscribe header.
// - POST { action: 'unsubscribe', email } is public (no auth — the
//   recipient clicking it is not signed in) and sets unsubscribed=true.
// - Never call Jessie/USAEP a "broker"; never promise savings.
// Env needed to actually send: RESEND_API_KEY (already exists) +
// TEX_FROM_EMAIL (verified sender). Nothing sends in this draft file's
// home (it is not deployed); when it goes live, send still needs an
// approved blast + confirm:true.

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

// Build the audience WHERE clause from a JSON filter. Unsubscribed is
// always excluded, whatever the filter says. Returns { sql, params }.
function audienceWhere(filter, startParam) {
  const where = ['unsubscribed = FALSE'];
  const params = [];
  const f = filter || {};
  if (Array.isArray(f.cities) && f.cities.length) {
    params.push(f.cities.map((c) => String(c).toLowerCase()));
    where.push('lower(btrim(city)) = ANY($' + (startParam + params.length - 1) + ')');
  }
  if (Array.isArray(f.tags) && f.tags.length) {
    params.push(f.tags);
    where.push('tags && $' + (startParam + params.length - 1));
  }
  if (f.contributed_by) {
    params.push(String(f.contributed_by));
    where.push('contributed_by = $' + (startParam + params.length - 1));
  }
  if (f.source) {
    params.push(String(f.source));
    where.push('source = $' + (startParam + params.length - 1));
  }
  return { sql: where.join(' AND '), params };
}

function unsubscribeFooter(email) {
  const base = process.env.SITE_URL || 'https://saveonbusinessenergy.com';
  return (
    '<hr><p style="font-size:12px;color:#666;">You are receiving this because your ' +
    'business was listed as a Texas commercial energy contact. ' +
    '<a href="' +
    base +
    '/leads?unsubscribe=' +
    encodeURIComponent(email) +
    '">Unsubscribe</a> — one click, no questions, and we will not email you again.</p>'
  );
}

module.exports = async function handler(req, res) {
  // Public unsubscribe: the recipient is not signed in. It only ever
  // sets unsubscribed=true for one address — it cannot read or send.
  if (req.method === 'POST') {
    let peek;
    try {
      peek = await readJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'Body is not valid JSON.' });
    }
    if (peek.action === 'unsubscribe') {
      const email = String(peek.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'An email is required.' });
      try {
        await db.query(
          'UPDATE contacts SET unsubscribed = TRUE, unsubscribed_at = now(), consent_status = $2 WHERE lower(btrim(email)) = $1',
          [email, 'withdrawn']
        );
        return res.status(200).json({ ok: true, unsubscribed: email });
      } catch (err) {
        console.error('blasts unsubscribe failed', err.code || err.message);
        return res.status(500).json({ error: 'Could not unsubscribe.' });
      }
    }
    // v3: no auth. Anyone on the machine can push — see _auth.js.
    return handleAuthed(req, res, peek);
  }

  if (req.method === 'GET') {
    try {
      const campaigns = await db.query('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100');
      const blasts = await db.query('SELECT * FROM blasts ORDER BY created_at DESC LIMIT 100');
      const total = await db.query(
        'SELECT COUNT(*)::int AS n FROM contacts WHERE unsubscribed = FALSE'
      );
      return res.status(200).json({
        campaigns: campaigns.rows.map(db.publicCampaign),
        blasts: blasts.rows.map(db.publicBlast),
        mailable_contacts: total.rows[0].n,
      });
    } catch (err) {
      console.error('blasts GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load campaigns.' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleAuthed(req, res, body) {
  // v3: actor is the body's author field, audit-only, not verified.
  const actor = String(body.author || 'Jessie').trim().slice(0, 80) || 'Jessie';
  const action = String(body.action || '');

  // ---- create a campaign (draft only) ----
  if (action === 'create-campaign') {
    const name = String(body.name || '').trim();
    const type = String(body.type || '');
    if (!name || (type !== 'news' && type !== 'pain-point')) {
      return res.status(400).json({ error: 'A campaign needs a name and a type: news or pain-point.' });
    }
    if (type === 'news' && !String(body.news_story || '').trim()) {
      return res.status(400).json({ error: 'A news campaign needs the actual story (headline + source) — never invent one.' });
    }
    try {
      const r = await db.query(
        'INSERT INTO campaigns (name, type, angle, news_story, news_story_url, pain_point, article_slug, subject_options, body_draft, cta, audience_filter, created_by) ' +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *",
        [
          name,
          type,
          String(body.angle || '').trim() || null,
          String(body.news_story || '').trim() || null,
          String(body.news_story_url || '').trim() || null,
          String(body.pain_point || '').trim() || null,
          String(body.article_slug || '').trim() || null,
          Array.isArray(body.subject_options) ? body.subject_options.map(String) : [],
          String(body.body_draft || '').trim() || null,
          String(body.cta || '').trim() || 'Get a free review — no fee, no obligation.',
          body.audience_filter && typeof body.audience_filter === 'object' ? body.audience_filter : {},
          actor,
        ]
      );
      return res.status(201).json({ campaign: db.publicCampaign(r.rows[0]) });
    } catch (err) {
      console.error('blasts create-campaign failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not save the campaign.' });
    }
  }

  // ---- build a blast: count the audience, save as draft, show preview ----
  if (action === 'build') {
    const campaignId = Number(body.campaign_id);
    const name = String(body.name || '').trim();
    if (!Number.isInteger(campaignId) || campaignId <= 0 || !name) {
      return res.status(400).json({ error: 'A campaign id and a blast name are required.' });
    }
    try {
      const camp = await db.query('SELECT * FROM campaigns WHERE id = $1 LIMIT 1', [campaignId]);
      if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found.' });
      const campaign = camp.rows[0];
      const filter = (body.audience_filter && typeof body.audience_filter === 'object'
        ? body.audience_filter
        : campaign.audience_filter) || {};
      const { sql, params } = audienceWhere(filter, 1);
      const count = await db.query('SELECT COUNT(*)::int AS n FROM contacts WHERE ' + sql, params);
      const sample = await db.query(
        'SELECT email, name, business, city, consent_status FROM contacts WHERE ' + sql + ' ORDER BY created_at DESC LIMIT 5',
        params
      );
      const blast = await db.query(
        "INSERT INTO blasts (campaign_id, name, audience_filter, recipient_count, scheduled_for, status) " +
          "VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING *",
        [campaignId, name, filter, count.rows[0].n, body.scheduled_for || null]
      );
      return res.status(201).json({
        blast: db.publicBlast(blast.rows[0]),
        preview: {
          recipient_count: count.rows[0].n,
          sample: sample.rows,
          subject_options: campaign.subject_options || [],
          body_draft: campaign.body_draft,
          cta: campaign.cta,
          note: 'Draft only. Nothing has been sent. Approve this blast on the hidden page to arm it — approval alone still does not send it.',
        },
      });
    } catch (err) {
      console.error('blasts build failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not build the blast.' });
    }
  }

  // ---- approve a blast: arms it, does NOT send it ----
  if (action === 'approve') {
    const blastId = Number(body.blast_id);
    if (!Number.isInteger(blastId) || blastId <= 0) {
      return res.status(400).json({ error: 'A blast id is required.' });
    }
    try {
      const r = await db.query(
        "UPDATE blasts SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2 AND status = 'draft' RETURNING *",
        [actor, blastId]
      );
      if (!r.rows.length) {
        return res.status(409).json({ error: 'Blast not found, or not in draft — only a draft can be approved.' });
      }
      return res.status(200).json({ blast: db.publicBlast(r.rows[0]), note: 'Approved. Nothing sent yet — sending needs a separate confirm.' });
    } catch (err) {
      console.error('blasts approve failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not approve the blast.' });
    }
  }

  // ---- send an APPROVED blast, only with an explicit confirm in the call ----
  if (action === 'send') {
    const blastId = Number(body.blast_id);
    if (!Number.isInteger(blastId) || blastId <= 0) {
      return res.status(400).json({ error: 'A blast id is required.' });
    }
    if (body.confirm !== true) {
      return res.status(400).json({ error: 'Sending needs confirm: true in the same call — approval alone is not a send.' });
    }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY is not configured on the server.' });
    try {
      const blastQ = await db.query(
        "SELECT b.*, c.subject_options, c.body_draft, c.cta, c.name AS campaign_name FROM blasts b JOIN campaigns c ON c.id = b.campaign_id WHERE b.id = $1 LIMIT 1",
        [blastId]
      );
      if (!blastQ.rows.length) return res.status(404).json({ error: 'Blast not found.' });
      const blast = blastQ.rows[0];
      if (blast.status !== 'approved') {
        return res.status(409).json({ error: 'Only an approved blast can be sent. This one is ' + blast.status + '.' });
      }
      const { sql, params } = audienceWhere(blast.audience_filter, 1);
      const audience = await db.query(
        'SELECT email, name FROM contacts WHERE ' + sql + ' ORDER BY email ASC',
        params
      );
      const from =
        process.env.TEX_FROM_EMAIL || 'Save on Business Energy <leads@saveonbusinessenergy.com>';
      const subject = (blast.subject_options && blast.subject_options[0]) || blast.campaign_name;
      let sent = 0;
      // Resend one email per recipient (no bulk BCC — each gets its own
      // unsubscribe link, and one bad address cannot sink the batch).
      for (const row of audience.rows) {
        const html =
          '<p>Hi ' +
          (row.name ? row.name : 'there') +
          ',</p>' +
          (blast.body_draft || '') +
          '<p><strong>' +
          blast.cta +
          '</strong></p>' +
          unsubscribeFooter(row.email);
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [row.email],
            subject,
            html,
            headers: { 'List-Unsubscribe': '<mailto:unsubscribe@saveonbusinessenergy.com>' },
          }),
        });
        if (r.ok) sent += 1;
        else console.error('blast send failed for one recipient', { email: row.email, status: r.status });
      }
      await db.query(
        "UPDATE blasts SET status = 'sent', sent_at = now(), sent_count = $1 WHERE id = $2",
        [sent, blastId]
      );
      return res.status(200).json({ ok: true, sent, audience: audience.rows.length, blast_id: blastId });
    } catch (err) {
      console.error('blasts send failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not send the blast.' });
    }
  }

  return res.status(400).json({ error: "Action must be 'create-campaign', 'build', 'approve', 'send', or 'unsubscribe'." });
}
