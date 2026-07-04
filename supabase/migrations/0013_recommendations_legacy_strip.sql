-- ═════════════════════════════════════════════════════════════════════════════
--  0013_recommendations_legacy_strip.sql
--  IT-037 phase 2 of 3 (InnerTable v0.3.0)
--
--  Drop the columns of recommendations_legacy that are now sourced from
--  places (place fields) and entries (per-user fields).  What remains is a
--  thin audit trail — id, author_id, place_id, created_at, updated_at — for
--  cross-checking the entries backfill if anything looks off.
--
--  ROLLBACK: restore from scripts/backup-recommendations-2026-07-04.sql
--  (recreates the full table as recommendations_restored).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.recommendations_legacy
  -- place fields (now on public.places)
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS place_type,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS google_place_id,
  DROP COLUMN IF EXISTS cuisine,
  DROP COLUMN IF EXISTS price,
  -- per-user fields (now on public.entries)
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS rating,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS try_note,
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS factor_ratings;

-- VERIFY (expect exactly: id, author_id, created_at, updated_at, place_id):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'recommendations_legacy'
--   ORDER BY ordinal_position;
