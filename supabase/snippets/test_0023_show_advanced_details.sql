-- =============================================================================
-- test_0023_show_advanced_details.sql
-- Acceptance test for 0023 (users.show_advanced_details) — works in the
-- Supabase SQL editor AND against a stubbed local Postgres.
--
-- WHAT IT CHECKS (plan Phase 4 — the persisted app-level toggle, IT-049)
--   1. Schema: column exists on public.users; type boolean; NOT NULL;
--      default false.
--   2. Default applies: a freshly signed-up user's profile has the flag false
--      (the 0001 signup trigger never sets it, so the column default must).
--   3. RLS write path: as user A (authenticated) UPDATE of my own flag to true
--      round-trips (reuses the 0001 "users can update own profile" policy —
--      the same path openProfileSettings/saveProfileSettings and the account-
--      menu toggle use).
--   4. RLS isolation: user B's UPDATE against A's flag affects 0 rows and A's
--      value is untouched.
--
-- Paste the whole file into the Supabase SQL editor and run once.  Results
-- appear as a PASS grid; any FAIL aborts with an error.  All fixtures are
-- deleted at the end (and re-created if you re-run after a failure).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Harness (same pattern as test_0022_friend_taste_overrides.sql)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _results (seq serial, outcome text, name text);
TRUNCATE _results;

CREATE OR REPLACE FUNCTION pg_temp.impersonate(u uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claim.sub', coalesce(u::text, ''), false),
          set_config('request.jwt.claims',
                     CASE WHEN u IS NULL THEN '{}' ELSE json_build_object('sub', u)::text END,
                     false) $$;

CREATE OR REPLACE FUNCTION pg_temp.assert(p_cond boolean, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond THEN INSERT INTO _results (outcome, name) VALUES ('PASS', p_name);
  ELSE RAISE EXCEPTION 'FAIL: %', p_name; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two throwaway users (signup trigger creates the profiles).
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0023.invalid';

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-b023-00000000000a', 'alice@test0023.invalid'),
  ('00000000-0000-4000-b023-00000000000b', 'bob@test0023.invalid');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-b023-00000000000a';
  b uuid := '00000000-0000-4000-b023-00000000000b';
  v_type text; v_nullable text; v_default text;
  v_new_default boolean;
  v_a_flag boolean; v_upd int;
BEGIN
  -- ══ 1. Schema ════════════════════════════════════════════════════════════
  SELECT data_type, is_nullable, column_default
    INTO v_type, v_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name = 'show_advanced_details';

  PERFORM pg_temp.assert(v_type = 'boolean', 'show_advanced_details is boolean');
  PERFORM pg_temp.assert(v_nullable = 'NO', 'show_advanced_details is NOT NULL');
  PERFORM pg_temp.assert(v_default LIKE 'false%', 'show_advanced_details DEFAULT false');

  -- ══ 2. Default applies to a freshly created profile ══════════════════════
  SELECT show_advanced_details INTO v_new_default FROM public.users WHERE id = a;
  PERFORM pg_temp.assert(v_new_default = false,
    'new signup profile defaults to false (trigger never sets it)');

  -- ══ 3. As user A (authenticated): update my own flag ═════════════════════
  PERFORM pg_temp.impersonate(a);
  EXECUTE 'SET LOCAL ROLE authenticated';

  UPDATE public.users SET show_advanced_details = true WHERE id = a;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  SELECT show_advanced_details INTO v_a_flag FROM public.users WHERE id = a;

  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_upd = 1 AND v_a_flag = true,
    'A: can update own show_advanced_details (RLS own-row UPDATE)');

  -- ══ 4. RLS isolation: B cannot flip A's flag ═════════════════════════════
  PERFORM pg_temp.impersonate(b);
  EXECUTE 'SET LOCAL ROLE authenticated';

  UPDATE public.users SET show_advanced_details = false WHERE id = a;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_upd = 0, 'B: UPDATE against A''s flag affects 0 rows');

  -- as postgres: A's flag survived B's write attempt
  SELECT show_advanced_details INTO v_a_flag FROM public.users WHERE id = a;
  PERFORM pg_temp.assert(v_a_flag = true, 'A''s flag untouched after B''s attempt');
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup (auth.users delete cascades to public.users)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0023.invalid';

SELECT outcome, name FROM _results ORDER BY seq;
