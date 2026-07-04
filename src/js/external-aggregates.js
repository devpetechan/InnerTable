// ══════════════════════════════════════════════════
//  EXTERNAL AGGREGATES (IT-056)
//
//  HOW IT WORKS (overview for learning):
//  ─────────────────────────────────────
//  Google's aggregate rating for a place (e.g. "4.6 from 1,234 reviews")
//  lives in a *cache table* (place_external_aggregates), not in the live
//  Google API.  Cards always read the cache; the live API is only touched
//  by the refresher below.
//
//  Refresh model (v0.3, client-side): after the app loads its places, we
//  look for cache rows that are missing or older than the TTL and refresh
//  just those through the Google Places JS API, staggered to avoid a burst
//  of API calls.  The browser Maps key is HTTP-referrer-restricted, so this
//  must run in the browser; a server-side scheduled job can take over in
//  v0.6 when predict_place needs server reads.
// ══════════════════════════════════════════════════


// TTL: how long a cached Google rating is considered fresh.
const EXTERNAL_AGG_TTL_DAYS = 7;

// Google's PriceLevel enum (strings) → the 0–4 integers our table stores.
const _PRICE_LEVEL_TO_INT = {
  FREE: 0, INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4
};

// Module state: { placeUuid: { rating, ratingCount, priceLevel, expiresAt } }
let _externalAggregates = {};
let _refreshRunning = false;


// ── READ PATH ────────────────────────────────────
// Called by fetchAllPlaces(). Loads the whole cache table (14 places → tiny)
// into _externalAggregates so the adapter can attach it to each place.
async function loadExternalAggregates() {
  const { data, error } = await supabaseClient
    .from('place_external_aggregates')
    .select('*')
    .eq('source', 'google');
  if (error) {
    console.error('[loadExternalAggregates] read failed:', error);
    return _externalAggregates; // keep last known cache on error
  }
  _externalAggregates = {};
  for (const row of data || []) {
    _externalAggregates[row.place_id] = {
      rating:      row.rating != null ? Number(row.rating) : null,
      ratingCount: row.rating_count,
      priceLevel:  row.price_level,
      expiresAt:   new Date(row.expires_at).getTime()
    };
  }
  return _externalAggregates;
}

// Accessor used by the adapter when assembling allPlaces.
function getExternalAggregate(placeUuid) {
  return _externalAggregates[placeUuid] || null;
}


// ── REFRESH PATH ─────────────────────────────────
// Fire-and-forget: called by loadPlaces() after the first render, so a slow
// Google response never blocks the cards from appearing.
async function refreshExternalAggregates(places) {
  if (_refreshRunning) return;            // one refresh pass per page load
  _refreshRunning = true;

  try {
    const now = Date.now();
    const stale = Object.values(places).filter(p =>
      p.googlePlaceId &&
      (!_externalAggregates[p.id] || _externalAggregates[p.id].expiresAt < now)
    );
    if (!stale.length) return;

    // Wait for the Google Maps script (loaded async by map.js).
    if (typeof google === 'undefined' || !google.maps?.importLibrary) {
      console.warn('[refreshExternalAggregates] Google Maps not ready; skipping this load.');
      return;
    }
    const { Place } = await google.maps.importLibrary('places');

    let updated = 0;
    for (const p of stale) {
      try {
        const place = new Place({ id: p.googlePlaceId });
        await place.fetchFields({ fields: ['rating', 'userRatingCount', 'priceLevel'] });

        const expires = new Date(now + EXTERNAL_AGG_TTL_DAYS * 24 * 60 * 60 * 1000);
        const row = {
          place_id:     p.id,
          source:       'google',
          rating:       place.rating ?? null,
          rating_count: place.userRatingCount ?? null,
          price_level:  _PRICE_LEVEL_TO_INT[place.priceLevel] ?? null,
          fetched_at:   new Date(now).toISOString(),
          expires_at:   expires.toISOString()
        };
        const { error } = await supabaseClient
          .from('place_external_aggregates')
          .upsert(row, { onConflict: 'place_id,source' });
        if (error) { console.error('[refreshExternalAggregates] upsert failed:', error); continue; }

        _externalAggregates[p.id] = {
          rating:      row.rating,
          ratingCount: row.rating_count,
          priceLevel:  row.price_level,
          expiresAt:   expires.getTime()
        };
        // IMPORTANT: update the *global* allPlaces, not the `places` argument.
        // loadPlaces() can run more than once during login (Supabase fires
        // multiple auth events) and each run REPLACES allPlaces with a new
        // object.  Mutating the captured argument would update an orphaned
        // copy nobody renders from.
        if (allPlaces[p.id]) allPlaces[p.id].external = _externalAggregates[p.id];
        updated++;
      } catch (err) {
        // One bad place (e.g. retired place id) shouldn't kill the pass.
        console.warn(`[refreshExternalAggregates] ${p.name} failed:`, err);
      }
      // Stagger requests: be a polite API citizen even at small scale.
      await new Promise(r => setTimeout(r, 300));
    }

    // Re-render once at the end so freshly fetched ratings appear.
    if (updated > 0 &&
        document.getElementById('list-map-section').style.display !== 'none' &&
        currentDisplayMode !== 'map') {
      renderCards();
    }
    console.log(`[refreshExternalAggregates] refreshed ${updated}/${stale.length} place(s).`);
  } finally {
    _refreshRunning = false;
  }
}
