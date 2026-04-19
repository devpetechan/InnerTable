// ══════════════════════════════════════════════════
//  SUPABASE DATA SERVICE
//  Replaces the old firebase.js + all db.ref() calls.
//
//  HOW IT WORKS (overview for learning):
//  ─────────────────────────────────────
//  Firebase Realtime Database is a live JSON tree — every client subscribes to
//  a path and Firebase pushes updates automatically.
//
//  Supabase stores data in normal SQL tables.  To get the same "live update"
//  behaviour we use two Supabase features:
//    1. Regular queries (SELECT) to load data on demand.
//    2. Supabase Realtime — a WebSocket channel that fires when any row in a
//       subscribed table changes.  When we get a change event we re-fetch
//       everything and re-render.
//
//  The fetchAllRecs() function runs four queries, then stitches the results
//  into the same `allRecs` object shape that ui-render.js already expects.
//  This "adapter" pattern means ui-render.js needs zero changes.
// ══════════════════════════════════════════════════


// ── Module-private state ─────────────────────────
let _userIdToName    = {};   // { uuid: displayName } — built fresh each fetch
let _realtimeChannel = null; // Supabase Realtime channel (set up once)
let _debounceTimer   = null; // prevents a burst of change events from causing
                             // multiple back-to-back re-fetches


// ══════════════════════════════════════════════════
//  DATA LOADING & REALTIME
// ══════════════════════════════════════════════════

// fetchAllRecs: runs 5 parallel-ish queries and assembles allRecs
async function fetchAllRecs() {
  // 1. All user profiles — needed to turn UUIDs into display names
  const { data: users } = await supabaseClient
    .from('users').select('id, display_name');
  _userIdToName = {};
  (users || []).forEach(u => { _userIdToName[u.id] = u.display_name; });

  // 2. Recommendations (newest first)
  const { data: recs, error: recsErr } = await supabaseClient
    .from('recommendations')
    .select('*')
    .order('created_at', { ascending: false });
  if (recsErr) {
    console.error('[fetchAllRecs] recommendations query failed:', recsErr);
    return {};
  }

  // 3. Votes
  const { data: votes } = await supabaseClient
    .from('votes').select('*');

  // 4. Comments (oldest first so thread order is correct)
  const { data: comments } = await supabaseClient
    .from('comments')
    .select('*')
    .order('created_at', { ascending: true });

  // 5. Per-user interactions (status / tried / ratings)
  const { data: interactions } = await supabaseClient
    .from('user_rec_interactions').select('*');

  // ── Build result object, keyed by recommendation UUID ──────────────────
  const result = {};

  for (const rec of recs || []) {
    result[rec.id] = {
      // Map snake_case Supabase columns → camelCase Firebase-compatible shape
      name:          rec.name,
      author:        _userIdToName[rec.author_id] || rec.author_id,
      ts:            new Date(rec.created_at).getTime(),  // ms since epoch (matches Firebase)
      status:        rec.status,
      rating:        rec.rating,
      cuisine:       rec.cuisine,
      price:         rec.price,
      notes:         rec.notes,
      tryNote:       rec.try_note,
      url:           rec.url,
      location:      rec.location,
      lat:           rec.lat,
      lng:           rec.lng,
      placeId:       rec.google_place_id,
      placeType:     rec.place_type || 'restaurant',
      factorRatings: rec.factor_ratings || null,
      // Sub-collections — populated in the loops below
      votes:         {},
      comments:      {},
      userStatuses:  {},
      userRatings:   {},
      triedBy:       {}
    };
  }

  // ── Attach votes ─────────────────────────────────
  // votes table: { recommendation_id, user_id, value: 'up'|'down' }
  for (const v of votes || []) {
    const rec = result[v.recommendation_id];
    if (rec) {
      rec.votes[_userIdToName[v.user_id] || v.user_id] = v.value;
    }
  }

  // ── Attach comments ───────────────────────────────
  // comments table: { id, recommendation_id, author_id, text, deleted, reactions }
  // reactions JSONB shape in DB:  { "emoji": { "user_uuid": true } }
  // adapter output shape:         { "emoji": { "DisplayName": true } }
  for (const c of comments || []) {
    const rec = result[c.recommendation_id];
    if (!rec) continue;

    // Map user UUIDs → display names inside reactions
    const adaptedReactions = {};
    if (c.reactions) {
      for (const [emoji, voters] of Object.entries(c.reactions)) {
        adaptedReactions[emoji] = {};
        for (const [uid, val] of Object.entries(voters || {})) {
          if (val) adaptedReactions[emoji][_userIdToName[uid] || uid] = true;
        }
      }
    }

    rec.comments[c.id] = {
      author:    _userIdToName[c.author_id] || c.author_id,
      text:      c.text,
      ts:        new Date(c.created_at).getTime(),
      deleted:   c.deleted,
      reactions: adaptedReactions
    };
  }

  // ── Attach user interactions ──────────────────────
  // user_rec_interactions: { recommendation_id, user_id, status, tried,
  //                          rating_overall, rating_quality, … }
  for (const ix of interactions || []) {
    const rec = result[ix.recommendation_id];
    if (!rec) continue;
    const name = _userIdToName[ix.user_id] || ix.user_id;

    if (ix.status) {
      rec.userStatuses[name] = { status: ix.status, ts: new Date(ix.ts).getTime() };
    }
    if (ix.tried) {
      rec.triedBy[name] = true;
    }
    if (ix.rating_overall) {
      rec.userRatings[name] = {
        overall:  ix.rating_overall,
        quality:  ix.rating_quality  || 0,
        service:  ix.rating_service  || 0,
        value:    ix.rating_value    || 0,
        ambiance: ix.rating_ambiance || 0
      };
    }
  }

  return result;
}

