-- =============================================================================
-- Migration: 0020_realtime_publication.sql
-- IT-107: the app has subscribed to places / entries / comments /
-- comment_reactions since v0.3, but those tables were never added to the
-- supabase_realtime publication — the events it listens for never fired.
-- (Only user_rec_interactions (0004), friendships (0017), entry_notes (0018)
-- and place_tags (0019) were published.)  This is why cross-user changes
-- required a reload, and why the comments code carries explicit-refresh
-- workarounds.
--
-- The publication is Postgres logical replication's "which tables broadcast
-- changes" list; Supabase Realtime forwards those broadcasts to WebSocket
-- subscribers.  Subscribing client-side does nothing if the table isn't in
-- the publication — no error, just silence.  Fail-silent, hence unnoticed.
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['places', 'entries', 'comments', 'comment_reactions']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;  -- already published — fine
      WHEN undefined_object THEN NULL;  -- publication absent on bare local Postgres
    END;
  END LOOP;
END;
$$;
