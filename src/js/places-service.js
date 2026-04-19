// ══════════════════════════════════════════════════
//  FIREBASE
// ══════════════════════════════════════════════════
function loadRecs() {
  db.ref('recommendations').on('value', snap => {
    allRecs = snap.val() || {};
    // Only re-render if the list section is visible
    if (document.getElementById('list-map-section').style.display !== 'none') {
      if (currentDisplayMode === 'map' && mapInstance) {
        renderMapMarkers();
      } else {
        renderCards();
      }
    }
    updateFriendFilters();
  });
}

// ══════════════════════════════════════════════════

//  VOTING
// ══════════════════════════════════════════════════
function castVote(id, direction) {
  const existing = allRecs[id] && allRecs[id].votes ? allRecs[id].votes[currentUser.display_name] : null;
  // Toggle off if clicking the same direction again
  const newVote = existing === direction ? null : direction;
  const update = {};
  update[`recommendations/${id}/votes/${currentUser.display_name}`] = newVote;
  db.ref().update(update).catch(err => {
    console.error(err);
    showToast('❌ Could not save vote.');
  });
}

// ══════════════════════════════════════════════════

//  SUBMIT
// ══════════════════════════════════════════════════
function submitRec() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { shake(document.getElementById('f-name')); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  let rec = {
    name,
    placeType,
    location: document.getElementById('f-location').value.trim(),
    author:   currentUser.display_name,
    ts:       Date.now()
  };

  // Store coordinates for map view
  if (selectedPlaceLat !== null && selectedPlaceLng !== null) {
    rec.lat = selectedPlaceLat;
    rec.lng = selectedPlaceLng;
  }

  // Normalize addType for legacy and new values
  const isTryType  = (addType === 'try'  || addType === 'want-to-go');
  const isBeenType = (addType === 'been' || addType === 'been-recommend' || addType === 'been-skip');

  // Map addType to top-level status (for backward compat and card filtering)
  let topStatus;
  if (addType === 'been-skip') topStatus = 'not-recommended';
  else if (isTryType)          topStatus = 'try';
  else                         topStatus = 'recommended';

  // Map addType to userStatuses value
  let userStatusValue;
  if (addType === 'want-to-go' || addType === 'try') userStatusValue = 'want-to-go';
  else if (addType === 'been-skip')                  userStatusValue = 'been-skip';
  else                                               userStatusValue = 'been-recommend';

  if (isTryType) {
    rec.status  = topStatus;
    rec.tryNote = document.getElementById('f-try-note').value.trim();
    rec.url     = document.getElementById('f-url').value.trim();
  } else {
    rec.status  = topStatus;
    rec.cuisine = document.getElementById('f-cuisine').value;
    rec.price   = document.getElementById('f-price').value;
    rec.notes   = document.getElementById('f-notes').value.trim();
    rec.rating  = selectedStars;

    const anyRated = Object.values(factorRatings).some(v => v > 0);
    if (anyRated) {
      rec.factorRatings = { ...factorRatings };
    } else if (addType === 'been') {
      // legacy been adds show the hint
      document.getElementById('factor-hint').style.display = 'block';
    }
  }

  // Store placeId when available
  if (selectedPlaceId) rec.placeId = selectedPlaceId;

  if (editingId) {
    const orig = allRecs[editingId];
    if (orig) {
      rec.author = orig.author;
      rec.ts     = orig.ts;
      if (orig.lat && rec.lat === undefined) { rec.lat = orig.lat; rec.lng = orig.lng; }
      if (orig.placeId && !rec.placeId) rec.placeId = orig.placeId;
    }
  }

  let writePromise;

  if (editingId) {
    // Edit: write each field as a deep path so that sibling sub-nodes
    // (comments, votes, other users' userStatuses, etc.) are preserved.
    // Setting the parent object via update() would wipe those sub-nodes.
    const editUpdates = {};
    Object.entries(rec).forEach(([k, v]) => {
      editUpdates[`recommendations/${editingId}/${k}`] = v;
    });
    if (beenStatusChosen) {
      editUpdates[`recommendations/${editingId}/userStatuses/${currentUser.display_name}`] = { status: userStatusValue, ts: Date.now() };
    }
    if (isBeenType && selectedStars > 0) {
      const authorRating = { overall: selectedStars };
      if (Object.values(factorRatings).some(v => v > 0)) Object.assign(authorRating, factorRatings);
      editUpdates[`recommendations/${editingId}/userRatings/${currentUser.display_name}`] = authorRating;
    }
    writePromise = db.ref().update(editUpdates);
  } else {
    // New entry: embed user-specific data directly into rec so the whole
    // record is written in one set() call — avoids any chained-write timing issues.
    if (isTryType || beenStatusChosen) {
      rec.userStatuses = {};
      rec.userStatuses[currentUser.display_name] = { status: userStatusValue, ts: Date.now() };
    }
    if (isBeenType && selectedStars > 0) {
      const authorRating = { overall: selectedStars };
      if (Object.values(factorRatings).some(v => v > 0)) Object.assign(authorRating, factorRatings);
      rec.userRatings = {};
      rec.userRatings[currentUser.display_name] = authorRating;
    }
    const newKey = db.ref('recommendations').push().key;
    console.log('[submitRec] new entry key:', newKey);
    writePromise = db.ref('recommendations/' + newKey).set(rec);
  }

  console.log('[submitRec] sending write…');

  writePromise.then(() => {
    console.log('[submitRec] write succeeded');
    const toastMsg = isTryType ? '📌 Saved to your list!' : addType === 'been-skip' ? '🚫 Hard Pass noted!' : '🎉 Review saved!';
    showToast(toastMsg);
    closeModal();
    btn.disabled = false; btn.textContent = 'Save';
  }).catch(err => {
    console.error('[submitRec] write failed:', err);
    showToast('❌ Error saving: ' + (err.message || err.code || err));
    btn.disabled = false; btn.textContent = 'Save';
  });
}

