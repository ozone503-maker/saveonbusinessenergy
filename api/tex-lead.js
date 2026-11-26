// POST /api/tex-lead
// Receives Speko's post-call webhook (call.report) for ERBOT and
// emails the lead to Gavin immediately.
//
// Speko setup (dashboard: Settings -> Webhooks):
//   - Create an endpoint with URL https://saveonbusinessenergy.com/api/tex-lead
//   - Subscribe it to the `call.report` event, scoped to the ERBOT agent
//   - Add these extraction fields on the endpoint (or on the agent):
//       name (string), business_name (string), email (string),
//       phone (string), zip (string), monthly_spend (string),
//       contract_end (string), consent (boolean)
//     Speko's field is `contract_end`; the endpoint also accepts
//     `contract_end_date` and `end_date` as aliases.
//     Speko fills them from the transcript; each arrives in `custom_data`
//     (null when the call gave no value). This endpoint also falls back to
//     reading email / phone / ZIP out of the transcript text itself.
//
// Env vars (Vercel: Project Settings -> Environment Variables):
//   RESEND_API_KEY    - Resend API key (resend.com/api-keys)
//   TEX_LEAD_EMAIL    - where leads go (required; comma-separated for more
//                       than one). Currently gavindawson22@gmail.com only.
//   TEX_FROM_EMAIL    - sender (default: ERBOT <onboarding@resend.dev>).
//                       onboarding@resend.dev only delivers to the Resend
//                       account owner's email. Once saveonbusinessenergy.com
//                       is verified in Resend, set this to
//                       leads@saveonbusinessenergy.com.
//   SPEKO_WEBHOOK_SECRET - optional; when set, the Standard Webhooks
//                       signature is verified on every delivery.
//
// A lead is emailed ONLY when consent is true (the `consent` extraction
// field). Without consent, the webhook is acknowledged and nothing is sent.

const crypto = require('crypto');

