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
