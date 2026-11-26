'use strict';
const bill = document.querySelector('#monthly-bill');
const reduction = document.querySelector('#reduction');
const error = document.querySelector('#bill-error');
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function updateSavings() {
  const amount = Number(bill.value);
  const valid = bill.value.trim() !== '' && Number.isFinite(amount) && amount >= 0 && amount <= 100000000;
  error.hidden = valid;
  bill.setAttribute('aria-invalid', String(!valid));
  document.querySelector('#reduction-value').textContent = `${reduction.value}%`;
  const monthly = valid ? amount * Number(reduction.value) / 100 : null;
  document.querySelector('#annual-savings').textContent = valid ? dollars.format(monthly * 12) : '—';
  document.querySelector('#monthly-savings').textContent = valid ? dollars.format(monthly) : '—';
}
bill.addEventListener('input', updateSavings);
reduction.addEventListener('input', updateSavings);
document.querySelector('#year').textContent = new Date().getFullYear();
updateSavings();
