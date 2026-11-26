document.getElementById('lead-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const form = e.target;
  const success = document.getElementById('form-success');
  
  // In production, replace with your form endpoint (Formspree, Vercel, etc.)
  // For now, simulate success
  form.style.display = 'none';
  success.style.display = 'block';
  
  // Optional: console log the data for testing
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  console.log('Lead captured:', data);
});

// Smooth scroll for CTAs
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});