-- =============================================================================
-- test_0018_privacy_supabase.sql
-- Acceptance test for 0018 (circle-scoped notes/comments) — works in the
-- Supabase SQL editor AND against a stubbed local Postgres.
--
-- THE MATRIX
--   A–B friends · A–D, B–D friends · A–E friends (E NOT friends with B)
--   C is a stranger to everyone.
--   A writes an entry with a note; B comments; A quotes B's comment.
--
--   Viewer expectations:
--     B (friend)        → sees A's note, A/B comments, the quote
--     C (stranger)      → sees A's rating (entries stay member-visible) but
--                         NO note, NO comments; cannot write a note onto A's
--                         entry; A cannot see C's own note (both ways)
--     E (A's circle,    → sees A's plain comment but NOT A's comment quoting
--        not B's)         B — the fail-closed both-circles rule
--     D (both circles)  → sees the quote
--
-- Paste the whole file into the Supabase SQL editor and run once.  Results
-- appear as a PASS grid; any FAIL aborts with an error.  All fixtures are
-- deleted at the end (and re-created if you re-run after a failure).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Harness (same pattern as test_0017_friendships_supabase.sql)
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
-- Fixtures: five throwaway users (signup trigger creates profiles)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0018.invalid';
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-b000-00000000000a', 'alice@test0018.invalid'),
  ('00000000-0000-4000-b000-00000000000b', 'bob@test0018.invalid'),
  ('00000000-0000-4000-b000-00000000000c', 'carol@test0018.invalid'),
  ('00000000-0000-4000-b000-00000000000d', 'dave@test0018.invalid'),
  ('00000000-0000-4000-b000-00000000000e', 'erin@test0018.invalid');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-b000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  c uuid := '00000000-0000-4000-b000-00000000000c';
  d uuid := '00000000-0000-4000-b000-00000000000d';
  e uuid := '00000000-0000-4000-b000-00000000000e';
  v_place uuid; v_entry_a uuid; v_entry_c uuid;
  v_comment_b uuid; v_comment_a_plain uuid; v_comment_a_quote uuid;
  v_cnt int; v_cnt2 int; v_cnt3 int; v_denied boolean;
BEGIN
  -- Friendship graph via the real RPCs (A–B, A–D, B–D, A–E; C isolated)
  PERFORM pg_temp.impersonate(a); PERFORM public.send_friend_request(b);
                                  PERFORM public.send_friend_request(d);
                                  PERFORM public.send_friend_request(e);
  PERFORM pg_temp.impersonate(b); PERFORM public.respond_friend_request(a, true);
                                  PERFORM public.send_friend_request(d);
  PERFORM pg_temp.impersonate(d); PERFORM public.respond_friend_request(a, true);
                                  PERFORM public.respond_friend_request(b, true);
  PERFORM pg_temp.impersonate(e); PERFORM public.respond_friend_request(a, true);

  -- Content (inserted as table owner — RLS not applied; ids captured)
  INSERT INTO public.places (name, created_by) VALUES ('Test Trattoria 0018', a)
    RETURNING id INTO v_place;
  INSERT INTO public.entries (user_id, place_id, status, overall_rating)
    VALUES (a, v_place, 'been-recommend', 4) RETURNING id INTO v_entry_a;
  INSERT INTO public.entry_notes (entry_id, user_id, notes)
    VALUES (v_entry_a, a, 'candid circle-only note');
  INSERT INTO public.entries (user_id, place_id, status)
    VALUES (c, v_place, 'try') RETURNING id INTO v_entry_c;
  INSERT INTO public.entry_notes (entry_id, user_id, try_note)
    VALUES (v_entry_c, c, 'carols private-ish try note');

  INSERT INTO public.comments (place_id, author_id, text)
    VALUES (v_place, b, 'bobs comment: service was rude to us')
    RETURNING id INTO v_comment_b;
  INSERT INTO public.comments (place_id, author_id, text)
    VALUES (v_place, a, 'alices plain comment') RETURNING id INTO v_comment_a_plain;
  -- A quotes B — quoted_user_id must be filled by the trigger, not by us
  INSERT INTO public.comments (place_id, author_id, text, quoted_comment_id, quoted_author, quoted_text)
    VALUES (v_place, a, 'alice quoting bob', v_comment_b, 'Bob', 'service was rude to us')
    RETURNING id INTO v_comment_a_quote;
  INSERT INTO public.comment_reactions (comment_id, user_id, emoji) VALUES (v_comment_a_plain, b, '👍');
  INSERT INTO public.comment_reactions (comment_id, user_id, emoji) VALUES (v_comment_a_plain, c, '💀');

  -- Trigger check ------------------------------------------------------------
  PERFORM pg_temp.assert(
    (SELECT quoted_user_id FROM public.comments WHERE id = v_comment_a_quote) = b,
    'trigger derives quoted_user_id from the quoted comment');

  -- Schema check ---------------------------------------------------------------
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='entries'
                   AND column_name IN ('notes','try_note')),
    'entries.notes / try_note columns dropped');

  -- ══ Viewer B — friend of A ══════════════════════════════════════════════
  PERFORM pg_temp.impersonate(b);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt  FROM public.entry_notes WHERE entry_id = v_entry_a;
  SELECT count(*) INTO v_cnt2 FROM public.comments    WHERE place_id = v_place;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt  = 1, 'B (friend) sees A''s note');
  PERFORM pg_temp.assert(v_cnt2 = 3, 'B (friend) sees all three comments incl. the quote');

  -- ══ Viewer C — stranger ═════════════════════════════════════════════════
  -- (All bookkeeping deferred until after RESET ROLE — the authenticated
  --  role can't write the temp results table.)
  PERFORM pg_temp.impersonate(c);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt  FROM public.entries     WHERE place_id = v_place AND user_id = a;
  SELECT count(*) INTO v_cnt2 FROM public.entry_notes WHERE entry_id = v_entry_a;
  SELECT count(*) INTO v_cnt3 FROM public.comments    WHERE place_id = v_place;
  BEGIN
    INSERT INTO public.entry_notes (entry_id, user_id, notes) VALUES (v_entry_a, c, 'graffiti');
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege OR unique_violation THEN v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 1,  'C (stranger) still sees A''s entry — ratings are network signal');
  PERFORM pg_temp.assert(v_cnt2 = 0, 'C (stranger) sees NO note on A''s entry');
  PERFORM pg_temp.assert(v_cnt3 = 0, 'C (stranger) sees NO comments');
  PERFORM pg_temp.assert(v_denied, 'C cannot write a note onto A''s entry');

  -- ══ Viewer A — sees own + friends', not the stranger's ══════════════════
  PERFORM pg_temp.impersonate(a);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt  FROM public.entry_notes WHERE entry_id = v_entry_c;
  SELECT count(*) INTO v_cnt2 FROM public.comment_reactions WHERE comment_id = v_comment_a_plain;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 0,  'A cannot see stranger C''s note (symmetry)');
  PERFORM pg_temp.assert(v_cnt2 = 1, 'A sees friend B''s reaction but not stranger C''s');

  -- ══ Viewer E — A's circle but not B's: the quote must vanish ════════════
  PERFORM pg_temp.impersonate(e);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt FROM public.comments WHERE id = v_comment_a_plain;
  SELECT count(*) INTO v_cnt2 FROM public.comments WHERE id = v_comment_a_quote;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 1,  'E sees A''s plain comment');
  PERFORM pg_temp.assert(v_cnt2 = 0, 'E does NOT see A''s comment quoting B (fail-closed)');

  -- ══ Viewer D — in both circles: the quote survives ══════════════════════
  PERFORM pg_temp.impersonate(d);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt FROM public.comments WHERE id = v_comment_a_quote;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 1, 'D (friends with both) sees the quote');
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup (cascades: profiles → entries → entry_notes; comments; friendships)
-- ---------------------------------------------------------------------------
-- Users first: their cascade removes entries (place_id is ON DELETE RESTRICT,
-- so the place can only be deleted once its entries are gone).
DELETE FROM auth.users WHERE email LIKE '%@test0018.invalid';
DELETE FROM public.places WHERE name = 'Test Trattoria 0018';

SELECT outcome, name FROM _results ORDER BY seq;
