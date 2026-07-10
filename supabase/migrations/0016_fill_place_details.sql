-- ═════════════════════════════════════════════════════════════════════════════
--  0016_fill_place_details.sql
--  IT-101 (InnerTable v0.3.2)
--
--  "Add your take" on a place saved by someone else as want-to-try leaves
--  cuisine/price permanently blank: place metadata is locked after creation
--  (IT-035 resolved decision #1) and RLS on places grants no UPDATE at all.
--
--  Resolution: the first user to supply a missing detail may FILL it, but
--  nobody can OVERWRITE an existing value.  A plain UPDATE policy can't
--  express "only null columns may change", so this is a SECURITY DEFINER
--  function whose body enforces fill-only semantics with COALESCE — the
--  lock-after-creation model stays intact for values that exist.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fill_place_details(
  p_place_id uuid,
  p_cuisine  text DEFAULT NULL,
  p_price    text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.places
  SET cuisine = COALESCE(cuisine, NULLIF(trim(p_cuisine), '')),
      price   = COALESCE(price,   NULLIF(trim(p_price),   ''))
  WHERE id = p_place_id;
$$;

-- Only signed-in users may call it (anon/public get nothing).
REVOKE ALL ON FUNCTION public.fill_place_details(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fill_place_details(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fill_place_details(uuid, text, text) TO authenticated;

-- VERIFY:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname = 'fill_place_details';
