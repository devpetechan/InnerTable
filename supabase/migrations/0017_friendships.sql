-- =============================================================================
-- Migration: 0017_friendships.sql
-- InnerTable v0.4.0 (REL-11): friendships table, state-machine RPCs, and
-- friend-search support columns on public.users.
--
-- THE TWO-ROW MODEL
-- ─────────────────────────────────────────────────────────────────
-- A friendship is stored as TWO directional rows, one per direction:
--
--   Alice requests Bob:
--     (user_id=alice, friend_id=bob,   status='pending', requested_by=alice)
--     (user_id=bob,   friend_id=alice, status='pending', requested_by=alice)
--
--   Bob accepts → both rows flip to 'accepted'.
--
-- Why two rows? Every RLS check and UI query becomes "rows where
-- user_id = me" — no OR over which column I happen to be in. It also lets
-- block be asymmetric: Bob's edge can say 'blocked' while Alice's says
-- 'removed' (she just sees the friendship gone).
--
-- The cost is keeping the pair consistent — which is why ALL writes go
-- through the SECURITY DEFINER functions below. There are deliberately NO
-- INSERT/UPDATE/DELETE policies on this table: with RLS enabled and no
-- policy for a command, Postgres denies it. Clients can only read their
-- own edges and call the RPCs.
--
-- STATUS VALUES / STATE MACHINE
-- ─────────────────────────────────────────────────────────────────
--   pending  → accepted   (respond accept; or auto-accept on mutual request)
--   pending  → removed    (respond decline, or requester cancels)
--   accepted → removed    (remove_friend)
--   any      → blocked    (block_user — blocker's edge only)
--   blocked  → removed    (unblock_user)
--   removed  → pending    (send_friend_request reuses the rows)
--
-- 'removed' rows are kept (not deleted) so re-requesting is a simple
-- upsert and history survives. A 'blocked' edge in either direction makes
-- send_friend_request fail.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. public.users additions: bio (friend profile page) and email-lookup opt-in
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bio                text,
  ADD COLUMN IF NOT EXISTS allow_email_lookup boolean NOT NULL DEFAULT false;


-- -----------------------------------------------------------------------------
-- 2. TABLE: public.friendships
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friendships (
  user_id      uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  friend_id    uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status       text        NOT NULL CHECK (status IN ('pending','accepted','blocked','removed')),

  -- Who initiated the current request. Distinguishes incoming from outgoing
  -- pending rows: incoming = (status='pending' AND requested_by <> user_id).
  requested_by uuid        NOT NULL REFERENCES public.users (id),

  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,

  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);


-- -----------------------------------------------------------------------------
-- 3. HELPER: is_accepted_friend(a, b)
--    Used by RLS policies on OTHER tables (entry_notes, comments in 0018).
--    SECURITY DEFINER so those policies don't recursively evaluate the
--    friendships RLS. STABLE so the planner may cache it within a query.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_accepted_friend(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.friendships
     WHERE user_id   = a
       AND friend_id = b
       AND status    = 'accepted'
  );
$$;


-- -----------------------------------------------------------------------------
-- 4. RPC: send_friend_request(target)
--    none/removed → pending. Mutual request (they already requested me)
--    auto-accepts instead of stacking a second request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_friend_request(p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me           uuid;
  v_status       text;
  v_requested_by uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'You cannot send a friend request to yourself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_target) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- A block in either direction kills the request. Deliberately the same
  -- error as "user not found" upstream would be nicer, but being explicit
  -- here is fine: the blocker's identity is never revealed.
  IF EXISTS (
    SELECT 1 FROM public.friendships
     WHERE ((user_id = v_me AND friend_id = p_target)
         OR (user_id = p_target AND friend_id = v_me))
       AND status = 'blocked'
  ) THEN
    RAISE EXCEPTION 'Cannot send friend request';
  END IF;

  SELECT status, requested_by
    INTO v_status, v_requested_by
    FROM public.friendships
   WHERE user_id = v_me AND friend_id = p_target;

  IF FOUND THEN
    IF v_status = 'accepted' THEN
      RAISE EXCEPTION 'Already friends';
    ELSIF v_status = 'pending' AND v_requested_by = v_me THEN
      RAISE EXCEPTION 'Request already pending';
    ELSIF v_status = 'pending' THEN
      -- They already requested me — sending back = accepting.
      UPDATE public.friendships
         SET status = 'accepted', accepted_at = now()
       WHERE (user_id = v_me AND friend_id = p_target)
          OR (user_id = p_target AND friend_id = v_me);
      RETURN;
    END IF;
    -- v_status = 'removed' falls through to the upsert below.
  END IF;

  INSERT INTO public.friendships (user_id, friend_id, status, requested_by)
  VALUES (v_me,     p_target, 'pending', v_me),
         (p_target, v_me,     'pending', v_me)
  ON CONFLICT (user_id, friend_id) DO UPDATE
    SET status       = 'pending',
        requested_by = EXCLUDED.requested_by,
        created_at   = now(),
        accepted_at  = NULL;
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. RPC: respond_friend_request(other, accept)
--    Only the NON-requester may respond. accept → accepted; decline → removed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_friend_request(p_other uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
     WHERE user_id      = v_me
       AND friend_id    = p_other
       AND status       = 'pending'
       AND requested_by = p_other   -- must be INCOMING; requester uses cancel
  ) THEN
    RAISE EXCEPTION 'No incoming pending request from this user';
  END IF;

  IF p_accept THEN
    UPDATE public.friendships
       SET status = 'accepted', accepted_at = now()
     WHERE (user_id = v_me AND friend_id = p_other)
        OR (user_id = p_other AND friend_id = v_me);
  ELSE
    UPDATE public.friendships
       SET status = 'removed', accepted_at = NULL
     WHERE (user_id = v_me AND friend_id = p_other)
        OR (user_id = p_other AND friend_id = v_me);
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. RPC: cancel_friend_request(target)
--    Only the requester may cancel their own outgoing pending request.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_friend_request(p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
     WHERE user_id      = v_me
       AND friend_id    = p_target
       AND status       = 'pending'
       AND requested_by = v_me
  ) THEN
    RAISE EXCEPTION 'No outgoing pending request to this user';
  END IF;

  UPDATE public.friendships
     SET status = 'removed', accepted_at = NULL
   WHERE (user_id = v_me AND friend_id = p_target)
      OR (user_id = p_target AND friend_id = v_me);
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. RPC: remove_friend(target)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_friend(p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
     WHERE user_id = v_me AND friend_id = p_target AND status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Not friends with this user';
  END IF;

  UPDATE public.friendships
     SET status = 'removed', accepted_at = NULL
   WHERE (user_id = v_me AND friend_id = p_target)
      OR (user_id = p_target AND friend_id = v_me);
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. RPC: block_user(target) / unblock_user(target)
--    Blocking is asymmetric: only the blocker's edge reads 'blocked'.
--    The other edge becomes 'removed' (the blocked user just sees the
--    friendship gone) — unless THEY also blocked, which we preserve.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_user(p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'You cannot block yourself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_target) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- My edge → blocked
  INSERT INTO public.friendships (user_id, friend_id, status, requested_by)
  VALUES (v_me, p_target, 'blocked', v_me)
  ON CONFLICT (user_id, friend_id) DO UPDATE
    SET status = 'blocked', accepted_at = NULL;

  -- Their edge → removed (but never downgrade their own block)
  INSERT INTO public.friendships (user_id, friend_id, status, requested_by)
  VALUES (p_target, v_me, 'removed', v_me)
  ON CONFLICT (user_id, friend_id) DO UPDATE
    SET status = 'removed', accepted_at = NULL
    WHERE public.friendships.status <> 'blocked';
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_target uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
     WHERE user_id = v_me AND friend_id = p_target AND status = 'blocked'
  ) THEN
    RAISE EXCEPTION 'This user is not blocked';
  END IF;

  UPDATE public.friendships
     SET status = 'removed'
   WHERE user_id = v_me AND friend_id = p_target;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. RPC: find_user_by_email(email)
--    Exact-match only (no scraping), only if the target opted in, and the
--    email itself is never returned. Emails live in auth.users, which
--    clients cannot read — hence SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_user_by_email(p_email text)
RETURNS TABLE (id uuid, display_name text, handle text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT pu.id, pu.display_name, pu.handle, pu.avatar_url
    FROM auth.users au
    JOIN public.users pu ON pu.id = au.id
   WHERE auth.uid() IS NOT NULL
     AND pu.allow_email_lookup
     AND lower(au.email) = lower(trim(p_email));
$$;


-- -----------------------------------------------------------------------------
-- 10. FUNCTION GRANTS
--     Lock the RPCs to logged-in users only.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_accepted_friend(uuid, uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_friend_request(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_friend_request(uuid)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_friend(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.block_user(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unblock_user(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_user_by_email(text)                FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_accepted_friend(uuid, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_friend_request(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(uuid)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text)              TO authenticated;


-- -----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
--     Read your own edges only. NO write policies — with RLS enabled and no
--     policy for INSERT/UPDATE/DELETE, Postgres denies those commands, so
--     the RPCs above are the only write path.
-- -----------------------------------------------------------------------------
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own friendship edges" ON public.friendships;
CREATE POLICY "users can read own friendship edges"
  ON public.friendships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


-- -----------------------------------------------------------------------------
-- 12. REALTIME
--     Needed for the Friends-tab badge (v0.4.0 Phase 3). Same pattern as
--     0004: tolerate the table already being in the publication.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;  -- publication absent on bare local Postgres
END;
$$;
