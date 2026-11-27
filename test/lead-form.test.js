const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

function classList() {
  const names = new Set();
  return {
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    contains(name) { return names.has(name); },
  };
}

function makeDom() {
  function input(name, value) {
    return {
      name: name,
      value: value,
      type: 'text',
      checked: false,
      files: [],
      style: {},
    };
  }
  const inputs = {
    business: input('business', 'North Loop Dental'),
    name: input('name', 'Gavin Dawson'),
    email: input('email', 'office@northloop.example'),
    phone: input('phone', '(214) 555-0134'),
    zip: input('zip', '75201'),
    contract_end: input('contract_end', 'March 2027'),
    monthly_spend: input('monthly_spend', 'Under $500'),
    sob_hp: input('sob_hp', ''),
    consent: input('consent', 'on'),
    bill: input('bill', ''),
  };
  inputs.consent.type = 'checkbox';
  inputs.consent.checked = true;
  inputs.bill.type = 'file';

  const button = {
    type: 'submit',
    textContent: 'Send My Request',
    disabled: false,
    style: {},
  };
  const errorEl = {
    id: 'form-error',
    textContent: '',
    style: { display: 'none' },
    scrollIntoView() {},
  };
  const successEl = { id: 'form-success', style: { display: 'none' } };
  const billPath = { id: 'bill-path', style: { display: 'block' } };
  const nobillPath = { id: 'nobill-path', style: { display: 'none' } };
  const submitHandlers = [];
  const form = {
    id: 'lead-form',
    style: { display: '' },
    elements: inputs,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn) {
      if (type === 'submit') submitHandlers.push(fn);
    },
    querySelector(sel) {
      if (sel === 'input[name="bill"]') return inputs.bill;
      if (sel === 'input[name="consent"]') return inputs.consent;
      if (sel === '[type="submit"]') return button;
      return null;
    },
  };
  const byId = {
    'lead-form': form,
    'form-success': successEl,
    'form-error': errorEl,
    'path-bill': { id: 'path-bill', classList: classList(), addEventListener() {} },
    'path-nobill': { id: 'path-nobill', classList: classList(), addEventListener() {} },
    'bill-path': billPath,
    'nobill-path': nobillPath,
  };
  return { byId, form, inputs, button, errorEl, successEl, billPath, nobillPath, submitHandlers };
}

describe('lead form submit', () => {
  const dom = makeDom();
  let savedFetch;
  let savedFileReader;
  let savedWindow;

  before(() => {
    savedFetch = global.fetch;
    savedFileReader = global.FileReader;
    savedWindow = global.window;
    global.document = {
      _ready: null,
      addEventListener(name, fn) { if (name === 'DOMContentLoaded') this._ready = fn; },
      getElementById(id) { return dom.byId[id] || null; },
      querySelectorAll() { return []; },
      querySelector() { return null; },
    };
    global.window = { location: { href: 'https://saveonbusinessenergy.com/#review' } };
    global.FileReader = class {
      readAsDataURL(file) {
        const encoded = file.base64 || Buffer.from('bill').toString('base64');
        this.result = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + encoded;
        this.onload();
      }
    };
    require('../script.js');
    global.document._ready();
  });

  after(() => {
    global.fetch = savedFetch;
    global.FileReader = savedFileReader;
    global.window = savedWindow;
  });

  function reset() {
    dom.form.style.display = '';
    dom.successEl.style.display = 'none';
    dom.errorEl.style.display = 'none';
    dom.errorEl.textContent = '';
    dom.button.disabled = false;
    dom.button.textContent = 'Send My Request';
    dom.inputs.bill.files = [];
    dom.inputs.monthly_spend.value = 'Under $500';
    dom.billPath.style.display = 'block';
    dom.nobillPath.style.display = 'none';
  }

  it('sends a no-bill payload and shows success only after HTTP 200', async () => {
    reset();
    dom.billPath.style.display = 'none';
    dom.nobillPath.style.display = 'block';
    let during = null;
    let sent = null;
    global.fetch = async (url, opts) => {
      during = {
        disabled: dom.button.disabled,
        label: dom.button.textContent,
        formDisplay: dom.form.style.display,
        successDisplay: dom.successEl.style.display,
      };
      sent = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    await dom.submitHandlers[0]({ preventDefault() {} });

    assert.equal(sent.url, '/api/quote-lead');
    assert.equal(sent.body.business, 'North Loop Dental');
    assert.equal(sent.body.name, 'Gavin Dawson');
    assert.equal(sent.body.email, 'office@northloop.example');
    assert.equal(sent.body.phone, '(214) 555-0134');
    assert.equal(sent.body.zip, '75201');
    assert.equal(sent.body.contract_end, 'March 2027');
    assert.equal(sent.body.monthly_spend, 'Under $500');
    assert.equal(sent.body.consent, true);
    assert.equal(sent.body.source_url, 'https://saveonbusinessenergy.com/#review');
    assert.equal(sent.body.sob_hp, '');
    assert.equal(sent.body.bill, undefined);
    assert.equal(during.disabled, true);
    assert.equal(during.label, 'Sending...');
    assert.equal(during.successDisplay, 'none');
    assert.equal(dom.form.style.display, 'none');
    assert.equal(dom.successEl.style.display, 'block');
    assert.equal(dom.errorEl.style.display, 'none');
  });

  it('attaches a bill and keeps the form up when the API fails', async () => {
    reset();
    const content = Buffer.from('fake-pdf').toString('base64');
    dom.inputs.bill.files = [{
      name: 'bill.pdf',
      type: 'application/pdf',
      size: 8,
      base64: content,
    }];
    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.monthly_spend, '');
      assert.equal(body.bill.filename, 'bill.pdf');
      assert.equal(body.bill.content_type, 'application/pdf');
      assert.equal(body.bill.content, content);
      return {
        ok: false,
        status: 502,
        json: async () => ({ error: 'We could not send your request. Please try again in a moment.' }),
      };
    };

    await dom.submitHandlers[0]({ preventDefault() {} });

    assert.equal(dom.form.style.display, '');
    assert.equal(dom.successEl.style.display, 'none');
    assert.equal(dom.errorEl.style.display, 'block');
    assert.match(dom.errorEl.textContent, /could not send your request/);
    assert.equal(dom.button.disabled, false);
    assert.equal(dom.button.textContent, 'Send My Request');
  });

  it('warns on a too-large bill and does not call the API', async () => {
    reset();
    let called = false;
    global.fetch = async () => { called = true; };
    dom.inputs.bill.files = [{
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: (3 * 1024 * 1024) + 1,
    }];

    await dom.submitHandlers[0]({ preventDefault() {} });

    assert.equal(called, false);
    assert.equal(dom.successEl.style.display, 'none');
    assert.equal(dom.form.style.display, '');
    assert.match(dom.errorEl.textContent, /3 MB limit/);
    assert.equal(dom.button.disabled, false);
    assert.equal(dom.button.textContent, 'Send My Request');
  });

  it('shows a connection error and re-enables the button when fetch throws', async () => {
    reset();
    dom.billPath.style.display = 'none';
    dom.nobillPath.style.display = 'block';
    global.fetch = async () => { throw new Error('offline'); };

    await dom.submitHandlers[0]({ preventDefault() {} });

    assert.equal(dom.successEl.style.display, 'none');
    assert.match(dom.errorEl.textContent, /could not reach the server/);
    assert.equal(dom.button.disabled, false);
    assert.equal(dom.button.textContent, 'Send My Request');
  });
});
