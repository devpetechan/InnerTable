-- =============================================================================
-- Migration: 0018_entry_notes_and_comment_privacy.sql
-- InnerTable v0.4.0 Phase 4 (REL-11): circle-scoped candor.
--
-- DESIGN (decision record 2026-07-11, workspace/v0.4.0-implementation-plan.md):
--   Ratings are network signal; notes are circle candor.
--   - entries (status + ratings) stay member-visible — RLS UNCHANGED.
--   - Free text moves behind the circle: notes/try_note split into a new
--     entry_notes table; comments + reactions get circle-scoped SELECT.
--
-- WHY A SEPARATE TABLE? RLS is ROW-level — Postgres decides whether you get
-- a row, never which columns of it.  Ratings (member-visible) and notes
-- (circle-only) now have different audiences, so the private part must be
-- its own row.  A product boundary becoming a schema boundary.
--
-- ⚠ APPLY TOGETHER WITH THE PHASE 5 FRONTEND. This migration drops
--   entries.notes / entries.try_note — the pre-Phase-5 app reads and writes
--   those columns and will break against a database with 0018 applied.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.entry_notes — the circle-scoped half of an entry
--    entry_id is the PK (1:1 with entries).  user_id duplicates the entry
--    author so the RLS policy is a plain column check — no join per row.
--    A CHECK-style integrity guard lives in the INSERT policy instead:
--    you may only attach a note to YOUR OWN entry.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entry_notes (
  entry_id   uuid        PRIMARY KEY REFERENCES public.entries (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  notes      text,
  try_note   text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_entry_notes_updated_at ON public.entry_notes;
CREATE TRIGGER set_entry_notes_updated_at
  BEFORE UPDATE ON public.entry_notes
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- Lookups by author ("all of Alice's notes") — the RLS predicate path.
CREATE INDEX IF NOT EXISTS entry_notes_user_id_idx
  ON public.entry_notes (user_id);


-- -----------------------------------------------------------------------------
-- 2. BACKFILL from entries, then drop the old columns.
-- -----------------------------------------------------------------------------
INSERT INTO public.entry_notes (entry_id, user_id, notes, try_note)
SELECT id, user_id, notes, try_note
  FROM public.entries
 WHERE notes IS NOT NULL OR try_note IS NOT NULL
ON CONFLICT (entry_id) DO NOTHING;

ALTER TABLE public.entries
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS try_note;


-- -----------------------------------------------------------------------------
-- 3. RLS: entry_notes — the heart of the release.
--    Read: author or accepted friend of the author.
--    Write: author only, and only onto their own entry.
-- -----------------------------------------------------------------------------
ALTER TABLE public.entry_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notes visible to author and circle" ON public.entry_notes;
CREATE POLICY "notes visible to author and circle"
  ON public.entry_notes
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_accepted_friend(auth.uid(), user_id)
  );

DROP POLICY IF EXISTS "users can insert notes on own entries" ON public.entry_notes;
CREATE POLICY "users can insert notes on own entries"
  ON public.entry_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.entries e
       WHERE e.id = entry_id AND e.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "users can update own notes" ON public.entry_notes;
CREATE POLICY "users can update own notes"
  ON public.entry_notes
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can delete own notes" ON public.entry_notes;
CREATE POLICY "users can delete own notes"
  ON public.entry_notes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 4. COMMENTS: quoted_user_id + fail-closed both-circles visibility.
--
--    Quotes are snapshots (quoted_text copied onto the quoting row, IT-035),
--    so a stranger's words can ride along inside a row the viewer IS allowed
--    to see.  Mitigation (decision 2026-07-11): the quoting comment is only
--    visible if the viewer is in BOTH circles — the quoter's AND the quoted
--    author's.  Fails closed: a mistake hides too much rather than leaking.
--
--    quoted_author is a display-name snapshot and quoted_comment_id nulls on
--    delete, so neither reliably identifies the quoted USER for a policy
--    check → dedicated quoted_user_id column.  We can't derive it inside the
--    policy by subquerying comments itself (recursive policy evaluation).
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS quoted_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL;

-- Backfill from the originals that still exist.  (Quotes whose original was
-- already deleted keep quoted_user_id NULL and stay visible to the quoter's
-- whole circle — unrecoverable, and acceptable at alpha data volumes.)
UPDATE public.comments c
   SET quoted_user_id = q.author_id
  FROM public.comments q
 WHERE c.quoted_comment_id = q.id
   AND c.quoted_user_id IS NULL;

-- Keep the column trustworthy going forward: derive it server-side from
-- quoted_comment_id on INSERT, so clients never set (or spoof) it.
CREATE OR REPLACE FUNCTION public.set_quoted_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.quoted_comment_id IS NOT NULL THEN
    SELECT author_id INTO NEW.quoted_user_id
      FROM public.comments
     WHERE id = NEW.quoted_comment_id;
  ELSE
    NEW.quoted_user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_comments_quoted_user_id ON public.comments;
CREATE TRIGGER set_comments_quoted_user_id
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_quoted_user_id();

-- Replace the read-all policy (0009) with the both-circles predicate.
DROP POLICY IF EXISTS "authenticated users can read all comments" ON public.comments;
DROP POLICY IF EXISTS "comments visible within both circles" ON public.comments;
CREATE POLICY "comments visible within both circles"
  ON public.comments
  FOR SELECT
  TO authenticated
  USING (
    (author_id = auth.uid() OR public.is_accepted_friend(auth.uid(), author_id))
    AND (
      quoted_user_id IS NULL
      OR quoted_user_id = auth.uid()
      OR public.is_accepted_friend(auth.uid(), quoted_user_id)
    )
  );
-- Write policies (0009: author-only insert/update/delete) unchanged.


-- -----------------------------------------------------------------------------
-- 5. COMMENT REACTIONS: same circle scoping, keyed on the reactor.
--    (You see reactions from people in your circle; a stranger's reaction on
--    a comment you can read stays hidden — consistent fail-closed behavior.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated users can read all reactions" ON public.comment_reactions;
DROP POLICY IF EXISTS "reactions visible to author and circle" ON public.comment_reactions;
CREATE POLICY "reactions visible to author and circle"
  ON public.comment_reactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_accepted_friend(auth.uid(), user_id)
  );


-- -----------------------------------------------------------------------------
-- 6. CUTOVER BACKFILL (decision: option A, 2026-07-11).
--    Create mutual accepted friendships among all EXISTING users so current
--    notes and comments stay mutually visible — the alpha group is a small
--    trusted circle, and anyone can prune afterwards.  New users signing up
--    after this migration start with an empty circle, as intended.
-- -----------------------------------------------------------------------------
INSERT INTO public.friendships (user_id, friend_id, status, requested_by, accepted_at)
SELECT a.id, b.id, 'accepted', a.id, now()
  FROM public.users a
  JOIN public.users b ON a.id <> b.id
ON CONFLICT (user_id, friend_id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 7. REALTIME: the app re-fetches on entry_notes changes like other tables.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.entry_notes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;  -- publication absent on bare local Postgres
END;
$$;
