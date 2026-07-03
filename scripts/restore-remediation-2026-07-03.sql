-- =============================================================================
-- RESTORE REMEDIATION — run ONCE in the Supabase SQL editor (2026-07-03)
--
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────
-- The database restore brought back the v0.2 comments table (keyed by
-- recommendation_id, with jsonb reactions and a deleted boolean), clobbering
-- the v0.3 schema that migrations 0009 + 0010 had created.  Live state found:
--   - public.comments            = v0.2 shape, 7 rows   (should be v0.3, place-keyed)
--   - public.comment_reactions   = exists but EMPTY     (possibly wrong FK target)
--   - public.comments_v2         = missing
--   - places (13) / entries (13) / recommendations (14) = intact, backfilled
--
-- WHAT THIS DOES, IN ORDER
--   Part 0: preflight guards + drop the stale empty comment_reactions
--   Part 1: re-apply migration 0009 (rename legacy → comments_v2, create
--           v0.3 comments + comment_reactions + RLS)
--   Part 2: re-apply migration 0010 (re-key comments to place_id + quote cols)
--   Part 3: run the IT-035 backfill (comments_v2 → comments, jsonb reactions
--           → comment_reactions; verifies counts; drops comments_v2)
--
-- Every part is guarded; a failure raises and stops before damage is done.
-- =============================================================================

