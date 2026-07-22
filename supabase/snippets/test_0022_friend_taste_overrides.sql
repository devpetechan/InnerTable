-- =============================================================================
-- test_0022_friend_taste_overrides.sql
-- Acceptance test for 0022 (friend_taste_overrides) — works in the Supabase
-- SQL editor AND against a stubbed local Postgres.
--
-- WHAT IT CHECKS (plan Phase 2 acceptance, raw SQL not UI)
--   1. Schema: table exists; PK is exactly (rater_id, friend_id, category_id);
--      the updated_at trigger is attached; FK-covering indexes exist.
--   2. Constraints: weight BETWEEN 0 AND 5 rejects 6 and -1;
--      rater_id <> friend_id rejects self-rating.
--   3. As user A (authenticated): weights for friend B across several
--      categories round-trip; NULL and 0 are distinguishable (null ≠ low —
--      NULL = no opinion, 0 = explicit mute); a plain duplicate insert raises
--      unique_violation; ON CONFLICT upserts in place (no duplicate row) and
--      the trigger refreshes updated_at; A cannot forge a row with someone
--      else's rater_id.
--   4. RLS isolation as user B: cannot SELECT A's rows; UPDATE and DELETE
--      against them affect 0 rows; B's own directional row (B rates A) works
--      independently.  Then, as postgres, A's rows are verified untouched.
--
-- A and B are NOT friended: the non-friend guard trigger is deliberately
-- deferred (0022 §4), so the schema must accept stranger overrides.
--
-- Paste the whole file into the Supabase SQL editor and run once.  Results
-- appear as a PASS grid; any FAIL aborts with an error.  All fixtures are
-- deleted at the end (and re-created if you re-run after a failure).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Harness (same pattern as test_0021_categories.sql)
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
-- Categories come from the 0021 seed — no category fixtures needed.
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0022.invalid';

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-b022-00000000000a', 'alice@test0022.invalid'),
  ('00000000-0000-4000-b022-00000000000b', 'bob@test0022.invalid');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-b022-00000000000a';
  b uuid := '00000000-0000-4000-b022-00000000000b';
  cat_thai  uuid; cat_pizza uuid; cat_other uuid;
  v_cnt int; v_upd int; v_del int;
  v_w_pizza smallint; v_w_other smallint; v_w_thai smallint;
  v_pizza_is_null boolean; v_other_is_null boolean;
  v_ts_before timestamptz; v_ts_after timestamptz;
  v_denied boolean; v_dup boolean; v_forge boolean;
