-- =============================================================================
-- test_0021_categories.sql
-- Acceptance test for 0021 (categories + place_categories) — works in the
-- Supabase SQL editor AND against a stubbed local Postgres.
--
-- WHAT IT CHECKS
--   1. Schema: both tables exist; slug is UNIQUE; category_type CHECK holds;
--      place_categories has an index on category_id.
--   2. Seed: 19 categories — 16 cuisine, 3 venue_type — with expected slugs.
--   3. Backfill mapping: a fixture place with cuisine 'Middle Eastern' maps to
--      the 'middle-eastern' category via the same normalization the migration
--      uses; an unmappable string ('Fusion Tapas 0021') produces no row.
--   4. RLS: an authenticated user CAN select both tables, CANNOT insert into
--      either (no write policies — seed/backfill are migration-only).
--
-- Paste the whole file into the Supabase SQL editor and run once.  Results
-- appear as a PASS grid; any FAIL aborts with an error.  All fixtures are
-- deleted at the end (and re-created if you re-run after a failure).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Harness (same pattern as test_0018_privacy_supabase.sql)
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
-- Fixtures: one throwaway user (signup trigger creates the profile) and two
-- throwaway places — one with a mappable cuisine, one unmappable.
-- ---------------------------------------------------------------------------
DELETE FROM auth.users WHERE email LIKE '%@test0021.invalid';
DELETE FROM public.places WHERE name IN ('Test Souk 0021', 'Test Unmappable 0021');

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-b021-00000000000a', 'alice@test0021.invalid');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-b021-00000000000a';
  v_place_mapped   uuid;
  v_place_unmapped uuid;
  v_cnt int; v_cnt2 int;
  v_denied boolean; v_denied2 boolean;
BEGIN
  -- ══ 1. Schema ════════════════════════════════════════════════════════════
  PERFORM pg_temp.assert(
    to_regclass('public.categories') IS NOT NULL
      AND to_regclass('public.place_categories') IS NOT NULL,
    'categories and place_categories tables exist');

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.categories'::regclass
               AND contype = 'u'
               AND (SELECT array_agg(attname::text) FROM unnest(conkey) k
                     JOIN pg_attribute ON attrelid = conrelid AND attnum = k) = ARRAY['slug']),
    'categories.slug has a UNIQUE constraint');

  BEGIN  -- category_type CHECK rejects unknown types
    INSERT INTO public.categories (slug, display_name, category_type)
      VALUES ('bad-type-0021', 'Bad', 'experience');
    v_denied := false;
  EXCEPTION WHEN check_violation THEN v_denied := true;
  END;
  PERFORM pg_temp.assert(v_denied, 'category_type CHECK rejects values outside cuisine/venue_type');

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_index i
             JOIN pg_attribute att ON att.attrelid = i.indrelid
                                  AND att.attnum = ANY (i.indkey)
             WHERE i.indrelid = 'public.place_categories'::regclass
               AND att.attname = 'category_id'),
    'place_categories has an index covering category_id');

  -- ══ 2. Seed ══════════════════════════════════════════════════════════════
  SELECT count(*) INTO v_cnt  FROM public.categories WHERE category_type = 'cuisine';
  SELECT count(*) INTO v_cnt2 FROM public.categories WHERE category_type = 'venue_type';
  PERFORM pg_temp.assert(v_cnt = 16 AND v_cnt2 = 3,
    'seed: 16 cuisine + 3 venue_type = 19 categories');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.categories
      WHERE slug IN ('middle-eastern','cocktail-bar','wine-bar','craft-beer','other')) = 5
    AND (SELECT category_type FROM public.categories WHERE slug = 'cocktail-bar') = 'venue_type'
    AND (SELECT category_type FROM public.categories WHERE slug = 'other')        = 'cuisine',
    'seed: multi-word slugs normalized and typed as expected');

  -- ══ 3. Backfill mapping (re-runs the migration''s INSERT on fixtures) ═════
  INSERT INTO public.places (name, cuisine, created_by)
    VALUES ('Test Souk 0021', 'Middle Eastern', a) RETURNING id INTO v_place_mapped;
  INSERT INTO public.places (name, cuisine, created_by)
    VALUES ('Test Unmappable 0021', 'Fusion Tapas 0021', a) RETURNING id INTO v_place_unmapped;

  -- same statement as migration 0021 §5 (keep in sync)
  INSERT INTO public.place_categories (place_id, category_id)
  SELECT p.id, c.id
  FROM public.places p
  JOIN public.categories c
    ON c.slug = regexp_replace(lower(btrim(p.cuisine)), '\s+', '-', 'g')
  WHERE p.cuisine IS NOT NULL
    AND btrim(p.cuisine) <> ''
  ON CONFLICT (place_id, category_id) DO NOTHING;

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.place_categories pc
             JOIN public.categories c ON c.id = pc.category_id
             WHERE pc.place_id = v_place_mapped AND c.slug = 'middle-eastern'),
    'backfill maps ''Middle Eastern'' free-text to the middle-eastern category');

  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.place_categories WHERE place_id = v_place_unmapped),
    'backfill leaves unmappable cuisine strings without a row (best-effort)');

  -- ══ 4. RLS as authenticated: read yes, write no ══════════════════════════
  -- (All bookkeeping deferred until after RESET ROLE — the authenticated
  --  role can't write the temp results table.)
  PERFORM pg_temp.impersonate(a);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_cnt  FROM public.categories;
  SELECT count(*) INTO v_cnt2 FROM public.place_categories WHERE place_id = v_place_mapped;
  BEGIN
    INSERT INTO public.categories (slug, display_name, category_type)
      VALUES ('rogue-0021', 'Rogue', 'cuisine');
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  BEGIN
    INSERT INTO public.place_categories (place_id, category_id)
      VALUES (v_place_mapped, (SELECT id FROM public.categories WHERE slug = 'pizza'));
    v_denied2 := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied2 := true;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.assert(v_cnt >= 19, 'authenticated can SELECT categories (read-all)');
  PERFORM pg_temp.assert(v_cnt2 = 1,  'authenticated can SELECT place_categories (read-all)');
  PERFORM pg_temp.assert(v_denied,    'authenticated CANNOT insert into categories');
  PERFORM pg_temp.assert(v_denied2,   'authenticated CANNOT insert into place_categories');
END $$;

-- ---------------------------------------------------------------------------
-- Cleanup (place delete cascades to place_categories; user delete cascades
-- to the profile; places have no entries so no RESTRICT conflicts)
-- ---------------------------------------------------------------------------
DELETE FROM public.places WHERE name IN ('Test Souk 0021', 'Test Unmappable 0021');
DELETE FROM auth.users WHERE email LIKE '%@test0021.invalid';

SELECT outcome, name FROM _results ORDER BY seq;
