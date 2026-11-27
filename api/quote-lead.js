// POST /api/quote-lead
// Receives the public #lead-form quote request and emails it to Gavin.
//
// Uses the same Resend setup already configured for api/tex-lead.js.
// No extra Vercel environment variables:
//   RESEND_API_KEY  - Resend API key
//   TEX_LEAD_EMAIL  - where leads go (comma-separated for more than one)
//   TEX_FROM_EMAIL  - sender (same value ERBOT already sends from)
//
// ERBOT's webhook (api/tex-lead.js) is unchanged.

const RESEND_URL = 'https://api.resend.com/emails';
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 4500000;
const TOO_LARGE_ERROR =
  'That bill is too large to send (3 MB limit). Use a smaller PDF or photo, or remove the file and submit again.';
const GENERIC_ERROR = 'We could not send your request. Please try again in a moment.';

const ALLOWED_EXT = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp', 'tif', 'tiff',
]);
const EXT_FOR_TYPE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/x-png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/tif': 'tiff',
};

function leadEmails() {
  return (process.env.TEX_LEAD_EMAIL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function fromEmail() {
  return process.env.TEX_FROM_EMAIL || 'ERBOT <onboarding@resend.dev>';
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    function fail(err) {
      if (settled) return;
      settled = true;
      reject(err);
    }
    function ok(buf) {
      if (settled) return;
      settled = true;
      resolve(buf);
    }
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error('too large');
        err.code = 'BODY_TOO_LARGE';
        fail(err);
        if (typeof req.destroy === 'function') req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', (err) => fail(err));
  });
}

