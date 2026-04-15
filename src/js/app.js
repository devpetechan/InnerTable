// ══════════════════════════════════════════════════
//  APP — state, navigation, view/filter, modal, form controls
// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
let currentUser        = null;
let isAdmin            = false;
let currentView        = 'all';
let currentFilter      = 'all';
let currentTypeFilter  = 'all';
let currentDisplayMode = 'list';
let currentSort        = 'date'; // 'date' | 'rating'
let selectedStars      = 0;
let addType            = null;   // 'want-to-go' | 'been-recommend' | 'been-skip' (also accepts legacy 'try'/'been')
let placeType          = 'restaurant';
let editingId          = null;
let allRecs            = {};
let factorRatings      = { quality: 0, service: 0, value: 0, ambiance: 0 };
let selectedPlaceLat   = null;
let selectedPlaceLng   = null;
let selectedPlaceId    = null;   // Google Place ID for duplicate detection
let beenStatusChosen   = false;  // true once user explicitly clicks Go Now or Hard Pass in been-fields
let pendingDupId       = null;   // Firebase key of detected duplicate entry
let pendingDupIsOwn    = false;  // true if current user is the author of the duplicate
let attachingToId      = null;   // Firebase key of entry being attached to
let attachStatus       = null;   // 'want-to-go' | 'been-recommend' | 'been-skip'
let attachStars        = 0;
let attachFactorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
let mapInstance        = null;
let mapMarkers         = [];
let googleMapsReady    = false;
const pendingUserRatings = {}; // { [id]: { overall, quality, service, value, ambiance } }

const COLORS   = ['c0','c1','c2','c3','c4'];
const colorMap = {};
let   colorIdx = 0;
const geocodingCache = new Set(); // ids currently being geocoded (prevent duplicate requests)
function getUserColor(name) {
  if (!colorMap[name]) { colorMap[name] = COLORS[colorIdx++ % COLORS.length]; }
  return colorMap[name];
}


// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
function goHome() {
  document.getElementById('home-section').style.display = 'block';
  document.getElementById('list-map-section').style.display = 'none';
  document.getElementById('add-place-fab').style.display = 'none';
}

function navigateToList(typeFilter) {
  // Update type filter state and chips
  currentTypeFilter = typeFilter || 'all';
  document.querySelectorAll('[data-type]').forEach(c => {
    c.classList.toggle('active', c.dataset.type === currentTypeFilter);
  });

  // Ensure we have a valid view
  if (!['all','try','recommended','no'].includes(currentView)) {
    currentView = 'all';
  }

  // Sync view tab highlight
  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === currentView);
  });

  // Show list section
  document.getElementById('home-section').style.display = 'none';
  document.getElementById('list-map-section').style.display = 'block';
  document.getElementById('add-place-fab').style.display = '';

  // Ensure list mode is active
  if (currentDisplayMode !== 'list') {
    setDisplayMode('list');
  } else {
    renderCards();
  }
}


//  VIEW / FILTER
// ══════════════════════════════════════════════════
function setView(view, el) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  if (currentDisplayMode === 'map' && mapInstance) {
    renderMapMarkers();
  } else {
    renderCards();
  }
}

function setFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('#friend-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  if (currentDisplayMode === 'map' && mapInstance) {
    renderMapMarkers();
  } else {
    renderCards();
  }
}

function setTypeFilter(type, el) {
  currentTypeFilter = type;
  document.querySelectorAll('[data-type]').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  if (currentDisplayMode === 'map' && mapInstance) {
    renderMapMarkers();
  } else {
    renderCards();
  }
}