// loadRecs: entry-point called by auth.js → showApp()
// Fetches all data and sets up the Realtime subscription.
async function loadRecs() {
  allRecs = await fetchAllRecs();

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
  // We subscribe to all four tables.  Any INSERT / UPDATE / DELETE in any of
  // them triggers a debounced re-fetch + re-render.
  if (_realtimeChannel) return;
  _realtimeChannel = supabaseClient
    .channel('inner-table-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recommendations' },        _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' },               _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' },                  _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_rec_interactions' },  _onDbChange)
    .subscribe();
}

// _onDbChange: debounced handler for any table change
// "Debounce" means: if 3 changes arrive within 200 ms, we only re-fetch once
// (after the last one), instead of 3 times in a row.
function _onDbChange() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(async () => {
    allRecs = await fetchAllRecs();
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
//  VOTING
// ══════════════════════════════════════════════════
async function castVote(id, direction) {
  // If the user already voted this direction → toggle off (delete the vote row)
  const existing = allRecs[id]?.votes?.[currentUser.display_name];
  const newVote  = existing === direction ? null : direction;

  if (newVote === null) {
    const { error } = await supabaseClient.from('votes').delete()
      .eq('recommendation_id', id)
      .eq('user_id', currentUser.id);
    if (error) { console.error(error); showToast('❌ Could not save vote.'); }
  } else {
    // upsert: insert if no row exists, update if one does
    const { error } = await supabaseClient.from('votes').upsert(
      { recommendation_id: id, user_id: currentUser.id, value: newVote },
      { onConflict: 'recommendation_id,user_id' }
    );
    if (error) { console.error(error); showToast('❌ Could not save vote.'); }
  }
}


// ══════════════════════════════════════════════════
//  SUBMIT (new entry or edit)
// ══════════════════════════════════════════════════
async function submitRec() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { shake(document.getElementById('f-name')); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  // ── Determine status values (same logic as before) ──────────────────
  const isTryType  = (addType === 'try'  || addType === 'want-to-go');
  const isBeenType = (addType === 'been' || addType === 'been-recommend' || addType === 'been-skip');

  let topStatus;
  if (addType === 'been-skip') topStatus = 'not-recommended';
  else if (isTryType)          topStatus = 'try';
  else                         topStatus = 'recommended';

  let userStatusValue;
  if (addType === 'want-to-go' || addType === 'try') userStatusValue = 'want-to-go';
  else if (addType === 'been-skip')                  userStatusValue = 'been-skip';
  else                                               userStatusValue = 'been-recommend';

  // ── Build the recommendation row (Supabase column names are snake_case) ──
  const recRow = {
    name,
    place_type: placeType,
    location:   document.getElementById('f-location').value.trim(),
    status:     topStatus
  };

  if (selectedPlaceLat !== null) { recRow.lat = selectedPlaceLat; recRow.lng = selectedPlaceLng; }
  if (selectedPlaceId)           recRow.google_place_id = selectedPlaceId;

  if (isTryType) {
    recRow.try_note = document.getElementById('f-try-note').value.trim();
    recRow.url      = document.getElementById('f-url').value.trim();
  } else {
    recRow.cuisine = document.getElementById('f-cuisine').value;
    recRow.price   = document.getElementById('f-price').value;
    recRow.notes   = document.getElementById('f-notes').value.trim();
    recRow.rating  = selectedStars || null;
    const anyRated = Object.values(factorRatings).some(v => v > 0);
    if (anyRated) recRow.factor_ratings = { ...factorRatings };
    else if (addType === 'been') {
      document.getElementById('factor-hint').style.display = 'block';
    }
  }

  // ── Write to Supabase ────────────────────────────
  let recId;
  try {
    if (editingId) {
      // Edit: preserve original coordinates / placeId if user didn't re-select
      const orig = allRecs[editingId];
      if (orig) {
        if (orig.lat && recRow.lat === undefined) { recRow.lat = orig.lat; recRow.lng = orig.lng; }
        if (orig.placeId && !recRow.google_place_id) recRow.google_place_id = orig.placeId;
      }
      // RLS only allows the original author to UPDATE
      const { error } = await supabaseClient.from('recommendations')
        .update(recRow).eq('id', editingId);
      if (error) throw error;
      recId = editingId;

    } else {
      // New entry — include author_id
      recRow.author_id = currentUser.id;
      const { data, error } = await supabaseClient.from('recommendations')
        .insert(recRow).select('id').single();
      if (error) throw error;
      recId = data.id;
    }
  } catch (err) {
    console.error('[submitRec] write failed:', err);
    showToast('❌ Error saving: ' + (err.message || err.code || err));
    btn.disabled = false; btn.textContent = 'Save';
    return;
  }

  // ── Write user interaction row (status / ratings) ────────────────────
  if (isTryType || beenStatusChosen) {
    const ix = { status: userStatusValue };
    if (isBeenType) ix.tried = true;
    if (isBeenType && selectedStars > 0) {
      ix.rating_overall = selectedStars;
      const { quality, service, value, ambiance } = factorRatings;
      if (quality)  ix.rating_quality  = quality;
      if (service)  ix.rating_service  = service;
      if (value)    ix.rating_value    = value;
      if (ambiance) ix.rating_ambiance = ambiance;
    }
    await _upsertInteraction(recId, ix);
  }

  console.log('[submitRec] write succeeded, recId:', recId);
  const toastMsg = isTryType ? '📌 Saved to your list!'
    : addType === 'been-skip' ? '🚫 Hard Pass noted!'
    : '🎉 Review saved!';
  showToast(toastMsg);
  closeModal();
  btn.disabled = false; btn.textContent = 'Save';
}


// ══════════════════════════════════════════════════
//  DELETE
// ══════════════════════════════════════════════════
async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('recommendations').delete().eq('id', id);
  if (error) { console.error(error); showToast('❌ Could not delete.'); return; }
  showToast('🗑 Entry deleted.');
}


// ══════════════════════════════════════════════════
//  MARK AS TRIED + USER RATINGS
// ══════════════════════════════════════════════════
async function markAsTried(id) {
  const { error } = await _upsertInteraction(id, { tried: true });
  if (error) { console.error(error); showToast('❌ Could not save.'); return; }
  showToast('✅ Marked as tried!');
  toggleRatingForm(id);
}

function toggleRatingForm(id) {
  // Pre-fill the rating form with any existing data for this user
  if (!pendingUserRatings[id]) {
    const r = allRecs[id];
    const existing       = r && r.userRatings  && r.userRatings[currentUser.display_name];
    const existingStatus = r && r.userStatuses && r.userStatuses[currentUser.display_name];
    pendingUserRatings[id] = existing
      ? { overall: existing.overall||0, quality: existing.quality||0, service: existing.service||0, value: existing.value||0, ambiance: existing.ambiance||0 }
      : { overall: 0, quality: 0, service: 0, value: 0, ambiance: 0 };
    if (existingStatus) pendingUserRatings[id].visitStatus = existingStatus.status;
  }
  const form = document.getElementById('rf-' + id);
  if (!form) return;
  const opening = form.style.display === 'none';
  form.style.display = opening ? 'block' : 'none';
  if (opening) {
    renderUserRatingStars(id);
    const vs    = pendingUserRatings[id].visitStatus;
    const gnBtn = document.getElementById('vs-gn-' + id);
    const hpBtn = document.getElementById('vs-hp-' + id);
    if (gnBtn) gnBtn.classList.toggle('active', vs === 'been-recommend');
    if (hpBtn) hpBtn.classList.toggle('active', vs === 'been-skip');
    const saveBtn = document.getElementById('ur-save-' + id);
    if (saveBtn) saveBtn.disabled = !(pendingUserRatings[id].overall > 0);
  }
}

function renderUserRatingStars(id) {
  const state = pendingUserRatings[id];
  if (!state) return;
  const starsEl = document.getElementById('ur-stars-' + id);
  if (starsEl) starsEl.querySelectorAll('span').forEach((s,i) => { s.textContent = i < state.overall ? '★' : '☆'; });
  ['quality','service','value','ambiance'].forEach(f => {
    const el = document.getElementById(`ur-${f}-${id}`);
    if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < (state[f]||0) ? '★' : '☆'; });
  });
}

