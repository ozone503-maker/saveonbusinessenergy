document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('lead-form');
  const success = document.getElementById('form-success');
  const pathBill = document.getElementById('path-bill');
  const pathNobill = document.getElementById('path-nobill');
  const billPath = document.getElementById('bill-path');
  const nobillPath = document.getElementById('nobill-path');

  if (pathBill && pathNobill) {
    pathBill.addEventListener('click', () => {
      pathBill.classList.add('active');
      pathNobill.classList.remove('active');
      billPath.style.display = 'block';
      nobillPath.style.display = 'none';
    });
    pathNobill.addEventListener('click', () => {
      pathNobill.classList.add('active');
      pathBill.classList.remove('active');
      billPath.style.display = 'none';
      nobillPath.style.display = 'block';
    });
  }

  if (form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      console.log('Lead:', data);
      // TODO: wire to email / Formspree / Vercel function so Jessie receives each lead
      form.style.display = 'none';
      if (success) success.style.display = 'block';
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