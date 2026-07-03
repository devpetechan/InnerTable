// ══════════════════════════════════════════════════
//  SUPABASE DATA SERVICE (IT-035 place-centric adapter)
//
//  HOW IT WORKS (overview for learning):
//  ─────────────────────────────────────
//  Supabase stores data in normal SQL tables.  To get "live update"
//  behaviour we use two Supabase features:
//    1. Regular queries (SELECT) to load data on demand.
//    2. Supabase Realtime — a WebSocket channel that fires when any row in a
//       subscribed table changes.  When we get a change event we re-fetch
//       everything and re-render.
//
//  fetchAllPlaces() runs five queries and stitches the results into the
//  `allPlaces` object: one entry per *place*, each carrying the takes
//  (entries) friends have on it, the shared per-place comment thread, and
//  pre-computed aggregates.  The renderer (Phase 3) consumes this shape.
// ══════════════════════════════════════════════════


// ── Global state ─────────────────────────────────
// allPlaces replaces the legacy allRecs (still declared in app.js until the
// Phase 3/4 rewrites remove the last readers of it).
let allPlaces = {};


// ── Module-private state ─────────────────────────
let _userIdToName    = {};   // { uuid: displayName } — built fresh each fetch
let _realtimeChannel = null; // Supabase Realtime channel (set up once)
let _debounceTimer   = null; // prevents a burst of change events from causing
                             // multiple back-to-back re-fetches


// ══════════════════════════════════════════════════
//  DATA LOADING & REALTIME
// ══════════════════════════════════════════════════

// fetchAllPlaces: runs 5 queries and assembles allPlaces, keyed by place uuid.
async function fetchAllPlaces() {
  // 1. Users (uuid → display_name lookup)
  const { data: users } = await supabaseClient
    .from('users').select('id, display_name');
  _userIdToName = {};
  (users || []).forEach(u => { _userIdToName[u.id] = u.display_name; });

  // 2. All places
  const { data: places, error: placesErr } = await supabaseClient
    .from('places').select('*').order('name');
  if (placesErr) {
    console.error('[fetchAllPlaces] places query failed:', placesErr);
    return {};
  }

  // 3. All entries (each user's take on a place)
  const { data: entries } = await supabaseClient
    .from('entries').select('*').order('created_at', { ascending: false });

  // 4. Comments — place-keyed since migration 0010, with quote-reply columns
  const { data: comments } = await supabaseClient
    .from('comments').select('*').order('created_at', { ascending: true });

  // 5. Reactions — one row per (comment, user, emoji)
  const { data: reactionRows } = await supabaseClient
    .from('comment_reactions').select('*');

  // 6. Build the result skeleton, keyed by place uuid
  const result = {};
  for (const p of places || []) {
    result[p.id] = {
      id:            p.id,
      name:          p.name,
      cuisine:       p.cuisine,
      price:         p.price,
      location:      p.location,
      lat:           p.lat,
      lng:           p.lng,
      googlePlaceId: p.google_place_id,
      placeType:     p.place_type || 'restaurant',
      takes:         [],
      comments:      [],
      aggregate:     { avgRating: 0, ratingsCount: 0, recommends: [], hardPasses: [], wantsToGo: [], triedBy: [] }
    };
  }

  // 7. Attach takes
  for (const e of entries || []) {
    const place = result[e.place_id];
    if (!place) continue;
    place.takes.push({
      entryId:       e.id,
      userId:        e.user_id,
      author:        _userIdToName[e.user_id] || e.user_id,
      ts:            new Date(e.created_at).getTime(),
      // DB stores want-to-go takes as 'try' (CHECK constraint, migration
      // 0008); the IT-035 shape uses 'want-to-go'.  Normalize here so the
      // renderer only ever sees 'want-to-go' | 'been-recommend' | 'been-skip'.
      status:        e.status === 'try' ? 'want-to-go' : e.status,
      // NOTE: the plan's reference code reads e.rating_overall / e.rating_*,
      // but entries (migration 0008) actually uses overall_rating + bare
      // factor names — no migration ever renamed them.
      rating:        e.overall_rating || 0,
      factorRatings: {
        quality:  e.quality  || 0,
        service:  e.service  || 0,
        value:    e.value    || 0,
        ambiance: e.ambiance || 0
      },
      notes:    e.notes    || '',
      tryNote:  e.try_note || '',
      url:      e.url      || ''
    });
  }

  // 8. Bucket reactions by comment_id (jsonb-shape compatible with existing render)
  const reactionsByComment = {};
  for (const r of reactionRows || []) {
    if (!reactionsByComment[r.comment_id]) reactionsByComment[r.comment_id] = {};
    if (!reactionsByComment[r.comment_id][r.emoji]) reactionsByComment[r.comment_id][r.emoji] = {};
    reactionsByComment[r.comment_id][r.emoji][_userIdToName[r.user_id] || r.user_id] = true;
  }

  // 9. Attach comments (one shared thread per place)
  for (const c of comments || []) {
    const place = result[c.place_id];
    if (!place) continue;
    place.comments.push({
      id:               c.id,
      author:           _userIdToName[c.author_id] || c.author_id,
      authorId:         c.author_id,
      text:             c.text || '',
      ts:               new Date(c.created_at).getTime(),
      deleted:          c.deleted_at !== null && c.deleted_at !== undefined,
      reactions:        reactionsByComment[c.id] || {},
      quotedCommentId:  c.quoted_comment_id,
      quotedAuthor:     c.quoted_author,
      quotedText:       c.quoted_text,
      mentions:         parseMentions(c.text || '')
    });
  }

  // 10. Compute aggregates per place
  for (const place of Object.values(result)) {
    let total = 0, count = 0;
    for (const t of place.takes) {
      if (t.status === 'been-recommend') place.aggregate.recommends.push(t.author);
      if (t.status === 'been-skip')      place.aggregate.hardPasses.push(t.author);
      if (t.status === 'want-to-go')     place.aggregate.wantsToGo.push(t.author);
      if (t.status === 'been-recommend' || t.status === 'been-skip') place.aggregate.triedBy.push(t.author);
      if (t.rating > 0) { total += t.rating; count++; }
    }
    place.aggregate.avgRating    = count > 0 ? total / count : 0;
    place.aggregate.ratingsCount = count;
  }

  return result;
}