function setVisitStatus(id, status) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  const gnBtn = document.getElementById('vs-gn-' + id);
  const hpBtn = document.getElementById('vs-hp-' + id);
  if (pendingUserRatings[id].visitStatus === status) {
    pendingUserRatings[id].visitStatus = null;
    if (gnBtn) gnBtn.classList.remove('active');
    if (hpBtn) hpBtn.classList.remove('active');
  } else {
    pendingUserRatings[id].visitStatus = status;
    if (gnBtn) gnBtn.classList.toggle('active', status === 'been-recommend');
    if (hpBtn) hpBtn.classList.toggle('active', status === 'been-skip');
  }
}

function setUserRatingStar(id, n) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  pendingUserRatings[id].overall = n;
  const el = document.getElementById('ur-stars-' + id);
  if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
  const saveBtn = document.getElementById('ur-save-' + id);
  if (saveBtn) saveBtn.disabled = (n === 0);
}

function setUserFactorStar(id, factor, n) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  pendingUserRatings[id][factor] = n;
  const el = document.getElementById(`ur-${factor}-${id}`);
  if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

async function submitUserRating(id) {
  const state = pendingUserRatings[id] || { overall:0, quality:0, service:0, value:0, ambiance:0 };
  if (!state.overall || state.overall < 1) {
    showToast('Please select an overall star rating.');
    return;
  }

  const ix = {
    tried:           true,
    rating_overall:  state.overall,
    rating_quality:  state.quality  || 0,
    rating_service:  state.service  || 0,
    rating_value:    state.value    || 0,
    rating_ambiance: state.ambiance || 0
  };

  // visitStatus can be: a string (explicit choice), null (user toggled off),
  // or undefined (user never touched the toggle — don't change it in the DB)
  if (state.visitStatus !== undefined) {
    ix.status = state.visitStatus; // null clears the status column
  }

  const { error } = await _upsertInteraction(id, ix);
  if (error) { console.error(error); showToast('❌ Could not save.'); return; }

  const toast = state.visitStatus === 'been-recommend' ? '✓ Go Now saved!'
              : state.visitStatus === 'been-skip'      ? '🚫 Hard Pass saved!'
              : '⭐ Rating saved!';
  showToast(toast);
  delete pendingUserRatings[id];
  const form = document.getElementById('rf-' + id);
  if (form) form.style.display = 'none';
}


