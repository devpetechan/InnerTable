-- ═════════════════════════════════════════════════════════════════════════════
--  0015_place_external_aggregates.sql
--  IT-056 (InnerTable v0.3.0)
--
--  Cache of external aggregate ratings (Google Places today; the composite
--  primary key leaves room for other sources later, e.g. Yelp).
--
--  Refresh model (v0.3): CLIENT-SIDE.  When the app loads, it looks for places
--  whose cache row is missing or past expires_at and refreshes them through
--  the Google Places JS API (the browser key is HTTP-referrer-restricted, so
--  it cannot be used server-side).  Cards always read from this table, never
--  from the live API.  TTL is 7 days (set by the client at write time).
--  A server-side scheduled refresher can replace this in v0.6 when
--  predict_place needs guaranteed-fresh server reads.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.place_external_aggregates (
  place_id     uuid        NOT NULL REFERENCES public.places (id) ON DELETE CASCADE,
  source       text        NOT NULL DEFAULT 'google',
  rating       numeric,
  rating_count integer,
  price_level  integer,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (place_id, source)
);

-- Fast lookup of stale rows by the client refresher.
CREATE INDEX place_external_aggregates_expires_idx
  ON public.place_external_aggregates (expires_at);

ALTER TABLE public.place_external_aggregates ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read the cache (cards need it).
CREATE POLICY "authenticated users can read aggregates"
  ON public.place_external_aggregates
  FOR SELECT TO authenticated
  USING (true);

-- Any signed-in user may refresh the cache: the data is public Google
-- aggregate info, not user content, so ownership semantics don't apply.
CREATE POLICY "authenticated users can insert aggregates"
  ON public.place_external_aggregates
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated users can update aggregates"
  ON public.place_external_aggregates
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- No DELETE policy: rows die with their place via ON DELETE CASCADE.

-- VERIFY:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='place_external_aggregates'
--   ORDER BY ordinal_position;
