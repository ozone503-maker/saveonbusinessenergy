// GET /api/goal — Goal Tracker counts (DRAFT v3). No framework. v3: NO AUTH.
// Counts only, never guesses. new_contacts = deduped contacts whose
// date_added is that day AND whose email is real (the contacts table
// only ever holds real emails — bad ones are flagged at ingest, never
// imported). new_leads = leads whose date_found is that day.
// GET  -> { today: {date, new_contacts, new_leads, target:200, shortfall},
//           week: [{date, new_contacts, new_leads}... 7 days],
//           breakdown: { by_route, by_contributor } for today }
// The daily_counts row is refreshed by the scheduled run at the end of
// each run; this endpoint also computes live from contacts/leads so the
// dashboard is never stale if a run has not closed the day yet.
const db = require('./_db');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const today = await db.query(
      "SELECT CURRENT_DATE AS date, " +
      "(SELECT COUNT(*)::int FROM contacts WHERE date_added = CURRENT_DATE) AS new_contacts, " +
      "(SELECT COUNT(*)::int FROM leads WHERE date_found = CURRENT_DATE) AS new_leads");
    const week = await db.query(
      "SELECT d::date AS date, " +
      "(SELECT COUNT(*)::int FROM contacts WHERE date_added = d::date) AS new_contacts, " +
      "(SELECT COUNT(*)::int FROM leads WHERE date_found = d::date) AS new_leads " +
      "FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS d " +
      "ORDER BY date ASC");
    const byRoute = await db.query(
      "SELECT route, COUNT(*)::int AS n FROM leads WHERE date_found = CURRENT_DATE GROUP BY route ORDER BY n DESC");
    const byContributor = await db.query(
      "SELECT COALESCE(contributed_by, 'hunted') AS contributor, COUNT(*)::int AS n " +
      "FROM contacts WHERE date_added = CURRENT_DATE GROUP BY contributed_by ORDER BY n DESC");
    const t = today.rows[0];
    const target = 200;
    return res.status(200).json({
      today: { date: t.date, new_contacts: t.new_contacts, new_leads: t.new_leads,
               target, shortfall: Math.max(0, target - t.new_contacts) },
      week: week.rows,
      breakdown: {
        by_route: Object.fromEntries(byRoute.rows.map((r) => [r.route, r.n])),
        by_contributor: Object.fromEntries(byContributor.rows.map((r) => [r.contributor, r.n])),
      },
    });
  } catch (err) {
    console.error('goal GET failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not load goal counts.' });
  }
};