function parsePayload(raw, req) {
  if (raw && raw.length) return JSON.parse(raw.toString('utf8'));
  const body = req.body;
  if (typeof body === 'string' && body.trim()) return JSON.parse(body);
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const err = new Error('empty');
  err.code = 'EMPTY';
  throw err;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/\0/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function consentGiven(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    return ['true', 'yes', '1', 'y', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function row(label, value) {
  const shown = value === null || value === undefined || String(value).trim() === ''
    ? 'Not provided'
    : String(value);
  return '<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #eee;font-weight:600;vertical-align:top;">' +
    esc(label) + '</td><td style="padding:6px 0;border-bottom:1px solid #eee;vertical-align:top;">' +
    esc(shown) + '</td></tr>';
}

function extOf(filename) {
  const match = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function mimeOf(contentType) {
  return String(contentType || '').toLowerCase().split(';')[0].trim();
}

function stripDataUrl(content) {
  const raw = String(content || '').trim();
  const match = raw.match(/^data:[^;,]*(?:;[^;,]*)*;base64,([\s\S]*)$/i);
  return (match ? match[1] : raw).replace(/\s/g, '');
}

function normalizeBase64(content) {
  let s = stripDataUrl(content);
  if (!s || /[^A-Za-z0-9+/=]/.test(s)) return null;
  if (s.includes('=')) {
    if (!/^[A-Za-z0-9+/]+={1,2}$/.test(s) || s.length % 4 !== 0) return null;
    return s;
  }
  if (s.length % 4 === 1) return null;
  if (s.length % 4 !== 0) s += '='.repeat(4 - (s.length % 4));
  return s;
}

function base64DecodedLength(b64) {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

function billAllowed(filename, contentType) {
  const ext = extOf(filename);
  const type = mimeOf(contentType);
  if (ext === 'svg' || type === 'image/svg+xml') return false;
  if (ALLOWED_EXT.has(ext)) {
    if (!type || type === 'application/octet-stream' || type === 'application/pdf' || type.startsWith('image/')) {
      return type !== 'image/svg+xml';
    }
  }
  return Object.prototype.hasOwnProperty.call(EXT_FOR_TYPE, type);
}

function safeFilename(name, contentType) {
  const base = String(name || 'bill').split(/[/\\]/).pop();
  let cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').replace(/_+/g, '_');
  if (!cleaned || cleaned === '_') cleaned = 'bill';
  cleaned = cleaned.slice(0, 120);
  if (!extOf(cleaned)) {
    const ext = EXT_FOR_TYPE[mimeOf(contentType)];
    if (ext) cleaned += '.' + ext;
  }
  return cleaned;
}

function prepareBill(bill) {
  if (bill == null || bill === '') return { attachment: null };
  if (typeof bill !== 'object' || Array.isArray(bill)) {
    return { error: 'The bill file could not be read. Try a different PDF or photo.', status: 400 };
  }
  const rawName = bill.filename || bill.name || '';
  const rawType = bill.content_type || bill.type || '';
  const rawContent = bill.content || bill.data || '';
  if (!rawName && !rawContent) return { attachment: null };

  const filename = safeFilename(rawName, rawType);
  const contentType = mimeOf(rawType) || (extOf(filename) === 'pdf' ? 'application/pdf' : '');
  if (!billAllowed(filename, contentType)) {
    return { error: 'Upload a PDF or a photo of the bill.', status: 400 };
  }
  const content = normalizeBase64(rawContent);
  if (!content) {
    return { error: 'The bill file could not be read. Try a different PDF or photo.', status: 400 };
  }
  if (base64DecodedLength(content) > MAX_ATTACHMENT_BYTES) {
    return { error: TOO_LARGE_ERROR, status: 413 };
  }
  return {
    attachment: {
      filename: filename,
      content: content,
      content_type: contentType || undefined,
    },
  };
}

function buildQuoteEmail(lead, attachment) {
  const who = lead.business || lead.name || 'Website quote';
  const subject = ('New quote request: ' + who).slice(0, 180);
  const billLabel = attachment ? attachment.filename : '';
  const html =
    '<h2 style="margin:0 0 8px;">New quote request from the website</h2>' +
    '<p style="margin:0 0 12px;color:#555;">Someone submitted the quote form on saveonbusinessenergy.com.</p>' +
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px;">' +
    row('Business name', lead.business) +
    row('Contact name', lead.name) +
    row('Work email', lead.email) +
    row('Phone', lead.phone) +
    row('Business ZIP', lead.zip) +
    row('Contract end date', lead.contractEnd) +
    row('Estimated monthly electric spend', lead.monthlySpend) +
    row('Consent to contact', 'Yes') +
    row('Source page', lead.sourceUrl) +
    row('Bill file', billLabel || 'No file uploaded') +
    '</table>' +
    '<p style="margin:12px 0 0;color:#555;">Reply to this email to reach the contact directly.</p>';
  const text = [
    'New quote request from the website',
    '',
    'Business name: ' + (lead.business || 'Not provided'),
    'Contact name: ' + (lead.name || 'Not provided'),
    'Work email: ' + (lead.email || 'Not provided'),
    'Phone: ' + (lead.phone || 'Not provided'),
    'Business ZIP: ' + (lead.zip || 'Not provided'),
    'Contract end date: ' + (lead.contractEnd || 'Not provided'),
    'Estimated monthly electric spend: ' + (lead.monthlySpend || 'Not provided'),
    'Consent to contact: Yes',
    'Source page: ' + (lead.sourceUrl || 'Not provided'),
    'Bill file: ' + (billLabel || 'No file uploaded'),
    '',
    'Reply to this email to reach the contact directly.',
  ].join('\n');
  return { subject, html, text };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    if (err && err.code === 'BODY_TOO_LARGE') {
      return res.status(413).json({ error: TOO_LARGE_ERROR });
    }
    return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  }

  let payload;
  try {
    payload = parsePayload(raw, req);
  } catch {
    return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  }

  if (clean(payload.sob_hp || payload.company_website || '', 200)) {
    console.warn('quote-lead: honeypot filled; not emailed.');
    return res.status(200).json({ ok: true });
  }

  const headers = req.headers || {};
  let monthlySpend = clean(payload.monthly_spend || payload.monthlySpend || '', 80);
  if (monthlySpend === 'Estimated monthly electric spend') monthlySpend = '';

  const lead = {
    business: clean(payload.business || payload.business_name || '', 200),
    name: clean(payload.name || '', 200),
    email: clean(payload.email || '', 254),
    phone: clean(payload.phone || '', 40),
    zip: clean(payload.zip || '', 20),
    contractEnd: clean(payload.contract_end || payload.contractEnd || '', 80),
    monthlySpend: monthlySpend,
    sourceUrl: clean(payload.source_url || payload.sourceUrl || headers.referer || headers.referrer || '', 500),
  };

  const missing = [];
  if (!lead.business) missing.push('business name');
  if (!lead.name) missing.push('contact name');
  if (!lead.email) missing.push('work email');
  if (!lead.phone) missing.push('phone');
  if (!lead.zip) missing.push('business ZIP');
  if (missing.length) {
    return res.status(400).json({ error: 'Please fill in: ' + missing.join(', ') + '.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    return res.status(400).json({ error: 'Enter a valid work email.' });
  }
  if (lead.phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Enter a phone number we can reach you at.' });
  }
  if (!/\d{5}/.test(lead.zip)) {
    return res.status(400).json({ error: 'Enter a 5-digit business ZIP.' });
  }
  if (!consentGiven(payload.consent)) {
    return res.status(400).json({
      error: 'Please agree to be contacted so we can follow up on your request.',
    });
  }

  const prepared = prepareBill(payload.bill);
  if (prepared.error) {
    return res.status(prepared.status).json({ error: prepared.error });
  }

  const to = leadEmails();
  if (!to.length) {
    console.error('quote-lead: TEX_LEAD_EMAIL is not configured; lead not emailed.');
    return res.status(500).json({ error: GENERIC_ERROR });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('quote-lead: RESEND_API_KEY is not configured; lead not emailed.');
    return res.status(500).json({ error: GENERIC_ERROR });
  }

  const message = buildQuoteEmail(lead, prepared.attachment);
  const body = {
    from: fromEmail(),
    to: to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    reply_to: lead.email,
  };
  if (prepared.attachment) {
    const attachment = {
      filename: prepared.attachment.filename,
      content: prepared.attachment.content,
    };
    if (prepared.attachment.content_type) attachment.content_type = prepared.attachment.content_type;
    body.attachments = [attachment];
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('quote-lead: Resend refused the email.', {
        status: response.status,
        data: data,
      });
      return res.status(502).json({ error: GENERIC_ERROR });
    }
    return res.status(200).json({ ok: true, email_id: data.id || null });
  } catch (err) {
    console.error('quote-lead: could not reach Resend.', { err: String(err) });
    return res.status(502).json({ error: GENERIC_ERROR });
  }
}

handler.MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_BYTES;
handler.MAX_BODY_BYTES = MAX_BODY_BYTES;
handler.TOO_LARGE_ERROR = TOO_LARGE_ERROR;
handler.GENERIC_ERROR = GENERIC_ERROR;
module.exports = handler;
