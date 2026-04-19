-- =============================================================================
-- Migration: 0002_recommendations.sql
-- Creates public.recommendations table (v0.2 — denormalized, mirrors Firebase shape).
-- Schema will be normalized further in v0.3.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.recommendations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recommendations (
  -- Identity
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id        uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  -- Place details
  name             text,
  place_type       text,
  location         text,
  lat              double precision,
  lng              double precision,
  google_place_id  text,

  -- Recommendation fields
  status           text        CHECK (status IN ('try', 'recommended', 'not-recommended')),
  rating           int         CHECK (rating BETWEEN 1 AND 5),
  cuisine          text,
  price            text,
  notes            text,
  try_note         text,
  url              text,

  -- Factor ratings: { quality, service, value, ambiance } — each 1-5
  factor_ratings   jsonb,

  -- Timestamps
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 2. TRIGGER: auto-update updated_at on every row change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_recommendations_updated_at ON public.recommendations;

CREATE TRIGGER set_recommendations_updated_at
  BEFORE UPDATE ON public.recommendations
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all recommendations
DROP POLICY IF EXISTS "authenticated users can read all recommendations" ON public.recommendations;
CREATE POLICY "authenticated users can read all recommendations"
  ON public.recommendations
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert rows where they are the author
DROP POLICY IF EXISTS "users can insert own recommendations" ON public.recommendations;
CREATE POLICY "users can insert own recommendations"
  ON public.recommendations
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- Users can only update their own rows
DROP POLICY IF EXISTS "users can update own recommendations" ON public.recommendations;
CREATE POLICY "users can update own recommendations"
  ON public.recommendations
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Users can only delete their own rows
DROP POLICY IF EXISTS "users can delete own recommendations" ON public.recommendations;
CREATE POLICY "users can delete own recommendations"
  ON public.recommendations
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());
