-- =============================================================================
-- test_0017_friendships_supabase.sql
-- Acceptance test for 0017_friendships.sql — SUPABASE SQL EDITOR VERSION.
--
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Pure SQL (no psql \commands). What it does:
--   1. Creates three throwaway users directly in auth.users (your 0001
--      trigger auto-creates their public.users profiles).
--   2. Impersonates each one by setting request.jwt.claim.sub — the session
--      variable Supabase's auth.uid() reads — and exercises every RPC.
--   3. Records PASS rows in a temp table; any FAIL aborts with an error.
--   4. Deletes the test users (cascades wipe their profiles + friendships)
--      and shows the results grid.
--
-- Safe to re-run. Touches nothing except the three *.invalid test users.
-- If a FAIL aborts mid-run, re-running cleans up (fixtures are deleted and
-- recreated at the top).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Harness
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

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_name text, p_msg text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FAIL: % — expected an error, got none', p_name;
EXCEPTION
  WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF p_msg IS NOT NULL AND position(p_msg in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAIL: % — wrong error: %', p_name, SQLERRM;
    END IF;
    INSERT INTO _results (outcome, name) VALUES ('PASS', p_name || ' (' || SQLERRM || ')');
END $$;

-- ---------------------------------------------------------------------------
-- Fixtures: three throwaway auth users (0001 trigger creates their profiles)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0017.invalid';
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-a000-00000000000a', 'alice@test0017.invalid'),
  ('00000000-0000-4000-a000-00000000000b', 'bob@test0017.invalid'),
  ('00000000-0000-4000-a000-00000000000c', 'carol@test0017.invalid');

DO $$
DECLARE
  alice uuid := '00000000-0000-4000-a000-00000000000a';
  bob   uuid := '00000000-0000-4000-a000-00000000000b';
  carol uuid := '00000000-0000-4000-a000-00000000000c';
  ghost uuid := '00000000-0000-4000-a000-0000000000ff';
  c1 int; c2 int;
  v_insert_denied boolean; v_err text;
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.users WHERE id IN (alice, bob, carol)) = 3,
    'fixture: signup trigger created 3 profiles');

  -- 1. request lifecycle ----------------------------------------------------
  PERFORM pg_temp.impersonate(alice);
  PERFORM public.send_friend_request(bob);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friendships
      WHERE status='pending' AND requested_by=alice
        AND (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2,
    'request creates directional pending pair');

  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', bob),
    'duplicate request rejected', 'already pending');
  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', alice),
    'self-request rejected', 'yourself');
  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', ghost),
    'unknown target rejected', 'User not found');
  PERFORM pg_temp.expect_error(format('SELECT public.respond_friend_request(%L, true)', bob),
    'requester cannot accept own request', 'No incoming');

  -- 2. mutual request auto-accepts --------------------------------------------
  PERFORM pg_temp.impersonate(bob);
  PERFORM public.send_friend_request(alice);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friendships
      WHERE status='accepted' AND accepted_at IS NOT NULL
        AND (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2,
    'mutual request auto-accepts both edges');
  PERFORM pg_temp.assert(
    public.is_accepted_friend(alice,bob) AND public.is_accepted_friend(bob,alice),
    'is_accepted_friend true both directions');
  PERFORM pg_temp.assert(NOT public.is_accepted_friend(alice,carol),
    'is_accepted_friend false for strangers');
  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', alice),
    'request while friends rejected', 'Already friends');

  -- 3. remove + re-request reuses rows ----------------------------------------
  PERFORM pg_temp.impersonate(alice);
  PERFORM public.remove_friend(bob);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friendships
      WHERE status='removed' AND accepted_at IS NULL
        AND (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2,
    'remove flips both edges to removed');
  PERFORM pg_temp.expect_error(format('SELECT public.remove_friend(%L)', bob),
    'double-remove rejected', 'Not friends');
  PERFORM public.send_friend_request(bob);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friendships
      WHERE status='pending' AND requested_by=alice
        AND (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2
    AND (SELECT count(*) FROM public.friendships
      WHERE (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2,
    're-request after remove reuses the two rows');

  -- 4. decline -----------------------------------------------------------------
  PERFORM pg_temp.impersonate(bob);
  PERFORM public.respond_friend_request(alice, false);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friendships
      WHERE status='removed' AND (user_id, friend_id) IN ((alice,bob),(bob,alice))) = 2,
    'decline flips both edges to removed');
  PERFORM pg_temp.impersonate(carol);
  PERFORM pg_temp.expect_error(format('SELECT public.respond_friend_request(%L, true)', alice),
    'respond without pending rejected', 'No incoming');

  -- 5. cancel --------------------------------------------------------------------
  PERFORM pg_temp.impersonate(alice);
  PERFORM public.send_friend_request(carol);
  PERFORM public.cancel_friend_request(carol);
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.friendships
      WHERE user_id=alice AND friend_id=carol AND status='removed'),
    'cancel flips outgoing pending to removed');
  PERFORM pg_temp.expect_error(format('SELECT public.cancel_friend_request(%L)', carol),
    'double-cancel rejected', 'No outgoing');

  -- 6. block / unblock -------------------------------------------------------------
  PERFORM pg_temp.impersonate(bob);
  PERFORM public.block_user(alice);
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.friendships WHERE user_id=bob AND friend_id=alice AND status='blocked')
    AND EXISTS (SELECT 1 FROM public.friendships WHERE user_id=alice AND friend_id=bob AND status='removed'),
    'block is asymmetric: blocker edge blocked, other edge removed');

  PERFORM pg_temp.impersonate(alice);
  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', bob),
    'blocked user cannot request blocker', 'Cannot send');
  PERFORM pg_temp.impersonate(bob);
  PERFORM pg_temp.expect_error(format('SELECT public.send_friend_request(%L)', alice),
    'blocker cannot request while block stands', 'Cannot send');

  -- mutual block: alice blocks bob too; bob unblocks; alice's block must survive
  PERFORM pg_temp.impersonate(alice);
  PERFORM public.block_user(bob);
  PERFORM pg_temp.impersonate(bob);
  PERFORM public.unblock_user(alice);
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.friendships WHERE user_id=alice AND friend_id=bob AND status='blocked')
    AND EXISTS (SELECT 1 FROM public.friendships WHERE user_id=bob AND friend_id=alice AND status='removed'),
    'unblock never downgrades the other party''s own block');
  PERFORM pg_temp.impersonate(alice);
  PERFORM public.unblock_user(bob);
  PERFORM pg_temp.expect_error(format('SELECT public.unblock_user(%L)', bob),
    'unblock without block rejected', 'not blocked');

  -- full happy path after unblock
  PERFORM public.send_friend_request(bob);
  PERFORM pg_temp.impersonate(bob);
  PERFORM public.respond_friend_request(alice, true);
  PERFORM pg_temp.assert(public.is_accepted_friend(alice,bob),
    'request → accept works after unblock');

  -- 7. find_user_by_email ------------------------------------------------------------
  PERFORM pg_temp.impersonate(alice);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.find_user_by_email('bob@test0017.invalid')) = 0,
    'email lookup returns nothing without opt-in');
  UPDATE public.users SET allow_email_lookup = true WHERE id = bob;
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.find_user_by_email('  BOB@Test0017.INVALID ')) = 1,
    'email lookup exact-matches case/space-insensitively after opt-in');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.find_user_by_email('bob@')) = 0,
    'email lookup has no partial match');
  PERFORM pg_temp.impersonate(NULL);
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.find_user_by_email('bob@test0017.invalid')) = 0,
    'email lookup returns nothing unauthenticated');

  -- 8. RLS ------------------------------------------------------------------------------
  -- Switch to the authenticated role (RLS applies; the postgres role owns the
  -- table so RLS is bypassed for it). SET LOCAL scopes the switch to this block.
  -- (Bookkeeping happens after RESET ROLE — authenticated can't write _results.)
  PERFORM pg_temp.impersonate(alice);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO c1 FROM public.friendships;
  SELECT count(*) INTO c2 FROM public.friendships WHERE user_id = alice;
  BEGIN
    INSERT INTO public.friendships (user_id, friend_id, status, requested_by)
    VALUES (alice, carol, 'accepted', alice);
    v_insert_denied := false;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_insert_denied := true;
      v_err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(c1 = c2 AND c1 > 0, 'RLS: users read only their own edges');
  PERFORM pg_temp.assert(v_insert_denied, 'RLS: direct INSERT denied (' || coalesce(v_err,'') || ')');
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup + results (cascades remove profiles and friendship rows)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0017.invalid';

SELECT outcome, name FROM _results ORDER BY seq;
