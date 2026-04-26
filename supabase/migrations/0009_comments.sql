-- =============================================================================
-- Migration: 0009_comments.sql
-- Splits the v0.2 comments+reactions blob into two normalised tables, keyed
-- to public.entries (the v0.3 first-class object) instead of the legacy
-- public.recommendations table. (IT-034, InnerTable v0.3.0)
--
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────
-- v0.2 stored comments in public.comments with:
--   - recommendation_id  → FK to the legacy recommendations table
--   - reactions          → jsonb blob: { "<emoji>": { "<user_id>": true } }
--   - deleted            → boolean flag (no audit of when/why)
--
-- v0.3 normalises in three ways:
--   1. Comments are keyed to entries.id (the new (user, place) object)
--   2. Reactions move into a dedicated public.comment_reactions table,
--      with (comment_id, user_id) as the PRIMARY KEY — enforcing the
--      one-reaction-per-user rule at the database level instead of in JS
--   3. Soft-delete switches from `deleted boolean` to `deleted_at timestamptz`
--      so we have a record of *when* a comment was deleted, not just whether
--
-- ORDERING
-- ─────────────────────────────────────────────────────────────────
-- This migration only does DDL — schema rename + new tables.  The actual
-- data migration (old → new) lives in scripts/backfill-comments.sql, which
-- must be run after this migration is applied.  The legacy table is renamed
-- to public.comments_v2 and survives until the backfill drops it at the end.
--
-- The legacy public.votes table is left untouched — votes are subsumed by
-- entries.overall_rating in v0.3 but cleanup of that table is a separate
-- concern (deferred to IT-037 alongside the recommendations drop).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the v0.2 reaction-toggle function — it reads `comments.reactions`,
-- which won't exist after the rename below.  Reactions in v0.3 live in their
-- own table with a (comment_id, user_id) primary key, so the frontend can
-- toggle them with a plain INSERT/DELETE under RLS — no SECURITY DEFINER
-- function needed.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.toggle_reaction(uuid, text);


-- -----------------------------------------------------------------------------
-- 2. Rename the v0.2 comments table out of the way.
-- The triggers, RLS policies, and FK to recommendations come along for the
-- ride automatically — Postgres tracks them by oid, not by name.
-- The backfill script reads from this renamed table, then DROPs it at the end.
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments RENAME TO comments_v2;


-- -----------------------------------------------------------------------------
-- 3. TABLE: public.comments (v0.3 shape)
-- One row per comment.  Keyed to entries (not recommendations).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid        NOT NULL REFERENCES public.entries (id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES public.users   (id) ON DELETE CASCADE,

  text        text,

  -- Soft-delete: NULL = live comment, timestamp = when it was deleted.
  -- Replaces the v0.2 `deleted boolean` flag.
  deleted_at  timestamptz,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Common access pattern: "give me all live comments for this entry, oldest first"
CREATE INDEX IF NOT EXISTS comments_entry_id_created_at_idx
  ON public.comments (entry_id, created_at)
  WHERE deleted_at IS NULL;

-- Reuses the public.set_updated_at() trigger function defined in 0002_recommendations.sql
DROP TRIGGER IF EXISTS set_comments_updated_at ON public.comments;
CREATE TRIGGER set_comments_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. TABLE: public.comment_reactions
-- One row per (comment, user).  PK enforces "one reaction per user per comment"
-- at the database level — no more relying on JS to dedupe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comment_reactions (
  comment_id  uuid        NOT NULL REFERENCES public.comments (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users    (id) ON DELETE CASCADE,
  emoji       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (comment_id, user_id)
);

-- Useful for "show me everyone who reacted with 🔥 across all comments"
CREATE INDEX IF NOT EXISTS comment_reactions_emoji_idx
  ON public.comment_reactions (emoji);


-- =============================================================================
-- 5. ROW LEVEL SECURITY — comments
-- Read: any authenticated user.
-- Write: only the author (author_id = auth.uid()).
-- =============================================================================
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read all comments" ON public.comments;
CREATE POLICY "authenticated users can read all comments"
  ON public.comments
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "users can insert own comments" ON public.comments;
CREATE POLICY "users can insert own comments"
  ON public.comments
  FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

-- UPDATE covers both edits and soft-delete (setting deleted_at)
DROP POLICY IF EXISTS "users can update own comments" ON public.comments;
CREATE POLICY "users can update own comments"
  ON public.comments
  FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Hard DELETE is allowed for the author too (rare — soft-delete is preferred).
DROP POLICY IF EXISTS "users can delete own comments" ON public.comments;
CREATE POLICY "users can delete own comments"
  ON public.comments
  FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());


-- =============================================================================
-- 6. ROW LEVEL SECURITY — comment_reactions
-- Read: any authenticated user.
-- Toggle (insert/update/delete): only on rows where user_id = auth.uid().
-- =============================================================================
ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read all reactions" ON public.comment_reactions;
CREATE POLICY "authenticated users can read all reactions"
  ON public.comment_reactions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "users can insert own reaction" ON public.comment_reactions;
CREATE POLICY "users can insert own reaction"
  ON public.comment_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allows changing emoji on your existing reaction (e.g. 👍 → 🔥)
DROP POLICY IF EXISTS "users can update own reaction" ON public.comment_reactions;
CREATE POLICY "users can update own reaction"
  ON public.comment_reactions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can delete own reaction" ON public.comment_reactions;
CREATE POLICY "users can delete own reaction"
  ON public.comment_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
