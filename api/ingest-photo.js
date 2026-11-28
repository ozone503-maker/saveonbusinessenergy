// POST / GET /api/ingest-photo — photo of a list (v6).
// Same CommonJS style as api/ingest.js. No framework.
//
// A photo of a list can't be read by code on this stack — there is no
// OCR service connected and no new paid service is allowed. So a photo
// is QUEUED, not imported on the spot: the page sends the image here,
// we store it with the contributor who gave it to us, and the next
// scheduled Muse run reads it (the run fetches the image, reads the
// rows off it, and imports them through /api/ingest under the same
// contributor label and the same rules — dedupe, flag bad /
// out-of-territory rows, never invent a field). The page says this
// plainly: "Photo lists get read on the next run — check back after it
// runs."
//
// POST { contributor_name, filename?, mime?, image_base64, author? }
//   contributor_name is REQUIRED — front end accepts every list, and
//   every row is still labelled with who gave it to us.
//   image_base64: the image as a data-URL or raw base64 string.
//   Cap: 3 MB of image bytes (~4 MB base64) — Vercel serverless
//   functions reject bigger request bodies. Bigger photo? Take it
//   again closer, or screenshot the list instead.
//   Creates a contributor row (first use), an uploads row with
//   status 'queued' + file_type 'photo', and an upload_files row
//   holding the image. The run clears the image data after import
//   (the record stays for audit; the photo itself does not pile up).
// GET  -> { uploads: [queued photo uploads, newest first] }
// GET ?upload_id=N -> { upload, image_base64 } — the full image, for
//   the scheduled run to read. (No browser ever needs this.)

const db = require('./_db');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const id = req.query && req.query.upload_id ? Number(req.query.upload_id) : null;
    try {
      if (id) {
        const u = await db.query('SELECT * FROM uploads WHERE id = $1 AND file_type = $2 LIMIT 1', [id, 'photo']);
        if (!u.rows.length) return res.status(404).json({ error: 'No photo upload with that id.' });
        const f = await db.query('SELECT data_base64 FROM upload_files WHERE upload_id = $1 LIMIT 1', [id]);
        return res.status(200).json({
          upload: db.publicUpload(u.rows[0]),
          image_base64: f.rows.length ? f.rows[0].data_base64 : null,
        });
      }
      const uploads = await db.query(
        "SELECT * FROM uploads WHERE file_type = 'photo' ORDER BY received_at DESC LIMIT 50"
      );
      return res.status(200).json({ uploads: uploads.rows.map(db.publicUpload) });
    } catch (err) {
      console.error('ingest-photo GET failed', err.code || err.message);
      return res.status(500).json({ error: 'Could not load photo uploads.' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Body is not valid JSON.' });
  }

  const receivedBy = String(body.author || 'Jessie').trim().slice(0, 80) || 'Jessie';
  const contributorName = clean(body.contributor_name);
  const filename = clean(body.filename) || 'photo.jpg';
  const mime = clean(body.mime) || 'image/jpeg';
  if (!contributorName) {
    return res.status(400).json({ error: 'contributor_name is required — who gave us this list?' });
  }
  let b64 = clean(body.image_base64);
  if (!b64) return res.status(400).json({ error: 'No photo was sent.' });
  // Accept a data URL ("data:image/jpeg;base64,...") or raw base64.
  const m = b64.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (m) b64 = m[1];
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) {
    return res.status(400).json({ error: 'That photo did not arrive as an image — try again.' });
  }
  const bytes = Math.floor((b64.replace(/\s/g, '').length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return res.status(400).json({
      error: 'That photo is too big (over 3 MB). Take it again closer, or screenshot the list instead.',
    });
  }
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mime) && mime !== 'image/jpeg') {
    return res.status(400).json({ error: 'Photos only — JPG or PNG.' });
  }

  try {
    const contrib = await db.query(
      'INSERT INTO contributors (name, kind) VALUES ($1, $2) ' +
        'ON CONFLICT (lower(btrim(name))) DO UPDATE SET name = EXCLUDED.name RETURNING *',
      [contributorName, clean(body.contributor_kind) || 'referral partner']
    );
    const contributor = contrib.rows[0];

    const upload = await db.query(
      "INSERT INTO uploads (contributor_id, contributor_name, filename, source_label, file_type, rows_total, received_by, status) " +
        "VALUES ($1, $2, $3, 'photo of a list', 'photo', 0, $4, 'queued') RETURNING *",
      [contributor.id, contributorName, filename, receivedBy]
    );
    const uploadId = upload.rows[0].id;

    await db.query(
      'INSERT INTO upload_files (upload_id, filename, mime, data_base64) VALUES ($1, $2, $3, $4)',
      [uploadId, filename, mime, b64]
    );

    return res.status(201).json({
      upload_id: uploadId,
      contributor: contributorName,
      status: 'queued',
      message:
        'Photo saved — we read it on the next run and the rows show up here. Check back after the run.',
    });
  } catch (err) {
    console.error('ingest-photo POST failed', err.code || err.message);
    return res.status(500).json({ error: 'Could not save the photo — try again.' });
  }
};
