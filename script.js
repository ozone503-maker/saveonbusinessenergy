document.getElementById('lead-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const form = e.target;
  const success = document.getElementById('form-success');
  form.style.display = 'none';
  success.style.display = 'block';
  const data = Object.fromEntries(new FormData(form));
  console.log('Lead:', data);
  // TODO: wire to email / Formspree / Vercel function
});

document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const t = document.querySelector(a.getAttribute('href'));
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  });
});
