-- backfill-google-place-ids-2026-07-04.sql  (IT-056 pre-flight, one-time)
--
-- Four places predated autocomplete capturing google_place_id.  IDs resolved
-- 2026-07-04 via Places API text search (name + stored location); every match
-- was exact on name and postcode:
--   Beigel Bake      -> ChIJjUgahq0ddkgRDLV2zZrg4ck  (159 Brick Ln, E1 6SB)
--   manteca          -> ChIJG9ssOq8FdkgRGTu5-ErLMaI  (49-51 Curtain Rd, EC2A 3PT)
--   Midtown Spirits  -> ChIJS0sDhlnRmoARXAZVjq6Pilc  (1717 19th St B, Sacramento)
--   Waltz            -> ChIJnW3vxB0ddkgR78mdB6YLrq0  (28 Scrutton St, EC2A 4RP)
--
-- Guarded so a re-run (or a since-populated row) is a no-op.

UPDATE public.places SET google_place_id = 'ChIJjUgahq0ddkgRDLV2zZrg4ck'
WHERE id = '778830d0-879b-4684-a498-fa06355ce501' AND google_place_id IS NULL;

UPDATE public.places SET google_place_id = 'ChIJG9ssOq8FdkgRGTu5-ErLMaI'
WHERE id = '548495ed-76cb-488f-a412-07ba0e8ccae9' AND google_place_id IS NULL;

UPDATE public.places SET google_place_id = 'ChIJS0sDhlnRmoARXAZVjq6Pilc'
WHERE id = '509e9c31-7e0d-487a-9735-67b8cd112aec' AND google_place_id IS NULL;

UPDATE public.places SET google_place_id = 'ChIJnW3vxB0ddkgR78mdB6YLrq0'
WHERE id = 'ccd562f4-e5cd-4402-a44f-4db239b6caba' AND google_place_id IS NULL;

-- VERIFY (expect 0):
--   SELECT count(*) FROM public.places WHERE google_place_id IS NULL;