// Helper: parse @mentions out of comment text into a list of display names.
// Matches @Alice, @alice_b, @Bob-Smith. Stops at whitespace or punctuation.
function parseMentions(text) {
  const matches = text.match(/@([a-zA-Z0-9_-]+)/g) || [];
  return matches.map(m => m.slice(1));
}

// loadPlaces: entry-point called by auth.js → showApp()
// Fetches all data and sets up the Realtime subscription.
async function loadPlaces() {
  allPlaces = await fetchAllPlaces();

  // Re-render if the list is currently visible
  if (document.getElementById('list-map-section').style.display !== 'none') {
    if (currentDisplayMode === 'map' && mapInstance) {
      renderMapMarkers();
    } else {
      renderCards();
    }
  }
  updateFriendFilters();

  // ── Set up Realtime subscription (once per session) ──
  // Any INSERT / UPDATE / DELETE in any of the four tables triggers a
  // debounced re-fetch + re-render.
  if (_realtimeChannel) return;
  _realtimeChannel = supabaseClient
    .channel('inner-table-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places'            }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries'           }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments'          }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_reactions' }, _onDbChange)
    .subscribe();
}

// _onDbChange: debounced handler for any table change
// "Debounce" means: if 3 changes arrive within 200 ms, we only re-fetch once
// (after the last one), instead of 3 times in a row.
function _onDbChange() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(async () => {
    allPlaces = await fetchAllPlaces();
    if (document.getElementById('list-map-section').style.display !== 'none') {
      if (currentDisplayMode === 'map' && mapInstance) {
        renderMapMarkers();
      } else {
        renderCards();
      }
    }
    updateFriendFilters();
  }, 200);
}

