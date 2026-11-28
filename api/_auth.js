// v3 — NO AUTH. Removed 2026-11-27 on Jessie's explicit call.
// Nobody else will ever know the hidden page's address, so there is no
// security need. The page is unlisted, noindex, and linked from no public
// page, nav, or sitemap — the URL itself is the only protection, per Jessie.
// Anyone using the machine can push: Jessie, Gavin, or another bot.
// This file exists only so old `require('./_auth')` lines do not break
// if a stray copy survives, and to give every endpoint one shared helper
// for the audit-only author field. It performs NO login check, NO code
// check, NO session check, and reads NO password / code / session table.
// There is nothing to log in to. Do not re-add a gate here without
// Jessie's explicit order reversing this one.
//
// Audit only: POST bodies may carry `author` — 'Jessie', 'Gavin', or a
// bot name — Jessie or Muse only. It is recorded as-is for the audit
// trail (uploads.received_by, blasts.approved_by, agents.updated_by).
// It is NOT verified. Anyone can write any author string.
function auditAuthor(body, fallback) {
  const a = body && typeof body.author === 'string' ? body.author.trim() : '';
  if (a) return a.slice(0, 80);
  return fallback || 'Jessie';
}
function receivedBy(author) {
  return author === 'Gavin' ? 'Gavin' : 'Jessie';
}
module.exports = { auditAuthor, receivedBy };