// ══════════════════════════════════════════════════
//  DUPLICATE DETECTION
// ══════════════════════════════════════════════════
async function checkForDuplicate(placeId, placeName) {
  if (!placeId) return;

  const { data, error } = await supabaseClient
    .from('recommendations')
    .select('id, name, author_id')
    .eq('google_place_id', placeId)
    .limit(1);

  if (error || !data || !data.length) return;

  const existing          = data[0];
  const existingAuthorName = _userIdToName[existing.author_id] || existing.author_id;
  pendingDupId    = existing.id;
  pendingDupIsOwn = existing.author_id === currentUser.id;

  if (pendingDupIsOwn) {
    document.getElementById('dup-message').textContent =
      `You already added "${existing.name}" to InnerTable. Would you like to edit your existing entry?`;
    document.getElementById('dup-primary-btn').textContent = 'Yes, edit my existing entry';
  } else {
    document.getElementById('dup-message').textContent =
      `"${existing.name}" is already on InnerTable (added by ${existingAuthorName}). Would you like to add your status to the existing entry instead?`;
    document.getElementById('dup-primary-btn').textContent = 'Yes, add my status to the existing entry';
  }

  document.getElementById('dup-overlay').classList.add('open');
}

function closeDupOnBg(e) {
  if (e.target === document.getElementById('dup-overlay')) closeDupPrompt();
}

function closeDupPrompt() {
  document.getElementById('dup-overlay').classList.remove('open');
  pendingDupId    = null;
  pendingDupIsOwn = false;
}

function closeDupPromptAndContinue() {
  document.getElementById('dup-overlay').classList.remove('open');
  pendingDupId    = null;
  pendingDupIsOwn = false;
}

