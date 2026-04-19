-- =============================================================================
-- Migration: 0001_users.sql
-- Creates public.users profile table, auto-insert trigger, and RLS policies.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TABLE: public.users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id           uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text        NOT NULL,
  handle       text        UNIQUE,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- 2. TRIGGER FUNCTION: sync new auth.users rows → public.users
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.email
    )
  );
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. TRIGGER: fire handle_new_auth_user after every auth.users INSERT
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_auth_user();


-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read any profile (needed for friend/search flows)
DROP POLICY IF EXISTS "authenticated users can read all profiles" ON public.users;
CREATE POLICY "authenticated users can read all profiles"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (true);

-- Users may only update their own row
DROP POLICY IF EXISTS "users can update own profile" ON public.users;
CREATE POLICY "users can update own profile"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No direct INSERT policy — rows are created exclusively by the trigger above.
