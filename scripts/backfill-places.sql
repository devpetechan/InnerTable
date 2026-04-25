-- =============================================================================
-- Backfill: scripts/backfill-places.sql
-- One-time script to populate public.places from existing recommendations and
-- stamp every recommendation with its place_id FK.
--
-- Run AFTER applying 0007_places.sql.
-- Run this in the Supabase SQL editor (or psql).  The whole script is wrapped
-- in a transaction; if any assertion fails it rolls back cleanly.
--
-- DEDUP TIERS
-- ─────────────────────────────────────────────────────────────────
--   Bucket A — google_place_id IS NOT NULL
--     Gold standard.  Google's globally-unique ID merges any rows that refer
--     to the same physical venue, regardless of how the name was typed.
--
--   Bucket B — google_place_id IS NULL, lat IS NOT NULL, lng IS NOT NULL
--     Groups by (lower(trim(name)), round(lat,4), round(lng,4)).
--     4-decimal rounding ≈ 11 m precision — absorbs GPS jitter without
--     merging neighbouring venues.
--
--   Bucket C — everything else
--     Groups by (lower(trim(name)), lower(trim(coalesce(location,'')))).
--     Last resort; produces false negatives rather than false merges.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotency guard
-- Bail out immediately if the table already has rows, so accidentally
-- re-running this script doesn't double-insert.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.places) > 0 THEN
    RAISE EXCEPTION 'places table already populated — backfill already ran';
  END IF;
END $$;


-- =============================================================================
-- PHASE 1: INSERT one place row per unique venue
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bucket A: rows with google_place_id IS NOT NULL
-- Group by google_place_id; pick the earliest row as canonical.
-- -----------------------------------------------------------------------------
INSERT INTO public.places
  (google_place_id, name, location, lat, lng, place_type, cuisine, price, created_by)
SELECT DISTINCT ON (r.google_place_id)
  r.google_place_id,
  r.name,
  r.location,
  r.lat,
  r.lng,
  r.place_type,
  r.cuisine,
  r.price,
  r.author_id
FROM public.recommendations r
WHERE r.google_place_id IS NOT NULL
ORDER BY r.google_place_id, r.created_at ASC;


-- -----------------------------------------------------------------------------
-- Bucket B: no google_place_id, but lat/lng are present
-- Group by (lower(trim(name)), round(lat,4), round(lng,4)); earliest row wins.
-- -----------------------------------------------------------------------------
INSERT INTO public.places
  (name, location, lat, lng, place_type, cuisine, price, created_by)
SELECT DISTINCT ON (lower(trim(r.name)), round(r.lat::numeric, 4), round(r.lng::numeric, 4))
  r.name,
  r.location,
  r.lat,
  r.lng,
  r.place_type,
  r.cuisine,
  r.price,
  r.author_id
FROM public.recommendations r
WHERE r.google_place_id IS NULL
  AND r.lat IS NOT NULL
  AND r.lng IS NOT NULL
ORDER BY
  lower(trim(r.name)),
  round(r.lat::numeric, 4),
  round(r.lng::numeric, 4),
  r.created_at ASC;


-- -----------------------------------------------------------------------------
-- Bucket C: no google_place_id, no coordinates
-- Group by (lower(trim(name)), lower(trim(coalesce(location,'')))); earliest wins.
-- -----------------------------------------------------------------------------
INSERT INTO public.places
  (name, location, lat, lng, place_type, cuisine, price, created_by)
SELECT DISTINCT ON (lower(trim(r.name)), lower(trim(coalesce(r.location, ''))))
  r.name,
  r.location,
  r.lat,
  r.lng,
  r.place_type,
  r.cuisine,
  r.price,
  r.author_id
FROM public.recommendations r
WHERE r.google_place_id IS NULL
  AND (r.lat IS NULL OR r.lng IS NULL)
ORDER BY
  lower(trim(r.name)),
  lower(trim(coalesce(r.location, ''))),
  r.created_at ASC;


-- =============================================================================
-- PHASE 2: Stamp every recommendation with its place_id
-- =============================================================================

-- Bucket A: match on google_place_id (exact)
UPDATE public.recommendations r
SET place_id = p.id
FROM public.places p
WHERE r.place_id IS NULL
  AND r.google_place_id IS NOT NULL
  AND p.google_place_id IS NOT NULL
  AND r.google_place_id = p.google_place_id;


-- Bucket B: match on rounded coordinates + normalised name
UPDATE public.recommendations r
SET place_id = p.id
FROM public.places p
WHERE r.place_id IS NULL
  AND r.google_place_id IS NULL
  AND r.lat IS NOT NULL
  AND r.lng IS NOT NULL
  AND p.google_place_id IS NULL
  AND p.lat IS NOT NULL
  AND p.lng IS NOT NULL
  AND lower(trim(r.name)) = lower(trim(p.name))
  AND round(r.lat::numeric, 4) = round(p.lat::numeric, 4)
  AND round(r.lng::numeric, 4) = round(p.lng::numeric, 4);


-- Bucket C: match on normalised name + location string
UPDATE public.recommendations r
SET place_id = p.id
FROM public.places p
WHERE r.place_id IS NULL
  AND r.google_place_id IS NULL
  AND (r.lat IS NULL OR r.lng IS NULL)
  AND p.google_place_id IS NULL
  AND (p.lat IS NULL OR p.lng IS NULL)
  AND lower(trim(r.name))                    = lower(trim(p.name))
  AND lower(trim(coalesce(r.location, '')))  = lower(trim(coalesce(p.location, '')));


-- =============================================================================
-- PHASE 3: Verification
-- Reports counts and raises an exception (rolling back the transaction) if
-- either of the two "must be 0" invariants is violated.
-- =============================================================================
DO $$
DECLARE
  v_places_count  bigint;
  v_null_place_id bigint;
  v_orphan_places bigint;
BEGIN
  SELECT count(*)   INTO v_places_count  FROM public.places;

  SELECT count(*)   INTO v_null_place_id
  FROM public.recommendations
  WHERE place_id IS NULL;

  SELECT count(*)   INTO v_orphan_places
  FROM public.places p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.recommendations r WHERE r.place_id = p.id
  );

  RAISE NOTICE 'Backfill complete: % distinct place(s) created', v_places_count;
  RAISE NOTICE '  Recommendations with place_id IS NULL : %', v_null_place_id;
  RAISE NOTICE '  Orphan places (no linked recommendation): %', v_orphan_places;

  IF v_null_place_id > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: % recommendation(s) still have no place_id — transaction rolled back',
      v_null_place_id;
  END IF;

  IF v_orphan_places > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: % orphan place(s) have no linked recommendation — transaction rolled back',
      v_orphan_places;
  END IF;
END $$;

COMMIT;