function confirmDup() {
  if (pendingDupIsOwn) {
    const targetId = pendingDupId;
    pendingDupId    = null;
    pendingDupIsOwn = false;
    document.getElementById('dup-overlay').classList.remove('open');
    closeModal();
    editEntry(targetId);
  } else {
    confirmAttach();
  }
}

function confirmAttach() {
  if (!pendingDupId) return;
  const targetId = pendingDupId;
  pendingDupId   = null;
  document.getElementById('dup-overlay').classList.remove('open');

  const r = allRecs[targetId];
  closeModal(); // resets form state; we re-set attachingToId below
  attachingToId = targetId;

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-title').textContent   = 'Add Your Status';
  document.getElementById('type-step').style.display   = 'none';
  document.getElementById('form-step').style.display   = 'none';
  document.getElementById('attach-step').style.display = 'block';
  document.getElementById('attach-place-name').textContent = r ? r.name : '';

  attachStatus        = null;
  attachStars         = 0;
  attachFactorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
  document.getElementById('attach-submit-btn').disabled       = true;
  document.getElementById('attach-rating-section').style.display = 'none';
  document.getElementById('atc-been').classList.remove('active');
  document.getElementById('atc-try').classList.remove('active');
  document.getElementById('abtn-go-now').classList.remove('active');
  document.getElementById('abtn-hard-pass').classList.remove('active');
  resetAttachStars();
  document.querySelector('.modal').scrollTop = 0;
}


// ══════════════════════════════════════════════════
//  ATTACH FORM CONTROLS
// ══════════════════════════════════════════════════
function setAttachStatus(status) {
  attachStatus = status;
  const isBeen = (status === 'been-recommend' || status === 'been-skip');
  document.getElementById('attach-rating-section').style.display = isBeen ? 'block' : 'none';
  document.getElementById('attach-submit-btn').disabled = false;
}

function setAttachStars(n) {
  attachStars = n;
  document.querySelectorAll('#attach-star-picker span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
  const btn = document.getElementById('attach-submit-btn');
  if (btn) btn.disabled = (n === 0);
}

function setAttachFactorStar(factor, n) {
  attachFactorRatings[factor] = n;
  document.querySelectorAll(`#afp-${factor} span`).forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

function resetAttachStars() {
  attachStars = 0;
  document.querySelectorAll('#attach-star-picker span').forEach(s => { s.textContent = '☆'; });
  attachFactorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
  ['quality','service','value','ambiance'].forEach(f => {
    document.querySelectorAll(`#afp-${f} span`).forEach(s => { s.textContent = '☆'; });
  });
}

async function submitAttach() {
  if (!attachingToId) return;

  const isBeen = document.getElementById('atc-been')?.classList.contains('active');

  if (isBeen && attachStars === 0) {
    showToast('Please select an overall star rating.');
    return;
  }

  const btn = document.getElementById('attach-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const ix = {};
  if (attachStatus) {
    ix.status = attachStatus;
    ix.tried  = true;
  } else if (isBeen) {
    ix.tried = true;
  } else {
    ix.status = 'want-to-go';
  }

  if (isBeen && attachStars > 0) {
    ix.rating_overall = attachStars;
    const { quality, service, value, ambiance } = attachFactorRatings;
    if (quality)  ix.rating_quality  = quality;
    if (service)  ix.rating_service  = service;
    if (value)    ix.rating_value    = value;
    if (ambiance) ix.rating_ambiance = ambiance;
  }

  const { error } = await _upsertInteraction(attachingToId, ix);
  if (error) {
    console.error(error);
    showToast('❌ Could not save status.');
    btn.disabled = false; btn.textContent = 'Save My Status';
    return;
  }

  const toastMsg = attachStatus === 'been-recommend' ? '✓ Go Now saved!'
                 : attachStatus === 'been-skip'      ? '🚫 Hard Pass noted!'
                 : isBeen                            ? '⭐ Rating saved!'
                 : '📌 Want-to-go saved!';
  showToast(toastMsg);
  closeModal();
  btn.disabled = false; btn.textContent = 'Save My Status';
}


// ══════════════════════════════════════════════════
//  SHARED HELPER
// ══════════════════════════════════════════════════

// _upsertInteraction: insert or update the current user's row in
// user_rec_interactions.  Only the fields present in `fields` are written;
// anything omitted is left unchanged on update.
async function _upsertInteraction(recId, fields) {
  return supabaseClient.from('user_rec_interactions').upsert(
    { recommendation_id: recId, user_id: currentUser.id, ...fields },
    { onConflict: 'recommendation_id,user_id' }
  );
}