BEGIN
  SELECT id INTO cat_thai  FROM public.categories WHERE slug = 'thai';
  SELECT id INTO cat_pizza FROM public.categories WHERE slug = 'pizza';
  SELECT id INTO cat_other FROM public.categories WHERE slug = 'other';

  -- ══ 1. Schema ════════════════════════════════════════════════════════════
  PERFORM pg_temp.assert(
    to_regclass('public.friend_taste_overrides') IS NOT NULL,
    'friend_taste_overrides table exists');

  PERFORM pg_temp.assert(
    (SELECT array_agg(att.attname::text ORDER BY k.ord)
       FROM pg_constraint con
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      WHERE con.conrelid = 'public.friend_taste_overrides'::regclass
        AND con.contype = 'p')
      = ARRAY['rater_id','friend_id','category_id'],
    'PK is exactly (rater_id, friend_id, category_id)');

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_trigger
             WHERE tgrelid = 'public.friend_taste_overrides'::regclass
               AND tgname = 'set_friend_taste_overrides_updated_at'
               AND NOT tgisinternal),
    'updated_at trigger is attached');

  PERFORM pg_temp.assert(
    to_regclass('public.friend_taste_overrides_friend_id_idx')   IS NOT NULL AND
    to_regclass('public.friend_taste_overrides_category_id_idx') IS NOT NULL,
    'FK-covering indexes exist (friend_id, category_id)');

  -- ══ 2. Constraints (as postgres — CHECKs fire regardless of role) ════════
  BEGIN
    INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
      VALUES (a, b, cat_thai, 6);
    v_denied := false;
  EXCEPTION WHEN check_violation THEN v_denied := true;
  END;
  PERFORM pg_temp.assert(v_denied, 'weight CHECK rejects 6 (above 0..5)');

  BEGIN
    INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
      VALUES (a, b, cat_thai, -1);
    v_denied := false;
  EXCEPTION WHEN check_violation THEN v_denied := true;
  END;
  PERFORM pg_temp.assert(v_denied, 'weight CHECK rejects -1 (below 0..5)');

  BEGIN
    INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
      VALUES (a, a, cat_thai, 3);
    v_denied := false;
  EXCEPTION WHEN check_violation THEN v_denied := true;
  END;
  PERFORM pg_temp.assert(v_denied, 'rater_id <> friend_id CHECK rejects self-rating');

  -- ══ 3. As user A (authenticated): write path + NULL/0 semantics ═══════════
  -- (All bookkeeping deferred until after RESET ROLE — the authenticated
  --  role can't write the temp results table.)
  PERFORM pg_temp.impersonate(a);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- thai gets a backdated updated_at so the trigger refresh is observable
  -- within this single transaction (the trigger sets now(), i.e. tx start).
  v_ts_before := now() - interval '1 day';
  INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight, updated_at)
    VALUES (a, b, cat_thai, 4, v_ts_before);
  INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
    VALUES (a, b, cat_pizza, 0),      -- explicit mute
           (a, b, cat_other, NULL);   -- row exists, no opinion

  SELECT count(*) INTO v_cnt FROM public.friend_taste_overrides
   WHERE rater_id = a AND friend_id = b;
  SELECT weight, weight IS NULL INTO v_w_pizza, v_pizza_is_null
    FROM public.friend_taste_overrides
   WHERE rater_id = a AND friend_id = b AND category_id = cat_pizza;
  SELECT weight, weight IS NULL INTO v_w_other, v_other_is_null
    FROM public.friend_taste_overrides
   WHERE rater_id = a AND friend_id = b AND category_id = cat_other;

  BEGIN  -- plain duplicate insert must hit the PK, not create a second row
    INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
      VALUES (a, b, cat_thai, 1);
    v_dup := false;
  EXCEPTION WHEN unique_violation THEN v_dup := true;
  END;

  -- the Phase 3 save path: upsert in place
  INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
    VALUES (a, b, cat_thai, 5)
  ON CONFLICT (rater_id, friend_id, category_id)
    DO UPDATE SET weight = EXCLUDED.weight;

  SELECT weight, updated_at INTO v_w_thai, v_ts_after
    FROM public.friend_taste_overrides
   WHERE rater_id = a AND friend_id = b AND category_id = cat_thai;
  SELECT count(*) INTO v_upd FROM public.friend_taste_overrides
   WHERE rater_id = a AND friend_id = b;

  BEGIN  -- forging someone else's rater_id must be blocked by WITH CHECK
    INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
      VALUES (b, a, cat_thai, 5);
    v_forge := false;
  EXCEPTION WHEN insufficient_privilege THEN v_forge := true;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 3, 'A: weights for friend B across three categories round-trip');
  PERFORM pg_temp.assert(NOT v_pizza_is_null AND v_w_pizza = 0 AND v_other_is_null,
    'A: 0 (mute) and NULL (no opinion) are distinguishable');
  PERFORM pg_temp.assert(v_dup, 'A: plain duplicate (rater,friend,category) raises unique_violation (PK)');
  PERFORM pg_temp.assert(v_w_thai = 5 AND v_upd = 3,
    'A: ON CONFLICT upserts in place — weight updated, still 3 rows');
  PERFORM pg_temp.assert(v_ts_after > v_ts_before,
    'A: upsert refreshes updated_at via trigger');
  PERFORM pg_temp.assert(v_forge, 'A: CANNOT insert a row with someone else''s rater_id');

  -- ══ 4. RLS isolation as user B ════════════════════════════════════════════
  PERFORM pg_temp.impersonate(b);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO v_cnt FROM public.friend_taste_overrides
   WHERE rater_id = a;

  UPDATE public.friend_taste_overrides SET weight = 1
   WHERE rater_id = a AND friend_id = b AND category_id = cat_thai;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  DELETE FROM public.friend_taste_overrides WHERE rater_id = a;
  GET DIAGNOSTICS v_del = ROW_COUNT;

  -- B's own directional row (B rates A) is independent and allowed —
  -- no friendship exists between the fixtures (guard deferred, 0022 §4).
  INSERT INTO public.friend_taste_overrides (rater_id, friend_id, category_id, weight)
    VALUES (b, a, cat_pizza, 2);

  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt = 0, 'B: cannot SELECT any of A''s override rows');
  PERFORM pg_temp.assert(v_upd = 0, 'B: UPDATE against A''s rows affects 0 rows');
  PERFORM pg_temp.assert(v_del = 0, 'B: DELETE against A''s rows affects 0 rows');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friend_taste_overrides WHERE rater_id = b AND friend_id = a) = 1,
    'B: own directional row (B rates A) persists independently');

  -- as postgres: A's rows survived B's write attempts, values intact
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.friend_taste_overrides
      WHERE rater_id = a AND friend_id = b) = 3
    AND (SELECT weight FROM public.friend_taste_overrides
          WHERE rater_id = a AND friend_id = b AND category_id = cat_thai) = 5,
    'A''s rows untouched after B''s update/delete attempts');
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup (auth.users delete cascades to public.users, which cascades to
-- friend_taste_overrides on both rater_id and friend_id)
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0022.invalid';

SELECT outcome, name FROM _results ORDER BY seq;
