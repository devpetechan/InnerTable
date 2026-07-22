-- =============================================================================
-- Migration: 0021_categories.sql
-- InnerTable v0.5.0 Phase 1 (REL-12): seeded taste categories + place join.
--
-- WHY (see workspace/v0.5.0-implementation-plan.md, decision record §1):
-- categories are the small, seeded, interpretable *factor set* the explicit
-- trust model is keyed on ((user, user, category) — Barra, not PCA).  They are
-- deliberately separate from v0.4.0 place_tags (freeform classification /
-- candor).  The seed mirrors the index.html f-cuisine dropdown for continuity
-- (~19 entries, larger than the 8–15 factor target — resolved at the UI
-- surface, not here; do NOT "fix" the seed by adding more).
--
-- place_categories is v0.6 prep, NOT v0.5.0-critical: nothing is computed
-- over places until implicit similarity lands.  Backfill is best-effort.
--
-- WHERE CUISINE FREE-TEXT LIVES: public.places.cuisine (created 0007).
-- The old IT-045 backlog note said "entries" — that is stale: entries never
-- had a cuisine column; the legacy recommendations.cuisine was folded into
-- places during the 0007-era backfill and dropped in 0013.  So the backfill
-- below maps places.cuisine → categories.slug directly, keyed on place_id.
-- Free-text places.cuisine and places.place_type stay as fallback (same
-- pattern as 0019 keeping place_type behind tags); dropping them is later
-- cleanup.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.categories (seeded, controlled reference data)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        UNIQUE NOT NULL,   -- normalized, e.g. 'chinese','cocktail-bar'
  display_name  text        NOT NULL,
  category_type text        NOT NULL
                CHECK (category_type IN ('cuisine','venue_type')),  -- room for 'experience' later
  sort_order    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 2. TABLE: public.place_categories (join — v0.6 prep)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.place_categories (
  place_id    uuid        NOT NULL REFERENCES public.places     (id) ON DELETE CASCADE,
  category_id uuid        NOT NULL REFERENCES public.categories (id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (place_id, category_id)
);

-- The PK's place_id prefix serves "categories for this place"; index the
-- reverse direction ("places in this category") for v0.6 similarity queries.
CREATE INDEX IF NOT EXISTS place_categories_category_id_idx
  ON public.place_categories (category_id);


-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY: read-all for authenticated, NO client writes.
--    Categories are shared reference data (not candor); seed/curation happens
--    in migrations only.  place→category editing UI is deferred past v0.5.0.
--    (No GRANT statements needed — Supabase default privileges already grant
--    table access to authenticated; RLS is what blocks the writes.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read all categories" ON public.categories;
CREATE POLICY "authenticated users can read all categories"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated users can read all place categories" ON public.place_categories;
CREATE POLICY "authenticated users can read all place categories"
  ON public.place_categories
  FOR SELECT
  TO authenticated
  USING (true);

-- Deliberately NO INSERT/UPDATE/DELETE policies on either table.


-- -----------------------------------------------------------------------------
-- 4. SEED: the index.html f-cuisine dropdown, typed cuisine vs venue_type.
--    "Other" is not in the dropdown (the input is free-text with a datalist);
--    it is seeded per the plan as the catch-all cuisine.
--    sort_order: cuisines 10–150 in dropdown order, venue types 200–220,
--    Other last at 900.
-- -----------------------------------------------------------------------------
INSERT INTO public.categories (slug, display_name, category_type, sort_order) VALUES
  ('american',       'American',       'cuisine',    10),
  ('italian',        'Italian',        'cuisine',    20),
  ('mexican',        'Mexican',        'cuisine',    30),
  ('japanese',       'Japanese',       'cuisine',    40),
  ('chinese',        'Chinese',        'cuisine',    50),
  ('thai',           'Thai',           'cuisine',    60),
  ('indian',         'Indian',         'cuisine',    70),
  ('mediterranean',  'Mediterranean',  'cuisine',    80),
  ('french',         'French',         'cuisine',    90),
  ('korean',         'Korean',         'cuisine',   100),
  ('vietnamese',     'Vietnamese',     'cuisine',   110),
  ('middle-eastern', 'Middle Eastern', 'cuisine',   120),
  ('seafood',        'Seafood',        'cuisine',   130),
  ('brunch',         'Brunch',         'cuisine',   140),
  ('pizza',          'Pizza',          'cuisine',   150),
  ('cocktail-bar',   'Cocktail Bar',   'venue_type', 200),
  ('wine-bar',       'Wine Bar',       'venue_type', 210),
  ('craft-beer',     'Craft Beer',     'venue_type', 220),
  ('other',          'Other',          'cuisine',   900)
ON CONFLICT (slug) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 5. BACKFILL: best-effort places.cuisine free-text → place_categories.
--    Mapping: lowercase, trim, collapse whitespace to hyphens, match slug
--    ('Middle Eastern' → 'middle-eastern', '  ThAi ' → 'thai').  Unmapped
--    strings simply produce no row — acceptable (v0.6 prep, not critical).
--    Idempotent via ON CONFLICT; the acceptance test re-runs this statement
--    against its fixtures (keep the two copies in sync).
-- -----------------------------------------------------------------------------
INSERT INTO public.place_categories (place_id, category_id)
SELECT p.id, c.id
FROM public.places p
JOIN public.categories c
  ON c.slug = regexp_replace(lower(btrim(p.cuisine)), '\s+', '-', 'g')
WHERE p.cuisine IS NOT NULL
  AND btrim(p.cuisine) <> ''
ON CONFLICT (place_id, category_id) DO NOTHING;


-- =============================================================================
-- VERIFY AFTER APPLYING (0019 lesson — misses are silent):
--
--   -- both tables exist (expect two non-NULL regclasses)
--   SELECT to_regclass('public.categories'), to_regclass('public.place_categories');
--
--   -- seed counts (expect cuisine 16, venue_type 3, total 19)
--   SELECT category_type, count(*) FROM public.categories GROUP BY 1 ORDER BY 1;
--
--   -- RLS on, no write policies (expect rowsecurity = true, only SELECT policies)
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND tablename IN ('categories','place_categories');
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('categories','place_categories');
--
--   -- backfill coverage: places with / without a category row
--   SELECT count(*) FILTER (WHERE pc.place_id IS NOT NULL) AS with_category,
--          count(*) FILTER (WHERE pc.place_id IS NULL)     AS without_category
--   FROM public.places p
--   LEFT JOIN (SELECT DISTINCT place_id FROM public.place_categories) pc
--     ON pc.place_id = p.id;
--
--   -- which cuisine strings failed to map (candidates for later cleanup)
--   SELECT DISTINCT p.cuisine FROM public.places p
--   LEFT JOIN public.categories c
--     ON c.slug = regexp_replace(lower(btrim(p.cuisine)), '\s+', '-', 'g')
--   WHERE p.cuisine IS NOT NULL AND btrim(p.cuisine) <> '' AND c.id IS NULL;
-- =============================================================================
