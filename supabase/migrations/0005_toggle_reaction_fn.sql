-- =============================================================================
-- Migration: 0005_toggle_reaction_fn.sql
-- SECURITY DEFINER function: toggle_reaction(p_comment_id, p_emoji)
--
-- Why a function?
--   The comments RLS only allows the comment *author* to update their row
--   (needed to protect edits and soft-deletes).  Reactions, however, must be
--   writable by *any* authenticated user.  A SECURITY DEFINER function runs
--   with elevated privileges and validates auth.uid() itself, giving us the
--   best of both worlds: proper RLS for edits, open writes for reactions.
--
-- Behavior:
--   • Reactions are stored as JSONB: { "<emoji>": { "<user_uuid>": true } }
--   • A user may hold at most ONE emoji per comment at a time.
--   • Calling toggle_reaction with the emoji the user already has → removes it.
--   • Calling toggle_reaction with a different emoji → removes the old one,
--     adds the new one.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.toggle_reaction(
  p_comment_id  uuid,
  p_emoji       text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       text;
  v_reactions     jsonb;
  v_key           text;
  v_had_this_one  boolean;
BEGIN
  -- Must be authenticated
  v_user_id := auth.uid()::text;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load current reactions (default to empty object if null)
  SELECT COALESCE(reactions, '{}')
    INTO v_reactions
    FROM public.comments
   WHERE id = p_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found: %', p_comment_id;
  END IF;

  -- Remember whether the user already had exactly THIS emoji
  -- before we start modifying the JSONB
  v_had_this_one := COALESCE(
    (v_reactions -> p_emoji ->> v_user_id)::boolean,
    false
  );

  -- Remove the user from every emoji bucket
  FOR v_key IN SELECT jsonb_object_keys(v_reactions) LOOP
    v_reactions := jsonb_set(
      v_reactions,
      ARRAY[v_key],
      COALESCE(v_reactions -> v_key, '{}') - v_user_id
    );
  END LOOP;

  -- If the user did NOT already have this emoji, add it now
  -- (if they DID have it, the loop above already removed it → toggle-off)
  IF NOT v_had_this_one THEN
    v_reactions := jsonb_set(
      v_reactions,
      ARRAY[p_emoji],
      COALESCE(v_reactions -> p_emoji, '{}') || jsonb_build_object(v_user_id, true),
      true   -- create the emoji key if it doesn't exist yet
    );
  END IF;

  -- Persist
  UPDATE public.comments
     SET reactions  = v_reactions,
         updated_at = now()
   WHERE id = p_comment_id;
END;
$$;

-- Grant execute to authenticated users (the function validates auth.uid() internally)
GRANT EXECUTE ON FUNCTION public.toggle_reaction(uuid, text) TO authenticated;
