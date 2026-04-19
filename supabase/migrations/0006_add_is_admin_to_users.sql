-- =============================================================================
-- Migration: 0006_add_is_admin_to_users.sql
-- Adds is_admin flag to public.users so admin permissions are stored in the
-- database instead of being checked via a client-side password.
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Note: To grant admin access to a user, run this in the Supabase SQL editor
-- (replacing the UUID with the actual user's ID from auth.users):
--
--   UPDATE public.users SET is_admin = true WHERE id = '<user-uuid>';
--
-- You can find a user's UUID in the Supabase dashboard under
-- Authentication → Users.
