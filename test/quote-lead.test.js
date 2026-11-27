const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const handler = require('../api/quote-lead');

const ENV_KEYS = ['RESEND_API_KEY', 'TEX_LEAD_EMAIL', 'TEX_FROM_EMAIL'];
let savedEnv;
let savedFetch;

function baseLead(extra) {
  return Object.assign({
    business: 'North Loop Dental',
    name: 'Gavin Dawson',
    email: 'office@northloop.example',
    phone: '(214) 555-0134',
    zip: '75201',
    contract_end: 'March 2027',
    consent: true,
    source_url: 'https://saveonbusinessenergy.com/',
    sob_hp: '',
  }, extra);
}

function invoke(body, method) {
  const req = new EventEmitter();
  req.method = method || 'POST';
  req.headers = {};
  req.destroy = () => {};
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.payload = obj; return this; },
  };
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const pending = handler(req, res);
  req.emit('data', raw);
  req.emit('end');
  return pending.then(() => res);
}

describe('api/quote-lead', () => {
  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.TEX_LEAD_EMAIL = 'gavindawson22@gmail.com';
    process.env.TEX_FROM_EMAIL = 'leads@saveonbusinessenergy.com';
    savedFetch = global.fetch;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    global.fetch = savedFetch;
  });

  it('emails a no-bill quote with the tex-lead Resend env vars', async () => {
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push({ url, opts, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ id: 'email_nobill' }) };
    };

    const res = await invoke(baseLead({ monthly_spend: 'Under $500' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.email_id, 'email_nobill');
    assert.equal(calls.length, 1);

    const sent = calls[0];
    assert.equal(sent.url, 'https://api.resend.com/emails');
    assert.equal(sent.opts.headers.Authorization, 'Bearer re_test_key');
    assert.equal(sent.body.from, 'leads@saveonbusinessenergy.com');
    assert.deepEqual(sent.body.to, ['gavindawson22@gmail.com']);
    assert.equal(sent.body.reply_to, 'office@northloop.example');
    assert.equal(sent.body.subject, 'New quote request: North Loop Dental');
    assert.equal(sent.body.attachments, undefined);
    for (const part of [sent.body.html, sent.body.text, sent.body.subject]) {
      assert.equal(part.includes('\u2014'), false);
      assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(part), false);
      assert.equal(/\bfree\b/i.test(part), false);
    }
    assert.match(sent.body.html, /North Loop Dental/);
    assert.match(sent.body.html, /Gavin Dawson/);
    assert.match(sent.body.html, /office@northloop\.example/);
    assert.match(sent.body.html, /\(214\) 555-0134/);
    assert.match(sent.body.html, /75201/);
    assert.match(sent.body.html, /March 2027/);
    assert.match(sent.body.html, /Under \$500/);
    assert.match(sent.body.html, /https:\/\/saveonbusinessenergy\.com\//);
    assert.match(sent.body.html, /Consent to contact/);
    assert.match(sent.body.html, />Yes</);
    assert.match(sent.body.html, /No file uploaded/);
  });

  it('attaches a bill upload and leaves monthly spend blank', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake bill');
    const calls = [];
    global.fetch = async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ id: 'email_bill' }) };
    };

    const res = await invoke(baseLead({
      monthly_spend: '',
      bill: {
        filename: 'March bill.pdf',
        content_type: 'application/pdf',
        content: pdf.toString('base64'),
      },
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].attachments.length, 1);
    assert.equal(calls[0].attachments[0].filename, 'March_bill.pdf');
    assert.equal(calls[0].attachments[0].content, pdf.toString('base64'));
    assert.equal(calls[0].attachments[0].content_type, 'application/pdf');
    assert.match(calls[0].html, /March_bill\.pdf/);
    assert.match(calls[0].html, /Not provided/);
    assert.equal(calls[0].html.includes('Under $500'), false);
    assert.equal(calls[0].from, process.env.TEX_FROM_EMAIL);
    assert.deepEqual(calls[0].to, process.env.TEX_LEAD_EMAIL.split(','));
  });

  it('escapes form text in the email and splits multiple lead inboxes', async () => {
    process.env.TEX_LEAD_EMAIL = 'gavindawson22@gmail.com, ops@example.com';
    let sent;
    global.fetch = async (url, opts) => {
      sent = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ id: 'email_escape' }) };
    };
    const res = await invoke(baseLead({
      business: '<script>alert(1)</script>',
      monthly_spend: 'Not sure',
    }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(sent.to, ['gavindawson22@gmail.com', 'ops@example.com']);
    assert.match(sent.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(sent.html.includes('<script>'), false);
  });

  it('does not email when the honeypot is filled', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const res = await invoke(baseLead({ sob_hp: 'https://spam.example' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(called, false);
  });

  it('rejects an oversized bill before calling Resend', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const tooBig = Buffer.alloc(handler.MAX_ATTACHMENT_BYTES + 1, 7).toString('base64');
    const res = await invoke(baseLead({
      bill: { filename: 'huge.pdf', content_type: 'application/pdf', content: tooBig },
    }));
    assert.equal(res.statusCode, 413);
    assert.equal(res.payload.error, handler.TOO_LARGE_ERROR);
    assert.equal(called, false);
  });

  it('rejects a request body over the platform limit', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const res = await invoke(Buffer.alloc(handler.MAX_BODY_BYTES + 1, 0x61));
    assert.equal(res.statusCode, 413);
    assert.equal(res.payload.error, handler.TOO_LARGE_ERROR);
    assert.equal(called, false);
  });

  it('rejects a file that is not a PDF or image', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const res = await invoke(baseLead({
      bill: {
        filename: 'notes.html',
        content_type: 'text/html',
        content: Buffer.from('<html></html>').toString('base64'),
      },
    }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'Upload a PDF or a photo of the bill.');
    assert.equal(called, false);
  });

  it('requires consent and does not email without it', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const res = await invoke(baseLead({ consent: false }));
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /agree to be contacted/);
    assert.equal(called, false);
  });

  it('returns a helpful error when Resend refuses the email', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: 'provider exploded' }),
    });
    const res = await invoke(baseLead({ monthly_spend: '$5,000+' }));
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.error, handler.GENERIC_ERROR);
    assert.equal(JSON.stringify(res.payload).includes('provider exploded'), false);
  });

  it('returns 502 when Resend cannot be reached', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    const res = await invoke(baseLead());
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.error, handler.GENERIC_ERROR);
  });

  it('does not call Resend when the API key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    let called = false;
    global.fetch = async () => { called = true; };
    const res = await invoke(baseLead());
    assert.equal(res.statusCode, 500);
    assert.equal(called, false);
  });

  it('rejects GET', async () => {
    const res = await invoke(baseLead(), 'GET');
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
  });
});