// ══════════════════════════════════════════════════

//  DELETE
// ══════════════════════════════════════════════════
function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  db.ref('recommendations/' + id).remove()
    .then(() => showToast('🗑 Entry deleted.'))
    .catch(err => { console.error(err); showToast('❌ Could not delete.'); });
}

// ══════════════════════════════════════════════════
//  MARK AS TRIED + USER RATINGS
// ══════════════════════════════════════════════════
function markAsTried(id) {
  const updates = {};
  updates[`recommendations/${id}/triedBy/${currentUser.display_name}`] = true;
  db.ref().update(updates)
    .then(() => { showToast('✅ Marked as tried!'); toggleRatingForm(id); })
    .catch(err => { console.error(err); showToast('❌ Could not save.'); });
}

function toggleRatingForm(id) {
  // Pre-fill with existing user rating + status if available
  if (!pendingUserRatings[id]) {
    const r = allRecs[id];
    const existing       = r && r.userRatings   && r.userRatings[currentUser.display_name];
    const existingStatus = r && r.userStatuses  && r.userStatuses[currentUser.display_name];
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
    // Sync status toggle buttons
    const vs = pendingUserRatings[id].visitStatus;
    const gnBtn = document.getElementById('vs-gn-' + id);
    const hpBtn = document.getElementById('vs-hp-' + id);
    if (gnBtn) gnBtn.classList.toggle('active', vs === 'been-recommend');
    if (hpBtn) hpBtn.classList.toggle('active', vs === 'been-skip');
    // Enable Save if there is already an overall rating
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
  // Toggle off: clicking the already-active button clears the selection
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
  // Enable Save only when a star rating is chosen
  const saveBtn = document.getElementById('ur-save-' + id);
  if (saveBtn) saveBtn.disabled = (n === 0);
}

function setUserFactorStar(id, factor, n) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  pendingUserRatings[id][factor] = n;
  const el = document.getElementById(`ur-${factor}-${id}`);
  if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

function submitUserRating(id) {
  const state = pendingUserRatings[id] || { overall:0, quality:0, service:0, value:0, ambiance:0 };
  if (!state.overall || state.overall < 1) {
    showToast('Please select an overall star rating.');
    return;
  }
  const updates = {};
  updates[`recommendations/${id}/userRatings/${currentUser.display_name}`] = {
    overall: state.overall||0, quality: state.quality||0, service: state.service||0,
    value: state.value||0, ambiance: state.ambiance||0
  };
  if (state.visitStatus) {
    updates[`recommendations/${id}/userStatuses/${currentUser.display_name}`] = { status: state.visitStatus, ts: Date.now() };
    updates[`recommendations/${id}/triedBy/${currentUser.display_name}`] = true;
  } else if (state.visitStatus === null) {
    // User explicitly toggled off — delete their status entry
    updates[`recommendations/${id}/userStatuses/${currentUser.display_name}`] = null;
    updates[`recommendations/${id}/triedBy/${currentUser.display_name}`] = true;
  } else {
    // No explicit Go Now/Hard Pass — just record that they've been here
    updates[`recommendations/${id}/triedBy/${currentUser.display_name}`] = true;
  }
  db.ref().update(updates)
    .then(() => {
      const toast = state.visitStatus === 'been-recommend' ? '✓ Go Now saved!'
                  : state.visitStatus === 'been-skip'      ? '🚫 Hard Pass saved!'
                  : '⭐ Rating saved!';
      showToast(toast);
      delete pendingUserRatings[id];
      const form = document.getElementById('rf-' + id);
      if (form) form.style.display = 'none';
    })
    .catch(err => { console.error(err); showToast('❌ Could not save.'); });
}

// ══════════════════════════════════════════════════

//  DUPLICATE DETECTION
// ══════════════════════════════════════════════════
function checkForDuplicate(placeId, placeName) {
  if (!placeId) return;
  db.ref('recommendations').orderByChild('placeId').equalTo(placeId).once('value', snap => {
    if (!snap.exists()) return;
    const entries = Object.entries(snap.val());
    if (!entries.length) return;
    const [existingId, existingRec] = entries[0];

    pendingDupId    = existingId;
    pendingDupIsOwn = existingRec.author === currentUser.display_name;

    if (pendingDupIsOwn) {
      document.getElementById('dup-message').textContent =
        `You already added "${existingRec.name}" to InnerTable. Would you like to edit your existing entry?`;
      document.getElementById('dup-primary-btn').textContent = 'Yes, edit my existing entry';
    } else {
      document.getElementById('dup-message').textContent =
        `"${existingRec.name}" is already on InnerTable (added by ${existingRec.author}). Would you like to add your status to the existing entry instead?`;
      document.getElementById('dup-primary-btn').textContent = 'Yes, add my status to the existing entry';
    }

    document.getElementById('dup-overlay').classList.add('open');
  });
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
    // Author: close prompt and open edit modal for their existing entry
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
  const targetId = pendingDupId;  // save before closeModal resets state
  pendingDupId   = null;
  document.getElementById('dup-overlay').classList.remove('open');

  // Open modal in attach mode
  const r = allRecs[targetId];
  closeModal(); // reset form state (clears attachingToId — we re-set below)
  attachingToId = targetId;

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-title').textContent  = 'Add Your Status';
  document.getElementById('type-step').style.display  = 'none';
  document.getElementById('form-step').style.display  = 'none';
  document.getElementById('attach-step').style.display = 'block';
  document.getElementById('attach-place-name').textContent = r ? r.name : '';

  // Reset attach state
  attachStatus = null;
  attachStars  = 0;
  attachFactorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
  document.getElementById('attach-submit-btn').disabled = true;
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
  // Enable submit when a star rating is chosen
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

function submitAttach() {
  if (!attachingToId) return;

  const isBeen = document.getElementById('atc-been')?.classList.contains('active');

  // For "been" experience: overall star rating is required
  if (isBeen && attachStars === 0) {
    showToast('Please select an overall star rating.');
    return;
  }

  const btn = document.getElementById('attach-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const updates = {};

  if (attachStatus) {
    // Go Now or Hard Pass explicitly chosen
    updates[`recommendations/${attachingToId}/userStatuses/${currentUser.display_name}`] = { status: attachStatus, ts: Date.now() };
    updates[`recommendations/${attachingToId}/triedBy/${currentUser.display_name}`] = true;
  } else if (isBeen) {
    // Rated but no explicit recommendation — just mark triedBy
    updates[`recommendations/${attachingToId}/triedBy/${currentUser.display_name}`] = true;
  } else {
    // Want to go
    updates[`recommendations/${attachingToId}/userStatuses/${currentUser.display_name}`] = { status: 'want-to-go', ts: Date.now() };
  }

  if (isBeen && attachStars > 0) {
    const rating = { overall: attachStars };
    if (Object.values(attachFactorRatings).some(v => v > 0)) Object.assign(rating, attachFactorRatings);
    updates[`recommendations/${attachingToId}/userRatings/${currentUser.display_name}`] = rating;
  }

  db.ref().update(updates)
    .then(() => {
      const toastMsg = attachStatus === 'been-recommend' ? '✓ Go Now saved!'
                     : attachStatus === 'been-skip'      ? '🚫 Hard Pass noted!'
                     : isBeen                            ? '⭐ Rating saved!'
                     : '📌 Want-to-go saved!';
      showToast(toastMsg);
      closeModal();
      btn.disabled = false; btn.textContent = 'Save My Status';
    })
    .catch(err => {
      console.error(err);
      showToast('❌ Could not save status.');
      btn.disabled = false; btn.textContent = 'Save My Status';
    });
}
