-- ═════════════════════════════════════════════════════════════════════════════
--  0014_recommendations_legacy_drop.sql
--  IT-037 phase 3 of 3 (InnerTable v0.3.0)
--
--  Final teardown of the legacy pre-v0.3 schema:
--
--  1. public.votes            — legacy per-recommendation votes (0003).  Never
--     wired into the current UI.  Contained exactly 1 row at teardown time
--     (an 'up' by c8862b4d… on Beigel Bake f6724cd0…), preserved in
--     scripts/backup-recommendations-2026-07-04.sql (footer comment).
--  2. public.user_rec_interactions — legacy per-user status/ratings (0004).
--     Empty at teardown time.  Superseded by public.entries.
--  3. public.recommendations_legacy — the renamed+stripped remains of the
--     original denormalised table (0002).  Full pre-teardown snapshot in
--     scripts/backup-recommendations-2026-07-04.{json,sql}.
--
--  Both dependents must go first (they hold FKs into recommendations_legacy).
--
--  ROLLBACK: run scripts/backup-recommendations-2026-07-04.sql, which
--  recreates the full table as public.recommendations_restored.
-- ═════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.votes;
DROP TABLE IF EXISTS public.user_rec_interactions;
DROP TABLE IF EXISTS public.recommendations_legacy;

-- VERIFY (expect zero rows):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('votes','user_rec_interactions',
--                        'recommendations','recommendations_legacy');