function setSort(sort, el) {
  currentSort = sort;
  document.querySelectorAll('#sort-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderCards();
}

function setDisplayMode(mode) {
  currentDisplayMode = mode;
  document.getElementById('mode-list').classList.toggle('active', mode === 'list');
  document.getElementById('mode-map').classList.toggle('active', mode === 'map');

  const listContainer  = document.getElementById('cards-container');
  const mapContainer   = document.getElementById('map-container');
  const friendBar      = document.getElementById('friend-filter-bar');
  const countTitle     = document.getElementById('count-title');

  if (mode === 'list') {
    listContainer.style.display = '';
    mapContainer.style.display  = 'none';
    friendBar.style.display     = '';
    countTitle.style.display    = '';
    renderCards();
  } else {
    listContainer.style.display = 'none';
    mapContainer.style.display  = 'block';
    friendBar.style.display     = '';
    countTitle.style.display    = 'none';
    initMap();
  }
}

// ══════════════════════════════════════════════════

//  MODAL
// ══════════════════════════════════════════════════
function openModal(prefillId) {
  editingId = prefillId || null;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('form-step').style.display   = 'block';
  document.getElementById('attach-step').style.display = 'none';
  document.getElementById('modal-title').textContent = editingId ? 'Mark as Tried' : 'Add a Place';

  // Reset experience toggle for fresh add
  document.getElementById('exp-been').classList.remove('active');
  document.getElementById('exp-try').classList.remove('active');
  document.getElementById('been-fields').style.display = 'none';
  document.getElementById('try-fields').style.display  = 'none';
  document.getElementById('btn-go-now').classList.remove('active');
  document.getElementById('btn-hard-pass').classList.remove('active');
  addType = null;
  beenStatusChosen = false;
  updateSubmitBtn();

  if (editingId) {
    // For upgrade-to-tried: auto-select "I've Been" and show been-fields
    setBeenOrTry('been');
    const r = allRecs[editingId];
    if (r) {
      document.getElementById('f-name').value     = r.name     || '';
      document.getElementById('f-location').value = r.location || '';
      setPlaceType(r.placeType || 'restaurant');
    }
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('attach-step').style.display = 'none';
  clearForm();
  editingId     = null;
  attachingToId = null;
  attachStatus  = null;
}

function closeModalOnBg(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

function upgradeToTried(id) { openModal(id); }

function editEntry(id) {
  const r = allRecs[id];
  if (!r) return;
  editingId = id;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-title').textContent = 'Edit Place';
  document.getElementById('form-step').style.display = 'block';
  document.getElementById('attach-step').style.display = 'none';

  if (r.status === 'try') {
    addType = 'try';
    beenStatusChosen = false;
    document.getElementById('form-step-title').textContent = '📌 Edit Place to Try';
    document.getElementById('form-step-title').style.display = 'block';
    document.getElementById('try-fields').style.display  = 'block';
    document.getElementById('been-fields').style.display = 'none';
    document.getElementById('exp-been').classList.remove('active');
    document.getElementById('exp-try').classList.add('active');
    document.getElementById('f-try-note').value = r.tryNote || '';
    document.getElementById('f-url').value       = r.url     || '';
  } else {
    const isSkip = r.status === 'not-recommended';
    addType = isSkip ? 'been-skip' : 'been-recommend';
    beenStatusChosen = true;
    document.getElementById('form-step-title').textContent = "🍴 Edit Place You've Visited";
    document.getElementById('form-step-title').style.display = 'block';
    document.getElementById('try-fields').style.display  = 'none';
    document.getElementById('been-fields').style.display = 'block';
    document.getElementById('exp-been').classList.add('active');
    document.getElementById('exp-try').classList.remove('active');
    document.getElementById('btn-go-now').classList.toggle('active', !isSkip);
    document.getElementById('btn-hard-pass').classList.toggle('active', isSkip);
    document.getElementById('f-cuisine').value = r.cuisine || '';
    document.getElementById('f-price').value   = r.price   || '';
    // Use author's own rating if in userRatings, else fall back to top-level rating
    const authorRating = r.userRatings && r.userRatings[r.author] ? r.userRatings[r.author] : r;
    if (authorRating.rating || authorRating.overall) setStars(authorRating.overall || authorRating.rating || 0);
    document.getElementById('f-notes').value   = r.notes   || '';
    const fr = authorRating.factorRatings || (r.userRatings && r.userRatings[r.author]) || r.factorRatings;
    if (fr) {
      ['quality','service','value','ambiance'].forEach(f => {
        if (fr[f]) setFactorStar(f, fr[f]);
      });
    }
  }

  document.getElementById('f-name').value     = r.name     || '';
  document.getElementById('f-location').value = r.location || '';
  setPlaceType(r.placeType || 'restaurant');
  updateSubmitBtn();
  document.querySelector('.modal').scrollTop = 0;
}

function toggleCommentForm(id) {
  const form    = document.getElementById('cf-' + id);
  const opening = form.style.display !== 'block';
  form.style.display = opening ? 'block' : 'none';
  if (opening) document.getElementById('ci-' + id).focus();
}

function submitComment(id, btn) {
  const input = document.getElementById('ci-' + id);
  const text  = input.value.trim();
  if (!text) { input.focus(); return; }
  btn.disabled = true;
  db.ref('recommendations/' + id + '/comments').push({
    author: currentUser, text, ts: Date.now()
  }).then(() => {
    btn.disabled = false;
  }).catch(err => {
    console.error(err);
    showToast('❌ Could not post comment.');
    btn.disabled = false;
  });
}

function startEditComment(recId, commentKey) {
  document.getElementById('cv-'  + recId + '-' + commentKey).style.display = 'none';
  document.getElementById('cef-' + recId + '-' + commentKey).style.display = 'block';
  document.getElementById('cet-' + recId + '-' + commentKey).focus();
}

function cancelEditComment(recId, commentKey) {
  document.getElementById('cef-' + recId + '-' + commentKey).style.display = 'none';
  document.getElementById('cv-'  + recId + '-' + commentKey).style.display = 'block';
}

function saveCommentEdit(recId, commentKey, btn) {
  const textarea = document.getElementById('cet-' + recId + '-' + commentKey);
  const text = textarea.value.trim();
  if (!text) { textarea.focus(); return; }
  btn.disabled = true;
  db.ref('recommendations/' + recId + '/comments/' + commentKey).update({ text }).then(() => {
    btn.disabled = false;
  }).catch(err => {
    console.error(err);
    showToast('❌ Could not save edit.');
    btn.disabled = false;
  });
}

function deleteComment(recId, commentKey) {
  if (!confirm('Delete this comment? This cannot be undone.')) return;
  db.ref('recommendations/' + recId + '/comments/' + commentKey).update({ deleted: true, text: null }).catch(err => {
    console.error(err);
    showToast('❌ Could not delete comment.');
  });
}

// ── Emoji Reactions ──────────────────────────────
const REACTION_EMOJIS = ['👍','👎','❤️','💀','😂','😮','😢','💩'];

function toggleReaction(recId, commentKey, emoji) {
  const reactions = allRecs[recId]?.comments?.[commentKey]?.reactions || {};
  const encodedEmoji = encodeURIComponent(emoji);

  // Find the user's current reaction key (stored URL-encoded in Firebase).
  // A user may only hold one reaction at a time, so we remove any existing
  // one before adding the new selection.
  let currentReactionKey = null;
  for (const [key, users] of Object.entries(reactions)) {
    if (users && users[currentUser]) { currentReactionKey = key; break; }
  }

  const updates = {};
  // Remove the existing reaction (if any)
  if (currentReactionKey) {
    updates[`recommendations/${recId}/comments/${commentKey}/reactions/${currentReactionKey}/${currentUser}`] = null;
  }
  // Add the new emoji — unless the user tapped their existing one (toggle off)
  if (currentReactionKey !== encodedEmoji) {
    updates[`recommendations/${recId}/comments/${commentKey}/reactions/${encodedEmoji}/${currentUser}`] = true;
  }

  db.ref().update(updates).catch(err => {
    console.error(err);
    showToast('❌ Could not save reaction.');
  });
}

// Show a popup listing who has reacted, grouped by emoji
function showReactionViewers(btn, recId, commentKey) {
  document.querySelectorAll('.reaction-viewers-popup').forEach(p => p.remove());
  const rec = allRecs[recId];
  const comment = rec && rec.comments && rec.comments[commentKey];
  const reactions = comment ? (comment.reactions || {}) : {};

  const popup = document.createElement('div');
  popup.className = 'reaction-viewers-popup';

  let hasAny = false;
  REACTION_EMOJIS.forEach(emoji => {
    // Firebase keys may be encoded
    const emojiReactions = reactions[emoji] || reactions[encodeURIComponent(emoji)] || {};
    const voters = Object.keys(emojiReactions).filter(u => emojiReactions[u]);
    if (!voters.length) return;
    hasAny = true;
    const row = document.createElement('div');
    row.className = 'reaction-viewer-row';
    row.innerHTML = `<span class="reaction-viewer-emoji">${emoji}</span><span class="reaction-viewer-names">${voters.map(v => esc(v)).join(', ')}</span>`;
    popup.appendChild(row);
  });

  if (!hasAny) return;

  btn.style.position = 'relative';
  btn.appendChild(popup);

  const close = (e) => {
    if (!btn.contains(e.target)) {
      popup.remove();
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
  }, 0);
}

function showReactionPicker(btn, recId, commentKey) {
  // Close any open pickers first
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());
  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  REACTION_EMOJIS.forEach(emoji => {
    const b = document.createElement('button');
    b.className = 'reaction-picker-btn';
    b.textContent = emoji;
    b.title = emoji;
    b.onmousedown = (e) => e.stopPropagation(); // prevent triggering parent btn handlers
    b.onclick = (e) => {
      e.stopPropagation();
      toggleReaction(recId, commentKey, emoji);
      picker.remove();
    };
    picker.appendChild(b);
  });
  btn.appendChild(picker);
  // Close on outside click/touch
  const close = (e) => {
    if (!btn.contains(e.target)) { picker.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
  }, 0);
}

function selectAddType(type) {
  addType = type;

  const isTry  = (type === 'try'  || type === 'want-to-go');
  const isBeen = (type === 'been' || type === 'been-recommend' || type === 'been-skip');

  document.getElementById('try-fields').style.display  = isTry  ? 'block' : 'none';
  document.getElementById('been-fields').style.display = isBeen ? 'block' : 'none';

  document.querySelector('.modal').scrollTop = 0;
}

// ── Experience toggle (I've Been / Want to Try) ──
function setBeenOrTry(type) {
  const isBeen = type === 'been';
  document.getElementById('exp-been').classList.toggle('active', isBeen);
  document.getElementById('exp-try').classList.toggle('active', !isBeen);

  if (isBeen) {
    // Show been-fields but don't enable Save yet — need Go Now or Hard Pass
    selectAddType('been-recommend'); // sets addType + shows been-fields
    // beenStatusChosen stays false until Go Now/Hard Pass is explicitly clicked
    beenStatusChosen = false;
  } else {
    selectAddType('want-to-go');
    beenStatusChosen = false;
  }
  updateSubmitBtn();
}

// ── Go Now / Hard Pass toggle (inside been-fields) ──
function setGoNowOrHardPass(status) {
  // Toggle off: clicking the already-active button clears the selection
  if (addType === status) {
    addType = 'been-recommend'; // reset to neutral been state
    beenStatusChosen = false;
    document.getElementById('btn-go-now').classList.remove('active');
    document.getElementById('btn-hard-pass').classList.remove('active');
  } else {
    addType = status;
    beenStatusChosen = true;
    document.getElementById('btn-go-now').classList.toggle('active',    status === 'been-recommend');
    document.getElementById('btn-hard-pass').classList.toggle('active', status === 'been-skip');
  }
  updateSubmitBtn();
}

// ── Submit button enable/disable logic ──
function updateSubmitBtn() {
  const nameEl = document.getElementById('f-name');
  const btn    = document.getElementById('submit-btn');
  if (!btn) return;
  const hasName = nameEl && nameEl.value.trim().length > 0;
  const isTry   = addType === 'want-to-go' || addType === 'try';
  const isBeen  = addType === 'been-recommend' || addType === 'been-skip' || addType === 'been';
  if (!addType)       { btn.disabled = true;  return; }
  if (isTry)          { btn.disabled = !hasName; return; }
  if (isBeen)         { btn.disabled = !(hasName && beenStatusChosen); return; }
  btn.disabled = true;
}

// ── Attach experience toggle ──
function setAttachExperience(type) {
  const isBeen = type === 'been';
  document.getElementById('atc-been').classList.toggle('active', isBeen);
  document.getElementById('atc-try').classList.toggle('active', !isBeen);
  if (isBeen) {
    document.getElementById('attach-rating-section').style.display = 'block';
    attachStatus = null;
    document.getElementById('abtn-go-now').classList.remove('active');
    document.getElementById('abtn-hard-pass').classList.remove('active');
    // Submit enabled only once an overall star rating is selected
    document.getElementById('attach-submit-btn').disabled = (attachStars === 0);
  } else {
    attachStatus = 'want-to-go';
    document.getElementById('attach-rating-section').style.display = 'none';
    document.getElementById('attach-submit-btn').disabled = false;
  }
}

// ── Attach Go Now / Hard Pass toggle (optional) ──
function setAttachGoNowOrHardPass(status) {
  // Toggle: clicking the active button clears the selection
  if (attachStatus === status) {
    attachStatus = null;
    document.getElementById('abtn-go-now').classList.remove('active');
    document.getElementById('abtn-hard-pass').classList.remove('active');
  } else {
    attachStatus = status;
    document.getElementById('abtn-go-now').classList.toggle('active',    status === 'been-recommend');
    document.getElementById('abtn-hard-pass').classList.toggle('active', status === 'been-skip');
  }
  // Save enablement is driven by star rating, not status
}

// ══════════════════════════════════════════════════

//  FORM CONTROLS
// ══════════════════════════════════════════════════
function setPlaceType(t) {
  placeType = t;
  document.getElementById('tog-restaurant').classList.toggle('active',      t === 'restaurant');
  document.getElementById('tog-restaurant').classList.toggle('rest-active', t === 'restaurant');
  document.getElementById('tog-bar').classList.toggle('active',    t === 'bar');
  document.getElementById('tog-bar').classList.toggle('bar-active', t === 'bar');
}

function setRecommend(val) {
  // Skip-it removed; ratings always shown
}

function setStars(n) {
  selectedStars = n;
  document.querySelectorAll('#star-picker span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

function setFactorStar(factor, n) {
  factorRatings[factor] = n;
  document.querySelectorAll(`#fp-${factor} span`).forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
  // Hide hint once user starts rating
  document.getElementById('factor-hint').style.display = 'none';
}

function clearForm() {
  ['f-name','f-location','f-try-note','f-url','f-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-cuisine').value = '';
  document.getElementById('f-price').value   = '';
  setStars(0);
  setPlaceType('restaurant');
  addType          = null;
  editingId        = null;
  beenStatusChosen = false;
  // Reset experience toggle
  document.getElementById('exp-been').classList.remove('active');
  document.getElementById('exp-try').classList.remove('active');
  document.getElementById('been-fields').style.display = 'none';
  document.getElementById('try-fields').style.display  = 'none';
  // Reset Go Now / Hard Pass buttons
  document.getElementById('btn-go-now').classList.remove('active');
  document.getElementById('btn-hard-pass').classList.remove('active');
  // Reset factor ratings
  factorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
  ['quality','service','value','ambiance'].forEach(f => {
    document.querySelectorAll(`#fp-${f} span`).forEach(s => { s.textContent = '☆'; });
  });
  document.getElementById('factor-hint').style.display = 'none';
  selectedPlaceLat = null;
  selectedPlaceLng = null;
  selectedPlaceId  = null;
  updateSubmitBtn();
}

// ══════════════════════════════════════════════════
