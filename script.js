document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('lead-form');
  const success = document.getElementById('form-success');
  const pathBill = document.getElementById('path-bill');
  const pathNobill = document.getElementById('path-nobill');
  const billPath = document.getElementById('bill-path');
  const nobillPath = document.getElementById('nobill-path');

  if (pathBill && pathNobill && billPath && nobillPath) {
    pathBill.addEventListener('click', () => {
      pathBill.classList.add('active');
      pathNobill.classList.remove('active');
      billPath.style.display = 'block';
      nobillPath.style.display = 'none';
      clearFormError();
    });
    pathNobill.addEventListener('click', () => {
      pathNobill.classList.add('active');
      pathBill.classList.remove('active');
      billPath.style.display = 'none';
      nobillPath.style.display = 'block';
      clearFormError();
    });
  }

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      return submitLeadForm(form, success, billPath, nobillPath);
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const t = document.querySelector(href);
        if (t) t.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
});

// Keep in sync with api/quote-lead.js MAX_ATTACHMENT_BYTES.
// Base64 adds about a third, and Vercel rejects request bodies around 4.5 MB.
const MAX_BILL_BYTES = 3 * 1024 * 1024;
const BILL_TOO_LARGE = 'That bill is too large to send (3 MB limit). Use a smaller PDF or photo, or remove the file and submit again.';

function clearFormError() {
  const el = document.getElementById('form-error');
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

function showFormError(msg) {
  const el = document.getElementById('form-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function fieldValue(form, name) {
  const el = form.elements && form.elements[name];
  if (!el || typeof el.value !== 'string') return '';
  return el.value.trim();
}

function fileAllowed(file) {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return false;
  if (type === 'application/pdf' || name.endsWith('.pdf')) return true;
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/.test(name);
}

function readBillFile(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve({
        filename: file.name || 'bill',
        content_type: file.type || '',
        content: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.onerror = function() {
      const err = new Error('read failed');
      err.code = 'BILL_READ';
      reject(err);
    };
    reader.readAsDataURL(file);
  });
}

async function submitLeadForm(form, success, billPath, nobillPath) {
  const button = form.querySelector('[type="submit"]');
  const originalLabel = button ? button.textContent : 'Send My Request';
  clearFormError();

  const billOpen = !billPath || billPath.style.display !== 'none';
  const spendOpen = !!(nobillPath && nobillPath.style.display !== 'none');
  const fileInput = form.querySelector('input[name="bill"]');
  const file = billOpen && fileInput && fileInput.files && fileInput.files[0];

  if (file && file.size > MAX_BILL_BYTES) {
    showFormError(BILL_TOO_LARGE);
    return;
  }
  if (file && !fileAllowed(file)) {
    showFormError('Upload a PDF or a photo of the bill.');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Sending...';
  }
  if (typeof form.setAttribute === 'function') form.setAttribute('aria-busy', 'true');

  try {
    const consentEl = form.querySelector('input[name="consent"]');
    const payload = {
      business: fieldValue(form, 'business'),
      name: fieldValue(form, 'name'),
      email: fieldValue(form, 'email'),
      phone: fieldValue(form, 'phone'),
      zip: fieldValue(form, 'zip'),
      contract_end: fieldValue(form, 'contract_end'),
      monthly_spend: spendOpen ? fieldValue(form, 'monthly_spend') : '',
      consent: !!(consentEl && consentEl.checked),
      source_url: window.location.href,
      sob_hp: fieldValue(form, 'sob_hp'),
    };
    if (file) payload.bill = await readBillFile(file);

    const response = await fetch('/api/quote-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await response.json();
    } catch (ignore) {
      data = {};
    }
    if (!response.ok) {
      const fallback = response.status === 413
        ? BILL_TOO_LARGE
        : 'We could not send your request. Please try again in a moment.';
      showFormError((data && data.error) || fallback);
      return;
    }
    clearFormError();
    form.style.display = 'none';
    if (success) success.style.display = 'block';
  } catch (err) {
    const message = err && err.code === 'BILL_READ'
      ? 'The bill file could not be read. Try a different PDF or photo.'
      : 'We could not reach the server. Check your connection and try again.';
    showFormError(message);
  } finally {
    if (typeof form.removeAttribute === 'function') form.removeAttribute('aria-busy');
    if (button && form.style.display !== 'none') {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}