-- ── Part 0: preflight ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_reactions bigint;
BEGIN
  -- comments must be in the legacy v0.2 shape (has recommendation_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments'
      AND column_name = 'recommendation_id'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: public.comments is not in the legacy v0.2 shape — this script has probably already run. Aborting.';
  END IF;

  -- comments_v2 must not already exist
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'comments_v2'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: public.comments_v2 already exists. Investigate before running.';
  END IF;

  -- If comment_reactions exists (it may not — depends on how the restore
  -- landed), it must be empty before we drop it below.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'comment_reactions'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.comment_reactions' INTO v_reactions;
    IF v_reactions > 0 THEN
      RAISE EXCEPTION 'Preflight failed: public.comment_reactions has % row(s) — expected empty. Investigate before running.', v_reactions;
    END IF;
  END IF;
END $$;

-- Stale empty table from the partial pre-restore state; its FK may point at
-- the wrong comments table.  Migration 0009 below recreates it correctly.
DROP TABLE IF EXISTS public.comment_reactions;

-- ── Part 1: migration 0009 ──────────────────────────────────────────────────
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

-- ── Part 2: migration 0010 ──────────────────────────────────────────────────
-- =============================================================================
-- Migration: 0010_comments_place_id_and_quotes.sql
-- IT-035: re-key comments to places, add quote-reply columns.
--
-- WHY
-- ─────────────────────────────────────────────────────────
-- v0.3 (migration 0009) keyed comments to entries, which meant each user's
-- take on a place had its own comment thread.  IT-035 collapses to one card
-- per place, which means one shared thread per place.  We re-key
-- comments.entry_id → comments.place_id and drop the entry FK.
--
-- Quote replies are stored as a snapshot (quoted_text + quoted_author at
-- write time) rather than a parent_id chain.  This keeps quote rendering
-- simple, survives the original being edited or deleted, and avoids
-- recursive thread queries.  Tradeoff: edits to the original don't
-- propagate to the quote.  That's intentional — quotes are a record of
-- what was said at the time.
-- =============================================================================

-- 1. Add place_id column (nullable for now so backfill can run)
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES public.places (id) ON DELETE CASCADE;

-- 2. Backfill place_id from the entry the comment was attached to
UPDATE public.comments c
   SET place_id = e.place_id
  FROM public.entries e
 WHERE c.entry_id = e.id
   AND c.place_id IS NULL;

-- 3. Lock it in
ALTER TABLE public.comments
  ALTER COLUMN place_id SET NOT NULL;

-- 4. Drop the old entry-based index, add a place-based one
DROP INDEX IF EXISTS comments_entry_id_created_at_idx;
CREATE INDEX IF NOT EXISTS comments_place_id_created_at_idx
  ON public.comments (place_id, created_at)
  WHERE deleted_at IS NULL;

-- 5. Drop the old FK (and the column itself — comments are place-keyed now)
ALTER TABLE public.comments
  DROP COLUMN IF EXISTS entry_id;

-- 6. Quote-reply columns (all nullable — only set when this comment is a reply)
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS quoted_comment_id uuid REFERENCES public.comments (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted_text       text,
  ADD COLUMN IF NOT EXISTS quoted_author     text;

-- RLS policies don't change — they were only ever scoped on author_id.
-- Realtime subscription on public.comments keeps working — same table.

-- ── Part 3: backfill (verifies + drops comments_v2 at the end) ──────────────
-- =============================================================================
-- Backfill: scripts/backfill-comments.sql
-- One-time script to migrate v0.2 comments + jsonb reactions into the v0.3
-- normalised tables (public.comments + public.comment_reactions).
-- (IT-034 + IT-035, InnerTable v0.3.0)
--
-- UPDATED FOR IT-035
-- ─────────────────────────────────────────────────────────────────
-- IT-034 originally keyed comments to entries (comments.entry_id).  IT-035
-- then re-keyed comments to places (comments.place_id) and dropped entry_id
-- in migration 0010.  This script now writes place_id directly, looking it
-- up via the recommendation row that the legacy comment was attached to.
-- The entries table isn't on the path comment → place_id any more — the
-- chain is: legacy comment.recommendation_id → recommendations.place_id.
--
-- PREREQUISITES
-- ─────────────────────────────────────────────────────────────────
--   1. Migration 0007_places.sql has been applied
--   2. scripts/backfill-places.sql has been run
--      (so every public.recommendations row has a non-NULL place_id)
--   3. Migration 0008_entries.sql has been applied
--   4. scripts/backfill-entries.sql has been run
--      (entries aren't directly used here, but they're part of the v0.3 state
--       this script is migrating into)
--   5. Migration 0009_comments.sql has been applied
--      (so public.comments_v2 exists alongside the new public.comments table)
--   6. Migration 0010_comments_place_id_and_quotes.sql has been applied
--      (so public.comments has place_id NOT NULL and no entry_id)
--
-- Run this in the Supabase SQL editor (or psql).  The whole script is wrapped
-- in a transaction; any verification failure rolls back cleanly without
-- dropping the legacy table.
--
-- WHAT THIS DOES
-- ─────────────────────────────────────────────────────────────────
--   PHASE 1 — copy comment rows
--     For each row in comments_v2, look up the recommendation it was attached
--     to and copy that recommendation's place_id onto the new comment.
--     deleted_at is derived from the legacy `deleted` boolean (true →
--     created_at as a placeholder, false → NULL).
--
--   PHASE 2 — explode jsonb reactions into comment_reactions rows
--     Legacy jsonb shape:  { "🔥": { "<user_id>": true, ... }, "👍": {...} }
--     Each (emoji, user_id) pair becomes one row in comment_reactions.
--     If a user appears under two emojis on the same comment (shouldn't
--     happen, but the v0.2 schema didn't enforce it), the most recent
--     emoji wins via a DISTINCT ON tiebreak.
--
--   PHASE 3 — verification
--     Reconciles row counts; raises an exception (rolling back) on any
--     mismatch or orphan.
--
--   PHASE 4 — drop the legacy table
--     Only runs if every check passes.  After this commits, comments_v2
--     is gone for good.
--
-- DELETED-AT NOTE
-- ─────────────────────────────────────────────────────────────────
-- The legacy `deleted` boolean carries no timestamp, so we don't know
-- *when* a comment was deleted.  We use the row's created_at as a
-- conservative placeholder — it preserves the "this comment is hidden"
-- semantics without inventing a fake later timestamp.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Idempotency guard: bail if the new comments table already has data.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.comments) > 0 THEN
    RAISE EXCEPTION 'public.comments already populated — backfill already ran';
  END IF;
  IF (SELECT count(*) FROM public.comment_reactions) > 0 THEN
    RAISE EXCEPTION 'public.comment_reactions already populated — backfill already ran';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Prereq check: every legacy comment must point at a recommendation whose
-- place_id is set.  If any are missing, scripts/backfill-places.sql wasn't
-- run (or didn't finish) — fix that first.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans bigint;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.comments_v2 c
  LEFT JOIN public.recommendations r ON r.id = c.recommendation_id
  WHERE r.id IS NULL OR r.place_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill comments: % comment row(s) reference a recommendation that is missing or has no place_id — check that scripts/backfill-places.sql ran cleanly',
      v_orphans;
  END IF;
END $$;


-- =============================================================================
-- PHASE 1: Copy comment rows from comments_v2 → comments
-- Comments are now place-keyed (IT-035, migration 0010).  We pull place_id
-- straight from the recommendation the legacy comment was attached to.
-- =============================================================================
INSERT INTO public.comments (
  id,
  place_id,
  author_id,
  text,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  c.id                                                AS id,         -- preserve the uuid
  r.place_id                                          AS place_id,   -- the place this comment is about
  c.author_id                                         AS author_id,
  c.text                                              AS text,
  CASE WHEN c.deleted THEN c.created_at ELSE NULL END AS deleted_at,
  c.created_at                                        AS created_at,
  c.updated_at                                        AS updated_at
FROM public.comments_v2 c
JOIN public.recommendations r ON r.id = c.recommendation_id;


-- =============================================================================
-- PHASE 2: Explode jsonb reactions into comment_reactions rows
-- Legacy shape: reactions = { "<emoji>": { "<user_id>": true, ... }, ... }
-- =============================================================================
INSERT INTO public.comment_reactions (
  comment_id,
  user_id,
  emoji,
  created_at
)
SELECT DISTINCT ON (c.id, (user_kv.key)::uuid)
  c.id                  AS comment_id,
  (user_kv.key)::uuid   AS user_id,
  emoji_kv.key          AS emoji,
  c.updated_at          AS created_at  -- best available timestamp; legacy didn't track per-reaction time
FROM public.comments_v2 c
CROSS JOIN LATERAL jsonb_each(c.reactions) AS emoji_kv(key, value)
CROSS JOIN LATERAL jsonb_each_text(emoji_kv.value) AS user_kv(key, value)
WHERE c.reactions IS NOT NULL
  AND c.reactions <> '{}'::jsonb
  AND user_kv.value::boolean = true                                    -- skip stale `false` entries
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (user_kv.key)::uuid)  -- skip reactions from deleted users
ORDER BY c.id, (user_kv.key)::uuid, c.updated_at DESC;                  -- on duplicate, most recent wins


-- =============================================================================
-- PHASE 3: Verification
-- =============================================================================
DO $$
DECLARE
  v_legacy_comments         bigint;
  v_new_comments            bigint;
  v_legacy_reaction_pairs   bigint;
  v_new_reactions           bigint;
  v_orphan_places           bigint;
  v_orphan_comments         bigint;
  v_pk_violations           bigint;
BEGIN
  SELECT count(*) INTO v_legacy_comments FROM public.comments_v2;
  SELECT count(*) INTO v_new_comments    FROM public.comments;

  -- Count distinct (comment_id, user_id) pairs in the legacy jsonb,
  -- so we have an apples-to-apples target for v_new_reactions.
  SELECT count(*)
    INTO v_legacy_reaction_pairs
    FROM (
      SELECT DISTINCT c.id AS comment_id, (user_kv.key)::uuid AS user_id
      FROM public.comments_v2 c
      CROSS JOIN LATERAL jsonb_each(c.reactions) AS emoji_kv(key, value)
      CROSS JOIN LATERAL jsonb_each_text(emoji_kv.value) AS user_kv(key, value)
      WHERE c.reactions IS NOT NULL
        AND c.reactions <> '{}'::jsonb
        AND user_kv.value::boolean = true
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = (user_kv.key)::uuid)
    ) AS distinct_pairs;

  SELECT count(*) INTO v_new_reactions FROM public.comment_reactions;

  -- Sanity: every new comment should reference a real place, and every
  -- reaction should reference a real comment.  FKs make this impossible,
  -- but checking is cheap.
  SELECT count(*) INTO v_orphan_places
    FROM public.comments c
    WHERE NOT EXISTS (SELECT 1 FROM public.places p WHERE p.id = c.place_id);

  SELECT count(*) INTO v_orphan_comments
    FROM public.comment_reactions r
    WHERE NOT EXISTS (SELECT 1 FROM public.comments c WHERE c.id = r.comment_id);

  -- The (comment_id, user_id) PK guarantees this is 0, but explicit is good.
  SELECT count(*) INTO v_pk_violations
    FROM (
      SELECT comment_id, user_id, count(*)
      FROM public.comment_reactions
      GROUP BY comment_id, user_id
      HAVING count(*) > 1
    ) AS dupes;

  RAISE NOTICE 'Comments backfill complete';
  RAISE NOTICE '  Legacy comments                  : %', v_legacy_comments;
  RAISE NOTICE '  New comments                     : %', v_new_comments;
  RAISE NOTICE '  Legacy distinct (comment, user)  : %', v_legacy_reaction_pairs;
  RAISE NOTICE '  New comment_reactions            : %', v_new_reactions;
  RAISE NOTICE '  Comments with missing place FK   : %', v_orphan_places;
  RAISE NOTICE '  Reactions with missing comment FK: %', v_orphan_comments;
  RAISE NOTICE '  Reaction PK violations           : %', v_pk_violations;

  IF v_new_comments <> v_legacy_comments THEN
    RAISE EXCEPTION
      'Backfill FAILED: comments count mismatch (legacy=%, new=%) — rolled back',
      v_legacy_comments, v_new_comments;
  END IF;

  IF v_new_reactions <> v_legacy_reaction_pairs THEN
    RAISE EXCEPTION
      'Backfill FAILED: reaction count mismatch (legacy distinct pairs=%, new=%) — rolled back',
      v_legacy_reaction_pairs, v_new_reactions;
  END IF;

  IF v_orphan_places > 0 OR v_orphan_comments > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: orphan FK references (places: %, comments: %) — rolled back',
      v_orphan_places, v_orphan_comments;
  END IF;

  IF v_pk_violations > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: % duplicate (comment_id, user_id) row(s) — rolled back',
      v_pk_violations;
  END IF;
END $$;


-- =============================================================================
-- PHASE 4: Drop the legacy table
-- Only reached if all verifications above passed.
-- =============================================================================
DROP TABLE public.comments_v2;

COMMIT;
