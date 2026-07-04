-- ═════════════════════════════════════════════════════════════════════════════
--  0011_lauriston_backfill.sql
--  IT-037 pre-flight data fix (InnerTable v0.3.0)
--
--  WHY: the legacy public.recommendations row for "The Lauriston"
--  (id 0f7df8b9-b38f-440a-af23-826a44835f02, created 2026-05-04) was written
--  AFTER the April backfill (scripts/backfill-places.sql / backfill-entries.sql)
--  ran, so it never made it into places + entries and its place_id is NULL.
--  It is the only such row (all other 13 rows have non-NULL place_id).
--  Without this fix, dropping the legacy table would silently lose the take.
--
--  Idempotent: safe to re-run (guarded by google_place_id / user+place lookups).
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Create the missing places row (if not already present).
INSERT INTO public.places
  (id, google_place_id, name, location, lat, lng, place_type, cuisine, price,
   created_by, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'ChIJQ9s9uh8ddkgRqnHZuVxvyoI',
  'The Lauriston',
  'London E9 7JN, UK',
  51.5379188,
  -0.0450739,
  'restaurant',
  '',
  '$$',
  'bb10e926-0649-42ee-a7de-4bac181e9b09',
  '2026-05-04T18:50:06.305036+00:00',
  '2026-05-04T18:50:06.305036+00:00'
WHERE NOT EXISTS (
  SELECT 1 FROM public.places
  WHERE google_place_id = 'ChIJQ9s9uh8ddkgRqnHZuVxvyoI'
);

-- 2. Create the missing entries row for that place.
INSERT INTO public.entries
  (user_id, place_id, status, overall_rating, quality, service, value, ambiance,
   notes, try_note, url, created_at, updated_at)
SELECT
  'bb10e926-0649-42ee-a7de-4bac181e9b09',
  p.id,
  'been-recommend',
  4, 4, 3, 4, 3,
  'Decent pub, standard beer list, pretty good pizza',
  NULL,
  NULL,
  '2026-05-04T18:50:06.305036+00:00',
  '2026-05-04T18:50:06.305036+00:00'
FROM public.places p
WHERE p.google_place_id = 'ChIJQ9s9uh8ddkgRqnHZuVxvyoI'
  AND NOT EXISTS (
    SELECT 1 FROM public.entries e
    WHERE e.place_id = p.id
      AND e.user_id  = 'bb10e926-0649-42ee-a7de-4bac181e9b09'
  );

-- 3. Point the legacy row at the new place, so the invariant "every
--    recommendations row has a place_id" holds before the rename in 0012.
UPDATE public.recommendations r
SET place_id = p.id
FROM public.places p
WHERE p.google_place_id = 'ChIJQ9s9uh8ddkgRqnHZuVxvyoI'
  AND r.id = '0f7df8b9-b38f-440a-af23-826a44835f02'
  AND r.place_id IS NULL;

-- VERIFY (expect 1 place, 1 entry, 0 legacy rows with NULL place_id):
--   SELECT count(*) FROM public.places  WHERE google_place_id = 'ChIJQ9s9uh8ddkgRqnHZuVxvyoI';
--   SELECT count(*) FROM public.entries e JOIN public.places p ON p.id = e.place_id
--     WHERE p.google_place_id = 'ChIJQ9s9uh8ddkgRqnHZuVxvyoI';
--   SELECT count(*) FROM public.recommendations WHERE place_id IS NULL;
