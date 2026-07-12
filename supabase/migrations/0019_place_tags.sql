-- =============================================================================
-- Migration: 0019_place_tags.sql
-- InnerTable v0.4.0 Phase 6 (REL-11): multi-author place tags.
--
-- WHY: place metadata is locked at creation (IT-035 decision) and the binary
-- restaurant/bar place_type is rigid — Tartine is a bakery to Alice but a
-- coffee spot to Bob.  place_tags is a flexible classification layer where
-- ANY member can attach tags to ANY place, without an edit-permissions story
-- on the places row itself.
--
-- Tags are classification, not candor — so unlike entry_notes they are
-- member-visible (read-all).  Writes are own-rows-only: you can add and
-- remove YOUR tag on a place, never someone else's.  The same tag from
-- several people is several rows — the UI aggregates and shows counts,
-- which doubles as a lightweight vote ("3 people call this a date spot").
--
-- place_type stays as a fallback for now; the type filter reads tags first.
-- Dropping place_type is a later cleanup item.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.place_tags (
  place_id   uuid        NOT NULL REFERENCES public.places (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.users  (id) ON DELETE CASCADE,

  -- Normalized at the DB level: lowercase, trimmed, 1–30 chars.  The client
  -- normalizes too, but the CHECK is the guarantee — same defense-in-depth
  -- reasoning as RLS vs client-side filtering.
  tag        text        NOT NULL
             CHECK (tag = lower(btrim(tag)) AND length(tag) BETWEEN 1 AND 30),

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (place_id, user_id, tag)
);

-- The dominant read is "all tags for these places" (bulk fetch, grouped
-- client-side) — the PK's place_id prefix already serves it.  Index by user
-- for "my tags" style queries later.
CREATE INDEX IF NOT EXISTS place_tags_user_id_idx
  ON public.place_tags (user_id);


-- -----------------------------------------------------------------------------
-- RLS: read-all (classification, not candor) · write own rows only
-- -----------------------------------------------------------------------------
ALTER TABLE public.place_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read all place tags" ON public.place_tags;
CREATE POLICY "authenticated users can read all place tags"
  ON public.place_tags
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "users can insert own place tags" ON public.place_tags;
CREATE POLICY "users can insert own place tags"
  ON public.place_tags
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can delete own place tags" ON public.place_tags;
CREATE POLICY "users can delete own place tags"
  ON public.place_tags
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy: a tag is add/remove only (changing one = remove + add).


-- -----------------------------------------------------------------------------
-- REALTIME
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.place_tags;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;  -- publication absent on bare local Postgres
END;
$$;
