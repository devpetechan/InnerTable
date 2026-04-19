-- =============================================================================
-- Migration: 0003_comments_votes.sql
-- Creates public.comments and public.votes tables.
-- Reactions are stored as denormalized jsonb on comments (v0.2 — fine for now).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.comments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid        NOT NULL REFERENCES public.recommendations (id) ON DELETE CASCADE,
  author_id         uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  text              text,
  deleted           boolean     NOT NULL DEFAULT false,

  -- Reactions: { "<emoji>": { "<user_id>": true, ... }, ... }
  -- Denormalized jsonb is fine for v0.2; will split to a reactions table in v0.3.
  reactions         jsonb       NOT NULL DEFAULT '{}',

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_comments_updated_at ON public.comments;

CREATE TRIGGER set_comments_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 2. TABLE: public.votes
-- One row per (recommendation, user). Value is 'up' or 'down'.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.votes (
  recommendation_id uuid        NOT NULL REFERENCES public.recommendations (id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  value             text        NOT NULL CHECK (value IN ('up', 'down')),
  created_at        timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (recommendation_id, user_id)
);


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY — comments
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all comments
DROP POLICY IF EXISTS "authenticated users can read all comments" ON public.comments;
CREATE POLICY "authenticated users can read all comments"
  ON public.comments
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own comments
DROP POLICY IF EXISTS "users can insert own comments" ON public.comments;
CREATE POLICY "users can insert own comments"
  ON public.comments
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- Users can only update their own comments
-- (This covers soft-delete and reaction edits on their own comments.
--  Reaction updates by other users are handled at the app layer for v0.2.)
DROP POLICY IF EXISTS "users can update own comments" ON public.comments;
CREATE POLICY "users can update own comments"
  ON public.comments
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Users can only delete their own comments
DROP POLICY IF EXISTS "users can delete own comments" ON public.comments;
CREATE POLICY "users can delete own comments"
  ON public.comments
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY — votes
-- -----------------------------------------------------------------------------
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all votes
DROP POLICY IF EXISTS "authenticated users can read all votes" ON public.votes;
CREATE POLICY "authenticated users can read all votes"
  ON public.votes
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own votes
DROP POLICY IF EXISTS "users can insert own votes" ON public.votes;
CREATE POLICY "users can insert own votes"
  ON public.votes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only update their own votes
DROP POLICY IF EXISTS "users can update own votes" ON public.votes;
CREATE POLICY "users can update own votes"
  ON public.votes
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own votes
DROP POLICY IF EXISTS "users can delete own votes" ON public.votes;
CREATE POLICY "users can delete own votes"
  ON public.votes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
