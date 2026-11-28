// RETIRED in v3 (2026-11-27, Jessie's explicit call).
// The password-free magic-link / 6-digit-code login from v2 is REMOVED.
// There is no sign-in, no code, no session, no allowlist any more.
// This file is kept only so a stale link to /api/leads-auth does not
// 404 silently: it answers 410 Gone and says plainly that auth is gone.
// Do not revive the code flow without Jessie's explicit order.
module.exports = async function handler(req, res) {
  return res.status(410).json({
    error: 'Sign-in has been removed. The hidden dashboard is open — no login, no code. See the v3 README.',
    auth: 'none',
  });
};
