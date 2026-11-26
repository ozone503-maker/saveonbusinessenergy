// POST /api/tex-session
// Mints a Speko voice session for Wittenbot2.0 (agent_d0fba82181084a1d)
// only the short-lived, browser-safe transport credentials.
// SPEKO_API_KEY never leaves this function. Set it in Vercel:
// Project Settings -> Environment Variables -> SPEKO_API_KEY.

const SPEKO_API_URL = 'https://api.speko.dev/v1/sessions';
const AGENT_ID = 'agent_d0fba82181084a1d';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SPEKO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'SPEKO_API_KEY is not configured on the server.',
    });
  }

  let session;
  try {
    const r = await fetch(SPEKO_API_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'cascade', agentId: AGENT_ID }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({
        error: 'Speko could not start a session.',
        detail: data.error || data.message || ('Speko HTTP ' + r.status),
      });
    }
    session = data;
  } catch (err) {
    return res.status(502).json({
      error: 'Could not reach Speko.',
      detail: String(err && err.message ? err.message : err),
    });
  }

  if (!session.transportToken || !session.transportUrl) {
    return res.status(502).json({
      error: 'Speko returned a session without transport credentials.',
    });
  }

  // Forward only these three fields. Nothing else (no API key, no agent config).
  return res.status(200).json({
    transport: session.transport || 'livekit',
    transportToken: session.transportToken,
    transportUrl: session.transportUrl,
  });
};
