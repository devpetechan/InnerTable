-- =============================================================================
-- Migration: 0022_friend_taste_overrides.sql
-- InnerTable v0.5.0 Phase 2 (REL-12): the explicit per-friend/per-category
-- trust weight.
--
-- WHY (see workspace/v0.5.0-implementation-plan.md, decision record §2):
-- an override is a single nullable trust WEIGHT — my judgment of a friend's
-- authority on a category — NOT a signed similarity score (that design, old
-- IT-046, conflated the explicit signal with what v0.6 computes implicitly).
-- v0.6 blends this with implicit Pearson similarity precisely because the two
-- are complementary; forward contract in InnerTable-Trust-Model-Rationale.md
-- §1.3.  No similarity math ships here (decision §3).
--
-- SEMANTICS (null ≠ low — same lesson as v0.4.0 notes):
--   NULL  = no opinion / use default   (a row may exist with NULL weight)
--   0     = explicit mute
--   1..5  = ascending trust
-- Raw ordinal, not pre-normalized (normalization is a v0.6 blending choice).
-- Directional: (A rates B) is independent of (B rates A).
--
-- RLS: own-row only, keyed on rater_id — no SECURITY DEFINER RPCs needed
-- (unlike friendships, you only ever write rows where rater_id = you, and
-- nobody else may even read them: overrides are private judgments, candor).
--
-- Idempotent: safe to re-run (IF NOT EXISTS / DROP ... IF EXISTS guards).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.friend_taste_overrides
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friend_taste_overrides (
  rater_id    uuid        NOT NULL REFERENCES public.users      (id) ON DELETE CASCADE,  -- me
  friend_id   uuid        NOT NULL REFERENCES public.users      (id) ON DELETE CASCADE,  -- them
  category_id uuid        NOT NULL REFERENCES public.categories (id) ON DELETE CASCADE,
  weight      smallint    CHECK (weight BETWEEN 0 AND 5),  -- NULL = no opinion/default; 0 = mute; 1..5 ascending
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rater_id, friend_id, category_id),
  CHECK (rater_id <> friend_id)
);

-- The PK's rater_id prefix serves every v0.5.0 read path ("my overrides",
-- optionally narrowed to one friend — Phase 5).  These two cover the non-
-- leading FK columns so ON DELETE CASCADE from users/categories doesn't
-- seq-scan (cheap now, correct forever).
CREATE INDEX IF NOT EXISTS friend_taste_overrides_friend_id_idx
  ON public.friend_taste_overrides (friend_id);
CREATE INDEX IF NOT EXISTS friend_taste_overrides_category_id_idx
  ON public.friend_taste_overrides (category_id);


-- -----------------------------------------------------------------------------
-- 2. TRIGGER: auto-update updated_at on every row change.
--    Reuses set_updated_at() defined in 0002_recommendations.sql (same pattern
--    as places/entries/comments/entry_notes).  Matters here because the Phase 3
--    save path is an upsert — ON CONFLICT DO UPDATE must refresh updated_at.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_friend_taste_overrides_updated_at ON public.friend_taste_overrides;
CREATE TRIGGER set_friend_taste_overrides_updated_at
  BEFORE UPDATE ON public.friend_taste_overrides
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY: own rows only, all four verbs, keyed on rater_id.
--    Overrides are private to the rater — friends never see how they're rated.
--    (No GRANT statements needed — Supabase default privileges already grant
--    table access to authenticated; RLS is what scopes the rows.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.friend_taste_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own overrides: select" ON public.friend_taste_overrides;
CREATE POLICY "own overrides: select" ON public.friend_taste_overrides
  FOR SELECT TO authenticated USING (rater_id = auth.uid());

DROP POLICY IF EXISTS "own overrides: insert" ON public.friend_taste_overrides;
CREATE POLICY "own overrides: insert" ON public.friend_taste_overrides
  FOR INSERT TO authenticated WITH CHECK (rater_id = auth.uid());

DROP POLICY IF EXISTS "own overrides: update" ON public.friend_taste_overrides;
CREATE POLICY "own overrides: update" ON public.friend_taste_overrides
  FOR UPDATE TO authenticated USING (rater_id = auth.uid()) WITH CHECK (rater_id = auth.uid());

DROP POLICY IF EXISTS "own overrides: delete" ON public.friend_taste_overrides;
CREATE POLICY "own overrides: delete" ON public.friend_taste_overrides
  FOR DELETE TO authenticated USING (rater_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 4. OPTIONAL integrity guard — deliberately NOT enabled (plan decision:
--    defer for alpha, keep it simple).  RLS stops me writing anyone else's
--    rows, but it does let me store an override for a *stranger*.  Harmless:
--    I can't see their entries anyway, and the row simply pre-populates if we
--    later friend.  If stray rows ever bother us, this is the clean fix
--    (is_accepted_friend from 0017 is EXECUTE-granted to authenticated):
--
--    CREATE OR REPLACE FUNCTION public.friend_taste_overrides_friend_guard()
--    RETURNS trigger LANGUAGE plpgsql AS $$
--    BEGIN
--      IF NOT public.is_accepted_friend(NEW.rater_id, NEW.friend_id) THEN
--        RAISE EXCEPTION 'friend_taste_overrides: friend % is not an accepted friend of rater %',
--          NEW.friend_id, NEW.rater_id;
--      END IF;
--      RETURN NEW;
--    END $$;
--
--    DROP TRIGGER IF EXISTS friend_taste_overrides_friend_guard ON public.friend_taste_overrides;
--    CREATE TRIGGER friend_taste_overrides_friend_guard
--      BEFORE INSERT OR UPDATE OF friend_id ON public.friend_taste_overrides
--      FOR EACH ROW EXECUTE PROCEDURE public.friend_taste_overrides_friend_guard();
-- -----------------------------------------------------------------------------


-- =============================================================================
-- VERIFY AFTER APPLYING (0019 lesson — misses are silent):
--
--   -- table exists (expect a non-NULL regclass)
--   SELECT to_regclass('public.friend_taste_overrides');
--
--   -- RLS on with exactly the four own-row policies
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.friend_taste_overrides'::regclass;
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'friend_taste_overrides'
--    ORDER BY policyname;
--
--   -- updated_at trigger attached
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.friend_taste_overrides'::regclass AND NOT tgisinternal;
--
--   -- then run supabase/snippets/test_0022_friend_taste_overrides.sql
-- =============================================================================
