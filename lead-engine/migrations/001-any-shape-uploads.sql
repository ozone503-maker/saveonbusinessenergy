-- SOBE Lead Engine — migration 001: any-shape uploads (v6)
-- Run ONCE against the live Neon database ("sobe-leads"). Safe to run
-- twice: every statement is IF NOT EXISTS / guarded.
-- What it does:
--   1. uploads.file_type — 'file' (csv/xlsx, imported on the spot) or
--      'photo' (queued, read on the next run).
--   2. uploads.status gains 'queued' (photo uploads wait for the run).
--   3. upload_files — holds the photo itself (base64, max 3 MB) until
--      the next run reads it and imports the rows.
-- How to run (Neon dashboard → the database → Query editor, paste
-- this whole file — if the editor rejects multiple commands at once,
-- run the statements one at a time, in order):
--   1) ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'file';
--   2) ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_status_check;
--   3) ALTER TABLE uploads ADD CONSTRAINT uploads_status_check CHECK (status IN ('done', 'partial', 'failed', 'queued'));
--   4) CREATE TABLE IF NOT EXISTS upload_files ( ... ) — see below.
-- After running, confirm with:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name IN ('uploads', 'upload_files') AND column_name IN ('file_type', 'data_base64');

ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'file';

ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_status_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_status_check
  CHECK (status IN ('done', 'partial', 'failed', 'queued'));

CREATE TABLE IF NOT EXISTS upload_files (
  id          SERIAL PRIMARY KEY,
  upload_id   INTEGER NOT NULL REFERENCES uploads (id),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  data_base64 TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_files_upload_idx ON upload_files (upload_id);
