-- ═════════════════════════════════════════════════════════════════════════════
--  0012_recommendations_legacy_rename.sql
--  IT-037 phase 1 of 3 (InnerTable v0.3.0)
--
--  Rename public.recommendations → public.recommendations_legacy.
--  The UI stopped reading this table when IT-035 shipped (places + entries are
--  the source of truth); the rename is the cheap, instantly-reversible way to
--  prove nothing still depends on the old name.
--
--  ROLLBACK: ALTER TABLE public.recommendations_legacy RENAME TO recommendations;
--
--  NOTE: indexes, constraints, triggers and RLS policies keep their old names
--  after a table rename — harmless, and moot once 0014 drops the table.
--  Full data snapshot: scripts/backup-recommendations-2026-07-04.{json,sql}.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.recommendations RENAME TO recommendations_legacy;

-- VERIFY (expect ERROR: relation "public.recommendations" does not exist,
-- and 14 from the second query):
--   SELECT count(*) FROM public.recommendations;
--   SELECT count(*) FROM public.recommendations_legacy;
