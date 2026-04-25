-- =============================================================================
-- Migration: 0008_entries.sql
-- Creates public.entries — one row per (user, place) — replacing the
-- denormalized public.recommendations table (IT-033, InnerTable v0.3.0).
--
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────
-- v0.2 stored every "take" (a user's opinion of a venue) as a row in
-- recommendations, with the place fields denormalized into the same row.
-- That meant the same restaurant rated by three friends produced three
-- duplicate place rows.
--
-- v0.3 splits the model into two clean entities:
--   - public.places   — one row per physical venue (created in 0007_places.sql)
--   - public.entries  — one row per (user, place) — this migration
--
-- The unique (user_id, place_id) constraint enforces the rule at the DB
-- level, replacing the duplicate-detection modal that used to handle this
-- in the UI.
--
-- STATUS VALUES
-- ─────────────────────────────────────────────────────────────────
-- The legacy 'recommended' / 'not-recommended' values are renamed to
-- 'been-recommend' / 'been-skip' to read more naturally as past-tense
-- actions ("I've been there and recommend it" / "I've been and would
-- skip it").  'try' is unchanged.  Backfill performs the mapping.
--
-- RATING VALUES
-- ─────────────────────────────────────────────────────────────────
-- All rating columns (overall_rating + the four factors) are 1..5 with
-- NULL meaning "not rated".  This keeps the rating scale clean — 0 isn't
-- a real rating, so it shouldn't share a column with real ratings.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.entries
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entries (
  -- Identity
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users  (id) ON DELETE CASCADE,
  place_id        uuid        NOT NULL REFERENCES public.places (id) ON DELETE RESTRICT,

  -- One entry per (user, place) — enforced at the DB level
  CONSTRAINT entries_user_place_unique UNIQUE (user_id, place_id),

  -- The user's stance on this place
  status          text        CHECK (status IN ('try', 'been-recommend', 'been-skip')),

  -- Overall rating (NULL = not rated)
  overall_rating  int         CHECK (overall_rating BETWEEN 1 AND 5),

  -- Factor ratings, each 1..5 (NULL = not rated)
  quality         int         CHECK (quality  BETWEEN 1 AND 5),
  service         int         CHECK (service  BETWEEN 1 AND 5),
  value           int         CHECK (value    BETWEEN 1 AND 5),
  ambiance        int         CHECK (ambiance BETWEEN 1 AND 5),

  -- Free-text fields
  notes           text,
  try_note        text,
  url             text,

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 2. TRIGGER: auto-update updated_at on every row change
--    Reuses set_updated_at() defined in 0002_recommendations.sql.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_entries_updated_at ON public.entries;

CREATE TRIGGER set_entries_updated_at
  BEFORE UPDATE ON public.entries
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all entries (the whole point is sharing)
DROP POLICY IF EXISTS "authenticated users can read all entries" ON public.entries;
CREATE POLICY "authenticated users can read all entries"
  ON public.entries
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert entries where they are the user_id
DROP POLICY IF EXISTS "users can insert own entries" ON public.entries;
CREATE POLICY "users can insert own entries"
  ON public.entries
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own entries
DROP POLICY IF EXISTS "users can update own entries" ON public.entries;
CREATE POLICY "users can update own entries"
  ON public.entries
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own entries
DROP POLICY IF EXISTS "users can delete own entries" ON public.entries;
CREATE POLICY "users can delete own entries"
  ON public.entries
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 4. INDEXES
--    (user_id, place_id) is already covered by the UNIQUE constraint above,
--    which Postgres backs with a btree index — that index also serves
--    "find this user's entry for this place" lookups.
--
--    Add an index on place_id alone for the dominant UI query:
--    "given a place, fetch every friend's entry for it".
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS entries_place_id_idx
  ON public.entries (place_id);
