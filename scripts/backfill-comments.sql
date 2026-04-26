-- =============================================================================
-- Backfill: scripts/backfill-comments.sql
-- One-time script to migrate v0.2 comments + jsonb reactions into the v0.3
-- normalised tables (public.comments + public.comment_reactions).
-- (IT-034, InnerTable v0.3.0)
--
-- PREREQUISITES
-- ─────────────────────────────────────────────────────────────────
--   1. Migration 0008_entries.sql has been applied
--   2. scripts/backfill-entries.sql has been run
--      (so every (author, place) pair has an entry row)
--   3. Migration 0009_comments.sql has been applied
--      (so public.comments_v2 exists alongside the new public.comments table)
--
-- Run this in the Supabase SQL editor (or psql).  The whole script is wrapped
-- in a transaction; any verification failure rolls back cleanly without
-- dropping the legacy table.
--
-- WHAT THIS DOES
-- ─────────────────────────────────────────────────────────────────
--   PHASE 1 — copy comment rows
--     For each row in comments_v2, look up the entry that matches
--     (recommendation.author_id, recommendation.place_id).  Insert into
--     the new comments table with deleted_at derived from the legacy
--     `deleted` boolean (true → created_at as a placeholder, false → NULL).
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
-- (author_id, place_id) maps to a real entry.  If not, the entries backfill
-- (IT-033) didn't finish or the recommendation was deleted out from under it.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans bigint;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.comments_v2 c
  LEFT JOIN public.recommendations r ON r.id = c.recommendation_id
  LEFT JOIN public.entries        e ON e.user_id  = r.author_id
                                    AND e.place_id = r.place_id
  WHERE e.id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill comments: % comment row(s) have no matching entry — check that scripts/backfill-entries.sql ran cleanly',
      v_orphans;
  END IF;
END $$;


-- =============================================================================
-- PHASE 1: Copy comment rows from comments_v2 → comments
-- =============================================================================
INSERT INTO public.comments (
  id,
  entry_id,
  author_id,
  text,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  c.id                                                AS id,         -- preserve the uuid
  e.id                                                AS entry_id,   -- the (author, place) entry
  c.author_id                                         AS author_id,
  c.text                                              AS text,
  CASE WHEN c.deleted THEN c.created_at ELSE NULL END AS deleted_at,
  c.created_at                                        AS created_at,
  c.updated_at                                        AS updated_at
FROM public.comments_v2 c
JOIN public.recommendations r ON r.id = c.recommendation_id
JOIN public.entries         e ON e.user_id  = r.author_id
                              AND e.place_id = r.place_id;


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
  v_orphan_entries          bigint;
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

  -- Sanity: every new comment should reference a real entry, and every
  -- reaction should reference a real comment.  FKs make this impossible,
  -- but checking is cheap.
  SELECT count(*) INTO v_orphan_entries
    FROM public.comments c
    WHERE NOT EXISTS (SELECT 1 FROM public.entries e WHERE e.id = c.entry_id);

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
  RAISE NOTICE '  Comments with missing entry FK   : %', v_orphan_entries;
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

  IF v_orphan_entries > 0 OR v_orphan_comments > 0 THEN
    RAISE EXCEPTION
      'Backfill FAILED: orphan FK references (entries: %, comments: %) — rolled back',
      v_orphan_entries, v_orphan_comments;
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