const LEAD_EMAILS = (process.env.TEX_LEAD_EMAIL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const FROM_EMAIL =
  process.env.TEX_FROM_EMAIL || 'ERBOT <onboarding@resend.dev>';

// Speko re-fires call.report when the recording is ready. Skip a second
// email for a call this instance already mailed. (A cold start can still
// produce a second mail; the call_id in the subject makes it obvious.)
const emailed = new Set();

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, req) {
  const secret = process.env.SPEKO_WEBHOOK_SECRET;
  if (!secret) return { ok: true, skipped: true };
  const id = req.headers['webhook-id'];
  const ts = req.headers['webhook-timestamp'];
  const sigHeader = req.headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing signature headers' };
  const age = Date.now() / 1000 - Number(ts);
  if (!Number.isFinite(age) || Math.abs(age) > 300) {
    return { ok: false, reason: 'stale timestamp' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(id + '.' + ts + '.' + rawBody.toString('utf8'))
    .digest('base64');
  const sigs = String(sigHeader)
    .split(',')
    .map((s) => s.trim().replace(/^v1,/, ''));
  const match = sigs.some((s) => {
    try {
      const a = Buffer.from(s, 'base64');
      const b = Buffer.from(expected, 'base64');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
  return match ? { ok: true } : { ok: false, reason: 'bad signature' };
}

function pick(obj, names) {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of names) {
    const v = obj[n];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function transcriptText(payload) {
  const t = payload.transcript;
  const entries = Array.isArray(t) ? t : t && Array.isArray(t.entries) ? t.entries : [];
  return entries
    .map((e) => {
      const text = e.text || e.content || e.message || '';
      if (!text) return '';
      const who = e.speaker || e.role || e.source || '';
      return (who ? who + ': ' : '') + String(text).trim();
    })
    .filter(Boolean)
    .join('\n');
}

function fallbackFromTranscript(text) {
  const out = {};
  if (!text) return out;
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) out.email = email[0];
  const phone = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  if (phone) out.phone = phone[0];
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) out.zip = zip[0];
  return out;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label, value) {
  const v = value === null || value === undefined || value === '' ? '—' : String(value);
  return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">' +
    esc(label) + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">' +
    esc(v) + '</td></tr>';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const sig = verifySignature(raw, req);
  if (!sig.ok) {
    return res.status(401).json({ error: 'Webhook signature failed: ' + sig.reason });
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON' });
  }

  // Only the post-call report carries a transcript + extracted fields.
  // Anything else (call.status, call.recording...) is acknowledged, not emailed.
  const type = payload.type || payload.event || '';
  if (type && type !== 'call.report' && type !== 'call.analysis') {
    return res.status(200).json({ ok: true, ignored: type });
  }

  const callId = payload.call_id || payload.session_id || payload.id || 'unknown';
  if (emailed.has(callId)) {
    return res.status(200).json({ ok: true, duplicate: true, call_id: callId });
  }

  const custom = payload.custom_data || payload.structured_data || {};
  const text = transcriptText(payload);
  const fb = fallbackFromTranscript(text);

  const lead = {
    name: pick(custom, ['name', 'caller_name', 'full_name']),
    business: pick(custom, ['business_name', 'business', 'company', 'company_name']),
    email: pick(custom, ['email', 'email_address']) || fb.email || null,
    phone: pick(custom, ['phone', 'phone_number']) || fb.phone || null,
    zip: pick(custom, ['zip', 'zip_code', 'postal_code']) || fb.zip || null,
    monthlySpend: pick(custom, ['monthly_spend', 'monthly_bill', 'spend']),
    contractEnd: pick(custom, ['contract_end_date', 'contract_end', 'end_date']),
    consent: pick(custom, ['consent', 'agreed_to_contact', 'permission_to_contact']),
  };

  // Only send a lead when the caller consented to be contacted.
  const consentGiven =
    lead.consent === true ||
    (typeof lead.consent === 'string' &&
      ['true', 'yes', '1', 'y'].includes(lead.consent.trim().toLowerCase()));
  if (!consentGiven) {
    return res.status(200).json({ ok: true, skipped: 'no consent', call_id: callId });
  }

  const summary = payload.summary || '';
  const outcome = payload.outcome || payload.outcome_label || '';
  const duration = payload.duration_seconds || payload.duration || null;
  const recording = payload.recording_url || null;

  const hasAnything =
    text || summary || Object.values(lead).some((v) => v !== null && v !== '');
  if (!hasAnything) {
    return res.status(200).json({ ok: true, ignored: 'empty call, nothing to send' });
  }

  const who = lead.name || lead.business || 'Unknown caller';
  const subject =
    'New ERBOT lead: ' + who + ' [' + String(callId).slice(0, 12) + ']';

  const html =
    '<h2 style="margin:0 0 8px;">New lead from ERBOT</h2>' +
    '<p style="margin:0 0 12px;color:#555;">A Texas business just talked to ERBOT on saveonbusinessenergy.com.</p>' +
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px;">' +
    row('Name', lead.name) +
    row('Business', lead.business) +
    row('Email', lead.email) +
    row('Phone', lead.phone) +
    row('ZIP', lead.zip) +
    row('Monthly spend', lead.monthlySpend) +
    row('Contract end date', lead.contractEnd) +
    row('Consent to contact', lead.consent) +
    row('Outcome', outcome) +
    row('Call length', duration ? Math.round(duration / 60) + ' min' : null) +
    row('Call ID', callId) +
    '</table>' +
    (recording
      ? '<p style="margin:12px 0 0;"><a href="' + esc(recording) + '">Listen to the recording</a></p>'
      : '') +
    (summary ? '<h3 style="margin:16px 0 4px;">Summary</h3><p style="margin:0;">' + esc(summary) + '</p>' : '') +
    (text
      ? '<h3 style="margin:16px 0 4px;">Transcript</h3><pre style="white-space:pre-wrap;font-family:inherit;background:#f7f7f7;padding:10px;border-radius:6px;">' +
        esc(text) +
        '</pre>'
      : '');

  if (!LEAD_EMAILS.length) {
    console.error('tex-lead: TEX_LEAD_EMAIL is not configured; lead not emailed.', { callId });
    return res.status(500).json({ error: 'TEX_LEAD_EMAIL is not configured on the server.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('tex-lead: RESEND_API_KEY is not configured; lead not emailed.', { callId });
    return res.status(500).json({ error: 'RESEND_API_KEY is not configured on the server.' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: LEAD_EMAILS,
        subject: subject,
        html: html,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('tex-lead: Resend refused the email.', { callId, status: r.status, data });
      // Non-2xx so Speko retries the delivery later; the lead is not lost.
      return res.status(502).json({ error: 'Email provider refused the lead.', detail: data });
    }
    emailed.add(callId);
    return res.status(200).json({ ok: true, call_id: callId, email_id: data.id || null });
  } catch (err) {
    console.error('tex-lead: could not reach Resend.', { callId, err: String(err) });
    return res.status(502).json({ error: 'Could not reach the email provider.' });
  }
};
