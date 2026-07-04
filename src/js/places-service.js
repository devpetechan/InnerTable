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
// allPlaces is the single client-side cache of place data (replaced the legacy allRecs).
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

  // 5b. External aggregates cache (IT-056) — Google ratings, read from our
  //     own table, never the live Google API.
  await loadExternalAggregates();

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
      aggregate:     { avgRating: 0, ratingsCount: 0, recommends: [], hardPasses: [], wantsToGo: [], triedBy: [] },
      // Google's aggregate from our cache table (null until first refresh).
      external:      getExternalAggregate(p.id)
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

  // IT-056: refresh any missing/expired Google ratings in the background.
  // Deliberately not awaited — cards render immediately from the cache and
  // re-render once fresh data lands.
  refreshExternalAggregates(allPlaces);

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


// ══════════════════════════════════════════════════
//  WRITE PATH (IT-036)
//  submitEntry() = place resolution + entry upsert.  A place that already
//  exists (matched by google_place_id or chosen via "Add your take") gets
//  your entry attached silently — no duplicate-prompt modal.
// ══════════════════════════════════════════════════

// Map the modal's addType to the entries.status CHECK values.
// NOTE: the DB stores want-to-go as 'try' (migration 0008); the adapter
// normalizes it to 'want-to-go' on read.
function computeUserStatus(type) {
  if (type === 'try' || type === 'want-to-go') return 'try';
  if (type === 'been-skip') return 'been-skip';
  return 'been-recommend';
}

// Resolve the place row for this submission and return its id.
//   - editing / adding a take on a known place → use the stored place id
//   - Google-selected place → find by google_place_id, insert if new
//   - free-text place → always insert
// Places are never UPDATEd here: metadata is locked after creation
// (resolved decision #1; the tags system in IT-083 replaces edits), and
// RLS on places only grants SELECT + INSERT anyway.
async function _resolvePlaceId(placeRow) {
  if (editingPlaceId)  return editingPlaceId;
  if (addingToPlaceId) return addingToPlaceId;

  if (selectedPlaceId) {
    placeRow.google_place_id = selectedPlaceId;
    const { data: existing, error: findErr } = await supabaseClient
      .from('places').select('id')
      .eq('google_place_id', selectedPlaceId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing) return existing.id;   // silent attach — no modal
  }

  const { data, error } = await supabaseClient
    .from('places').insert(placeRow).select('id').single();
  if (error) {
    // 23505 = unique violation on google_place_id: someone inserted the same
    // place between our select and insert.  Re-select and attach to theirs.
    if (error.code === '23505' && placeRow.google_place_id) {
      const { data: raced } = await supabaseClient
        .from('places').select('id')
        .eq('google_place_id', placeRow.google_place_id)
        .single();
      if (raced) return raced.id;
    }
    throw error;
  }
  return data.id;
}

async function submitEntry() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { shake(document.getElementById('f-name')); return; }
  if (!addType) return; // submit button is disabled until an experience is chosen

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  // ── Place row (venue data, not user data) ──
  // created_by is required by the places INSERT policy (WITH CHECK).
  const placeRow = {
    name,
    place_type: placeType,
    location:   document.getElementById('f-location').value.trim() || null,
    cuisine:    document.getElementById('f-cuisine').value         || null,
    price:      document.getElementById('f-price').value           || null,
    lat:        selectedPlaceLat,
    lng:        selectedPlaceLng,
    created_by: currentUser.id
  };

  let placeId;
  try {
    placeId = await _resolvePlaceId(placeRow);
  } catch (err) {
    console.error('[submitEntry] place resolution failed:', err);
    showToast('❌ Could not save the place.');
    btn.disabled = false; btn.textContent = 'Save';
    return;
  }

  // ── Entry row (the user's take) ──
  // Rating columns are always written explicitly (null = not rated) so an
  // edit that clears a rating actually clears it under upsert semantics.
  const isTryType = (addType === 'try' || addType === 'want-to-go');
  const entryRow = {
    user_id:  currentUser.id,
    place_id: placeId,
    status:   computeUserStatus(addType),
    notes:    document.getElementById('f-notes').value.trim()    || null,
    try_note: document.getElementById('f-try-note').value.trim() || null,
    url:      document.getElementById('f-url').value.trim()      || null,
    overall_rating: null, quality: null, service: null, value: null, ambiance: null
  };

  if (!isTryType && selectedStars > 0) {
    entryRow.overall_rating = selectedStars;
    entryRow.quality  = factorRatings.quality  || null;
    entryRow.service  = factorRatings.service  || null;
    entryRow.value    = factorRatings.value    || null;
    entryRow.ambiance = factorRatings.ambiance || null;
  }

  const { error: entryErr } = await supabaseClient
    .from('entries').upsert(entryRow, { onConflict: 'user_id,place_id' });
  if (entryErr) {
    console.error('[submitEntry] entry write failed:', entryErr);
    showToast('❌ Could not save your entry.');
    btn.disabled = false; btn.textContent = 'Save';
    return;
  }

  const toastMsg = isTryType ? '📌 Saved to your list!'
    : addType === 'been-skip' ? '🚫 Hard Pass noted!'
    : '🎉 Review saved!';
  showToast(toastMsg);
  closeModal();
  btn.disabled = false; btn.textContent = 'Save';
  // Realtime triggers the re-fetch + re-render.
}


// ══════════════════════════════════════════════════
//  DELETE — removes *my entry* on a place, never the place itself.
//  The place card stays visible with everyone else's takes.
// ══════════════════════════════════════════════════
async function deleteEntry(entryId) {
  if (!confirm('Delete your take on this place? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('entries').delete().eq('id', entryId);
  if (error) { console.error(error); showToast('❌ Could not delete.'); return; }
  showToast('🗑 Your take was deleted.');
}

