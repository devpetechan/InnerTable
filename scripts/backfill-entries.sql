-- =============================================================================
-- Backfill: scripts/backfill-entries.sql
-- One-time script to populate public.entries from public.recommendations.
-- Each (author_id, place_id) pair becomes exactly one entry; if the legacy
-- table contains multiple rows for the same pair, the most-recent row wins.
--
-- PREREQUISITES
-- ─────────────────────────────────────────────────────────────────
--   1. Migration 0007_places.sql has been applied
--   2. scripts/backfill-places.sql has been run
--      (so every public.recommendations row has a non-NULL place_id)
--   3. Migration 0008_entries.sql has been applied
--
-- Run this in the Supabase SQL editor (or psql).  The whole script is
-- wrapped in a transaction; any verification failure rolls back cleanly.
--
-- DEDUP RULE
-- ─────────────────────────────────────────────────────────────────
-- "Most recent take wins" — if you previously rated Joe's Pizza twice,
-- your latest take is the one we treat as your current opinion.
-- Implemented via DISTINCT ON (author_id, place_id) ORDER BY created_at DESC.
--
-- STATUS MAPPING
-- ─────────────────────────────────────────────────────────────────
--   legacy 'try'             → 'try'
--   legacy 'recommended'     → 'been-recommend'
--   legacy 'not-recommended' → 'been-skip'
--   legacy NULL              → NULL
--
-- RATING MAPPING
-- ─────────────────────────────────────────────────────────────────
-- New rating columns are 1..5 with NULL = not rated.  Legacy overall
-- rating is already CHECK'd to 1..5 in the source schema, so it copies
-- through unchanged.  Factor ratings come from an unconstrained jsonb
-- blob (factor_ratings) that historically used 0 as a "not rated"
-- sentinel — those zeros are normalised to NULL on the way in.  Any
-- other out-of-range value will trip the CHECK constraint on entries
-- and roll the transaction back, surfacing genuinely dirty data.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotency guard
-- Bail out immediately if the entries table already has rows, so accidentally
-- re-running this script doesn't double-insert or partially overwrite.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.entries) > 0 THEN
    RAISE EXCEPTION 'entries table already populated — backfill already ran';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Prereq check: every recommendations row must have a place_id by now.
-- If any are NULL, scripts/backfill-places.sql wasn't run (or didn't finish).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.recommendations
  WHERE place_id IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill entries: % recommendation row(s) have place_id IS NULL — run scripts/backfill-places.sql first',
      v_missing;
  END IF;
END $$;


-- =============================================================================
-- PHASE 1: INSERT one entry per (author_id, place_id), most recent wins
-- =============================================================================
INSERT INTO public.entries (
  user_id,
  place_id,
  status,
  overall_rating,
  quality,
  service,
  value,
  ambiance,
  notes,
  try_note,
  url,
  created_at,
  updated_at
)
SELECT DISTINCT ON (r.author_id, r.place_id)
  r.author_id                                                                 AS user_id,
  r.place_id                                                                  AS place_id,

  -- Status mapping: legacy → new
  CASE r.status
    WHEN 'try'             THEN 'try'
    WHEN 'recommended'     THEN 'been-recommend'
    WHEN 'not-recommended' THEN 'been-skip'
    ELSE NULL
  END                                                                         AS status,

  -- Overall rating: legacy column is already 1..5 (NULL passes through)
  r.rating                                                                    AS overall_rating,

  -- Factor ratings: pull each key out of the legacy jsonb blob.
  -- Outer NULLIF(..., 0) converts the legacy "0 means not rated" sentinel
  -- into a real NULL.  Inner NULLIF(..., '') handles empty-string values.
  -- Anything else outside 1..5 will trip the CHECK constraint, which is the
  -- desired behaviour — it surfaces genuinely dirty data.
  NULLIF(NULLIF(r.factor_ratings ->> 'quality',  '')::int, 0)                 AS quality,
  NULLIF(NULLIF(r.factor_ratings ->> 'service',  '')::int, 0)                 AS service,
  NULLIF(NULLIF(r.factor_ratings ->> 'value',    '')::int, 0)                 AS value,
  NULLIF(NULLIF(r.factor_ratings ->> 'ambiance', '')::int, 0)                 AS ambiance,

  r.notes                                                                     AS notes,
  r.try_note                                                                  AS try_note,
  r.url                                                                       AS url,

  -- Carry the chosen row's timestamps through (it's their "current take")
  r.created_at                                                                AS created_at,
  r.updated_at                                                                AS updated_at
FROM public.recommendations r
WHERE r.place_id IS NOT NULL
ORDER BY
  r.author_id,
  r.place_id,
  r.created_at DESC;        -- most recent row per (user, place) wins


-- =============================================================================
-- PHASE 2: Verification
-- Reports counts and raises an exception (rolling back the transaction) if
-- the row counts don't reconcile against the legacy table.
-- =============================================================================
DO $$
DECLARE
  v_entries_count        bigint;
  v_legacy_distinct_pairs bigint;
  v_orphan_users         bigint;
  v_orphan_places        bigint;
BEGIN
  SELECT count(*) INTO v_entries_count FROM public.entries;

  SELECT count(*)
    INTO v_legacy_distinct_pairs
    FROM (
      SELECT DISTINCT author_id, place_id
      FROM public.recommendations
      WHERE place_id IS NOT NULL
    ) AS distinct_pairs;

  -- Sanity: every entry should reference a real user and a real place.
  -- The FKs make this impossible at INSERT time, but checking is cheap.
  SELECT count(*) INTO v_orphan_users
    FROM public.entries e
    WHERE NOT EXISTS (SELECT 1 FROM public.users  u WHERE u.id = e.user_id);

  SELECT count(*) INTO v_orphan_places
    FROM public.entries e
    WHERE NOT EXISTS (SELECT 1 FROM public.places p WHERE p.id = e.place_id);

  RAISE NOTICE 'Entries backfill complete';
  RAISE NOTICE '  Entries created                       : %', v_entries_count;
  RAISE NOTICE '  Distinct (author, place) in legacy    : %', v_legacy_distinct_pairs;
  RAISE NOTICE '  Entries with missing user FK target   : %', v_orphan_users;
  RAISE NOTICE '  Entries with missing place FK target  : %', v_orphan_places;

  IF v_entries_count <> v_legacy_distinct_pairs THEN
    RAISE EXCEPTION
      'Backfill FAILED: entries count (%) does not match legacy distinct (author, place) count (%) — transaction rolled back',
      v_entries_count, v_legacy_distinct_pairs;
  END IF;

  IF v_orphan_users > 0 OR v_orphan_places > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: orphan FK references found (users: %, places: %) — transaction rolled back',
      v_orphan_users, v_orphan_places;
  END IF;
END $$;

COMMIT;
