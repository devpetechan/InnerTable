-- =============================================================================
-- Migration: 0007_places.sql
-- Creates public.places as a first-class entity, splitting "a physical place"
-- from "a user's experience of it" (IT-032, InnerTable v0.3.0).
--
-- DEDUP RATIONALE (also documented in scripts/backfill-places.sql)
-- ─────────────────────────────────────────────────────────────────
-- Three tiers are used to identify a canonical place record from the
-- existing denormalised recommendations rows:
--
--   Bucket A — google_place_id IS NOT NULL
--     Google's globally-unique Place ID is the gold standard.  Multiple rows
--     like "Joe's Pizza", "Joes Pizza Brooklyn", and "Joe's Pizza (NY)" that
--     all share the same Google ID collapse into a single place.
--
--   Bucket B — google_place_id IS NULL, lat/lng present
--     Handles places added before Google Places autocomplete was wired up, or
--     places not in Google's index.  Rows are grouped by
--     (lower(trim(name)), round(lat,4), round(lng,4)).  Rounding to 4 decimal
--     places ≈ 11 m precision, which absorbs GPS jitter without merging
--     neighbouring venues.
--
--   Bucket C — everything else (no google_place_id, no coordinates)
--     Last resort: group by (lower(trim(name)), lower(trim(location))).
--     Produces some false negatives ("Joe's Pizza" vs "Joes Pizza" with no
--     location string won't merge), which is acceptable — we'd rather miss a
--     real merge than create a false one.  Manual merging can happen later.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.places
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.places (
  -- Identity
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Google Places integration (unique, nullable — not every place has one)
  google_place_id  text        UNIQUE,

  -- Core place fields
  name             text        NOT NULL,
  location         text,
  lat              double precision,
  lng              double precision,
  place_type       text,
  cuisine          text,
  price            text,

  -- Provenance
  created_by       uuid        REFERENCES public.users (id) ON DELETE SET NULL,

  -- Timestamps
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 2. TRIGGER: auto-update updated_at on every row change
--    Reuses set_updated_at() defined in 0002_recommendations.sql.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_places_updated_at ON public.places;

CREATE TRIGGER set_places_updated_at
  BEFORE UPDATE ON public.places
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all places (shared infrastructure)
DROP POLICY IF EXISTS "authenticated users can read all places" ON public.places;
CREATE POLICY "authenticated users can read all places"
  ON public.places
  FOR SELECT
  TO authenticated
  USING (true);

-- Any authenticated user can create a place, but must set themselves as creator
DROP POLICY IF EXISTS "authenticated users can insert places" ON public.places;
CREATE POLICY "authenticated users can insert places"
  ON public.places
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- UPDATE / DELETE: skipped for now.
-- We'll add admin-only or creator-only policies in a later release once the
-- moderation model is decided (IT-038 or similar).


-- -----------------------------------------------------------------------------
-- 4. INDEXES
--    google_place_id is covered by its UNIQUE constraint above.
--    Add a functional index on lower(name) for Bucket B/C dedup fallback
--    queries used during the backfill and any future dedup look-ups.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS places_lower_name_idx
  ON public.places (lower(name));


-- -----------------------------------------------------------------------------
-- 5. ALTER recommendations: add place_id foreign key
--    Nullable initially so the backfill (scripts/backfill-places.sql) can
--    populate it incrementally.  Will be tightened to NOT NULL in a later
--    migration once IT-033 (entries table) replaces this table and IT-037
--    (drop legacy columns) ships.
-- -----------------------------------------------------------------------------
ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES public.places (id) ON DELETE RESTRICT;


-- -----------------------------------------------------------------------------
-- 6. INDEX on recommendations.place_id (primary join key for all UI queries)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS recommendations_place_id_idx
  ON public.recommendations (place_id);
