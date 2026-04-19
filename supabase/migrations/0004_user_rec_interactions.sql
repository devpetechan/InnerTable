-- =============================================================================
-- Migration: 0004_user_rec_interactions.sql
-- Per-user data for each recommendation: status, tried flag, ratings.
--
-- Why this table?
--   Firebase stored userStatuses, userRatings, and triedBy as nested nodes
--   inside each recommendation.  In Supabase we give them their own table so
--   any authenticated user can write their own row without needing UPDATE
--   permission on the recommendations row (which is restricted to the author).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.user_rec_interactions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_rec_interactions (
  recommendation_id  uuid        NOT NULL REFERENCES public.recommendations (id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  -- The user's visit / intent status for this recommendation
  -- NULL means no explicit status has been recorded yet
  status             text        CHECK (status IN ('want-to-go', 'been-recommend', 'been-skip')),

  -- Whether the user has physically visited this place
  tried              boolean     NOT NULL DEFAULT false,

  -- Per-user ratings (NULL when not yet rated)
  rating_overall     int         CHECK (rating_overall BETWEEN 1 AND 5),
  rating_quality     int         CHECK (rating_quality  BETWEEN 0 AND 5),
  rating_service     int         CHECK (rating_service  BETWEEN 0 AND 5),
  rating_value       int         CHECK (rating_value    BETWEEN 0 AND 5),
  rating_ambiance    int         CHECK (rating_ambiance BETWEEN 0 AND 5),

  -- When this row was last changed (used to surface recent activity)
  ts                 timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (recommendation_id, user_id)
);


-- -----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_rec_interactions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all interactions
DROP POLICY IF EXISTS "authenticated users can read all interactions" ON public.user_rec_interactions;
CREATE POLICY "authenticated users can read all interactions"
  ON public.user_rec_interactions
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own rows
DROP POLICY IF EXISTS "users can insert own interactions" ON public.user_rec_interactions;
CREATE POLICY "users can insert own interactions"
  ON public.user_rec_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own rows
DROP POLICY IF EXISTS "users can update own interactions" ON public.user_rec_interactions;
CREATE POLICY "users can update own interactions"
  ON public.user_rec_interactions
  FOR UPDATE
  TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own rows
DROP POLICY IF EXISTS "users can delete own interactions" ON public.user_rec_interactions;
CREATE POLICY "users can delete own interactions"
  ON public.user_rec_interactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 3. REALTIME
-- Add this table to the supabase_realtime publication so the app receives
-- live change events.  (You can also enable this in the Supabase dashboard
-- under Database → Replication if the ALTER PUBLICATION command fails on
-- your project tier.)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_rec_interactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication, skip
END;
$$;
