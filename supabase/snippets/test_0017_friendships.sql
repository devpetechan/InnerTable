-- Test harness for 0017_friendships.sql — run after stub + migration.
\set ON_ERROR_STOP on
\pset pager off

-- helpers ---------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS test;
CREATE OR REPLACE FUNCTION test.set_uid(u uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('test.uid', coalesce(u::text,''), false) $$;

CREATE OR REPLACE FUNCTION test.expect_error(p_sql text, p_name text, p_msg text DEFAULT NULL)
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
    RAISE NOTICE 'PASS: % (%)', p_name, SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION test.assert(p_cond boolean, p_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond THEN RAISE NOTICE 'PASS: %', p_name;
  ELSE RAISE EXCEPTION 'FAIL: %', p_name; END IF;
END $$;

-- fixtures --------------------------------------------------------------
\set alice '''00000000-0000-0000-0000-00000000000a'''
\set bob   '''00000000-0000-0000-0000-00000000000b'''
\set carol '''00000000-0000-0000-0000-00000000000c'''
\set ghost '''00000000-0000-0000-0000-0000000000ff'''

-- 1. request lifecycle ----------------------------------------------------
SELECT test.set_uid(:alice);
SELECT public.send_friend_request(:bob);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE status='pending' AND requested_by=:alice) = 2
  AND EXISTS (SELECT 1 FROM friendships WHERE user_id=:alice AND friend_id=:bob AND status='pending')
  AND EXISTS (SELECT 1 FROM friendships WHERE user_id=:bob AND friend_id=:alice AND status='pending'),
  'request creates directional pending pair');

SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:bob) || ')',
  'duplicate request rejected', 'already pending');
SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:alice) || ')',
  'self-request rejected', 'yourself');
SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:ghost) || ')',
  'unknown target rejected', 'User not found');
SELECT test.expect_error('SELECT public.respond_friend_request(' || quote_literal(:bob) || ', true)',
  'requester cannot accept own request', 'No incoming');

-- 2. mutual request auto-accepts ------------------------------------------
SELECT test.set_uid(:bob);
SELECT public.send_friend_request(:alice);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE status='accepted' AND accepted_at IS NOT NULL) = 2,
  'mutual request auto-accepts both edges');
SELECT test.assert(public.is_accepted_friend(:alice,:bob) AND public.is_accepted_friend(:bob,:alice),
  'is_accepted_friend true both directions');
SELECT test.assert(NOT public.is_accepted_friend(:alice,:carol),
  'is_accepted_friend false for strangers');
SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:alice) || ')',
  'request while friends rejected', 'Already friends');

-- 3. remove + re-request reuses rows ---------------------------------------
SELECT test.set_uid(:alice);
SELECT public.remove_friend(:bob);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE status='removed' AND accepted_at IS NULL) = 2,
  'remove flips both edges to removed');
SELECT test.expect_error('SELECT public.remove_friend(' || quote_literal(:bob) || ')',
  'double-remove rejected', 'Not friends');
SELECT public.send_friend_request(:bob);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE status='pending' AND requested_by=:alice) = 2
  AND (SELECT count(*) FROM friendships) = 2,
  're-request after remove reuses the two rows');

-- 4. decline ---------------------------------------------------------------
SELECT test.set_uid(:bob);
SELECT public.respond_friend_request(:alice, false);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE status='removed') = 2,
  'decline flips both edges to removed');
SELECT test.set_uid(:carol);
SELECT test.expect_error('SELECT public.respond_friend_request(' || quote_literal(:alice) || ', true)',
  'respond without pending rejected', 'No incoming');

-- 5. cancel ----------------------------------------------------------------
SELECT test.set_uid(:alice);
SELECT public.send_friend_request(:carol);
SELECT public.cancel_friend_request(:carol);
SELECT test.assert(
  (SELECT count(*) FROM friendships WHERE friend_id=:carol AND status='removed'
     AND user_id=:alice) = 1,
  'cancel flips outgoing pending to removed');
SELECT test.expect_error('SELECT public.cancel_friend_request(' || quote_literal(:carol) || ')',
  'double-cancel rejected', 'No outgoing');

-- 6. block / unblock ---------------------------------------------------------
SELECT test.set_uid(:bob);
SELECT public.block_user(:alice);
SELECT test.assert(
  EXISTS (SELECT 1 FROM friendships WHERE user_id=:bob AND friend_id=:alice AND status='blocked')
  AND EXISTS (SELECT 1 FROM friendships WHERE user_id=:alice AND friend_id=:bob AND status='removed'),
  'block is asymmetric: blocker edge blocked, other edge removed');

SELECT test.set_uid(:alice);
SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:bob) || ')',
  'blocked user cannot request blocker', 'Cannot send');
SELECT test.set_uid(:bob);
SELECT test.expect_error('SELECT public.send_friend_request(' || quote_literal(:alice) || ')',
  'blocker cannot request while block stands', 'Cannot send');

-- mutual block: alice blocks bob too, then bob unblocks — alice's block must survive
SELECT test.set_uid(:alice);
SELECT public.block_user(:bob);
SELECT test.set_uid(:bob);
SELECT public.unblock_user(:alice);
SELECT test.assert(
  EXISTS (SELECT 1 FROM friendships WHERE user_id=:alice AND friend_id=:bob AND status='blocked')
  AND EXISTS (SELECT 1 FROM friendships WHERE user_id=:bob AND friend_id=:alice AND status='removed'),
  'unblock never downgrades the other party''s own block');
SELECT test.set_uid(:alice);
SELECT public.unblock_user(:bob);
SELECT test.expect_error('SELECT public.unblock_user(' || quote_literal(:bob) || ')',
  'unblock without block rejected', 'not blocked');

-- full happy path after unblock
SELECT public.send_friend_request(:bob);
SELECT test.set_uid(:bob);
SELECT public.respond_friend_request(:alice, true);
SELECT test.assert(public.is_accepted_friend(:alice,:bob),
  'request → accept works after unblock');

-- 7. find_user_by_email -------------------------------------------------------
SELECT test.set_uid(:alice);
SELECT test.assert(
  (SELECT count(*) FROM public.find_user_by_email('bob@example.com')) = 0,
  'email lookup returns nothing without opt-in');
UPDATE public.users SET allow_email_lookup = true WHERE id = :bob;
SELECT test.assert(
  (SELECT count(*) FROM public.find_user_by_email('  BOB@Example.COM ')) = 1,
  'email lookup exact-matches case/space-insensitively after opt-in');
SELECT test.assert(
  (SELECT count(*) FROM public.find_user_by_email('bob@')) = 0,
  'email lookup has no partial match');
SELECT test.set_uid(NULL);
SELECT test.assert(
  (SELECT count(*) FROM public.find_user_by_email('bob@example.com')) = 0,
  'email lookup returns nothing unauthenticated');

-- 8. RLS ------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public, auth, test TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
SET ROLE authenticated;
SELECT test.set_uid(:alice);
SELECT test.assert(
  (SELECT count(*) FROM friendships) = (SELECT count(*) FROM friendships WHERE user_id=:alice),
  'RLS: users read only their own edges');
SELECT test.expect_error(
  'INSERT INTO public.friendships VALUES (' || quote_literal(:alice) || ',' || quote_literal(:carol) || ', ''accepted'',' || quote_literal(:alice) || ')',
  'RLS: direct INSERT denied even with table grant');
RESET ROLE;

SELECT 'ALL TESTS PASSED' AS result;
