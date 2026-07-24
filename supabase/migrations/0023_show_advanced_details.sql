-- =============================================================================
-- Migration: 0023_show_advanced_details.sql
-- InnerTable v0.5.0 Phase 4 (REL-12): the global "show advanced details"
-- preference (IT-049).
--
-- WHY (see workspace/v0.5.0-implementation-plan.md, Phase 4 + Risks):
-- one app-level switch flips the UI between the casual 5-dot taste grid and
-- the quant (precise weight) view.  It is deliberately NOT a taste-page-local
-- flag: v0.6's score breakdowns reuse the same bilingual "Trust Transparency"
-- switch, so building it page-local would mean rebuilding it later.  Persisted
-- server-side on the profile so it follows the user across devices/reloads.
--
-- SEMANTICS:
--   false (default) = casual surfaces (5-dot grid, no explicit mute shown)
--   true            = quant surfaces (precise 0..5, with explicit 0/mute)
-- The flag only chooses a *skin*; it changes no data.  Both skins read and
-- write the same friend_taste_overrides rows (null ≠ 0 invariant unchanged).
--
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).  Mirrors the 0017
-- users additions (bio, allow_email_lookup).  The existing 0001 "users can
-- update own profile" UPDATE policy already scopes writes to id = auth.uid(),
-- so no new RLS is needed — the client saveProfileSettings/toggle path writes
-- its own row.
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS show_advanced_details boolean NOT NULL DEFAULT false;


-- =============================================================================
-- VERIFY AFTER APPLYING (0019 lesson — misses are silent):
--
--   -- column exists, correct type / nullability / default
--   SELECT data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name = 'show_advanced_details';
--   -- expect: boolean | NO | false
--
--   -- every existing row got the default (no NULLs)
--   SELECT count(*) FILTER (WHERE show_advanced_details IS NULL) AS nulls,
--          count(*) FILTER (WHERE show_advanced_details = false) AS defaulted
--     FROM public.users;
--
--   -- then run supabase/snippets/test_0023_show_advanced_details.sql
-- =============================================================================
