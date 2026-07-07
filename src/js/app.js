// ══════════════════════════════════════════════════
//  APP — state, navigation, view/filter, add-flow, form controls
// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
let currentUser        = null;  // shape: { id, display_name, avatar_url, is_admin }
let currentView        = 'all';
let currentFilter      = 'all';
let currentTypeFilter  = 'all';
let currentDisplayMode = 'list';
let currentSort        = 'date'; // 'date' | 'rating'
let selectedStars      = 0;
let addType            = null;   // 'want-to-go' | 'been-recommend' | 'been-skip' (also accepts legacy 'try'/'been')
let placeType          = 'restaurant';
let editingId          = null;
let factorRatings      = { quality: 0, service: 0, value: 0, ambiance: 0 };
let selectedPlaceLat   = null;
let selectedPlaceLng   = null;
let selectedPlaceId    = null;   // Google Place ID of the place picked via autocomplete
let beenStatusChosen   = false;  // true once user explicitly clicks Recommend or Hard pass in step 3
let editingPlaceId     = null;   // place uuid of the entry being edited (place fields locked)
let addingToPlaceId    = null;   // place uuid when adding a take to an existing place (CTA)
let mapInstance        = null;
let mapMarkers         = [];
let googleMapsReady    = false;
const pendingUserRatings = {}; // { [id]: { overall, quality, service, value, ambiance } }

// ── Add-flow state (IT-087 "6b Guided multi-step") ──
let flowStep          = 1;     // 1 = Place · 2 = Intent · 3 = Review
let skipPlaceStep     = false; // true when the place is pre-filled (add-take / edit)
let placeFieldsLocked = false; // place metadata can't change after creation

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
  document.querySelectorAll('.view-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  if (el) {
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
  }
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
  const countTitle     = document.getElementById('count-title');

  if (mode === 'list') {
    listContainer.style.display = '';
    mapContainer.style.display  = 'none';
    countTitle.style.display    = '';
    renderCards();
  } else {
    listContainer.style.display = 'none';
    mapContainer.style.display  = 'block';
    countTitle.style.display    = 'none';
    initMap();
  }
}

// Filter & sort pill — reveals/hides the filter chip rows (IT-086 stub;
// the designed bottom sheet is an explicit follow-up ticket).
function toggleFilterSort() {
  const row = document.getElementById('filters-row');
  const btn = document.getElementById('filter-sort-btn');
  const open = !row.classList.contains('open');
  row.classList.toggle('open', open);
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
}

// ══════════════════════════════════════════════════
//  ADD/EDIT FLOW (IT-087 "6b Guided multi-step")
//  Step 1 Place → Step 2 Intent → Step 3 Review (I've-been only).
//  Want-to-try completes at step 2. Writes still go through
//  places-service submitEntry() unchanged (IT-036).
// ══════════════════════════════════════════════════
function openModal() {
  // Fresh add only — editing goes through editEntry(), and adding a take to
  // an existing place goes through addTakeForPlace().
  clearForm();
  document.getElementById('modal-overlay').classList.add('open');
  goToStep(1);
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  clearForm();
}

function closeModalOnBg(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

function goToStep(n) {
  flowStep = n;
  document.getElementById('step-place').style.display  = n === 1 ? 'block' : 'none';
  document.getElementById('step-intent').style.display = n === 2 ? 'block' : 'none';
  document.getElementById('step-review').style.display = n === 3 ? 'block' : 'none';

  if (n === 2) _fillMinicard();
  if (n === 3) {
    document.getElementById('review-place-name').textContent =
      document.getElementById('f-name').value.trim();
  }

  updateFlowUI();
  document.getElementById('flow-body').scrollTop = 0;
}

// Step 2 confirmed-place mini-card
function _fillMinicard() {
  const name     = document.getElementById('f-name').value.trim();
  const location = document.getElementById('f-location').value.trim();
  const typeLabel = placeType === 'bar' ? 'Bar' : 'Restaurant';
  document.getElementById('minicard-name').textContent = name;
  document.getElementById('minicard-meta').textContent =
    location ? `${typeLabel} · ${location}` : typeLabel;
  // Place metadata is locked after creation — no Edit hop back to step 1.
  document.getElementById('minicard-edit').style.display = placeFieldsLocked ? 'none' : '';
}

// Intent selection (step 2)
function setIntent(kind) {
  const tryCard  = document.getElementById('intent-try');
  const beenCard = document.getElementById('intent-been');

  if (kind === 'try') {
    addType = 'want-to-go';
    beenStatusChosen = false;
    tryCard.classList.add('selected');
    beenCard.classList.remove('selected');
    updateFlowUI();
  } else {
    // Keep an explicitly chosen verdict when hopping back and forth
    if (!beenStatusChosen) addType = 'been-recommend';
    beenCard.classList.add('selected');
    tryCard.classList.remove('selected');
    goToStep(3);
  }
}

// Header back / cancel button
function flowBack() {
  if (flowStep === 3) {
    goToStep(2);
  } else if (flowStep === 2 && !skipPlaceStep) {
    goToStep(1);
  } else {
    closeModal();
  }
}

// Sticky footer primary button — behavior depends on the step
function flowPrimaryAction() {
  if (flowStep === 1) {
    if (!document.getElementById('f-name').value.trim()) {
      shake(document.getElementById('f-name'));
      return;
    }
    goToStep(2);
  } else if (flowStep === 2) {
    if (addType === 'want-to-go' || addType === 'try') {
      submitEntry();           // Want-to-try path completes in 2 steps
    } else if (addType) {
      goToStep(3);             // I've been → review
    }
  } else {
    submitEntry();
  }
}

// Sync header (cancel/back + dots) and footer (label + enabled + hint)
function updateFlowUI() {
  const backBtn = document.getElementById('flow-back-btn');
  const dots    = document.getElementById('flow-dots');
  const btn     = document.getElementById('submit-btn');
  const hint    = document.getElementById('submit-hint');
  if (!btn) return;

  // Header: Cancel on the first reachable step, ‹ otherwise
  const isFirstStep = flowStep === 1 || (flowStep === 2 && skipPlaceStep);
  backBtn.textContent = isFirstStep ? 'Cancel' : '‹';
  backBtn.classList.toggle('back', !isFirstStep);

  // Progress dots: 2 until the review step exists, then 3 (per Add Flow.dc.html)
  const total = flowStep === 3 ? 3 : 2;
  dots.innerHTML = Array.from({ length: total }, (_, i) =>
    `<span${i === flowStep - 1 ? ' class="active"' : ''}></span>`).join('');

  // Footer
  const hasName = document.getElementById('f-name').value.trim().length > 0;
  const isTry   = addType === 'want-to-go' || addType === 'try';
  let label = 'Next', disabled = false, hintText = '';

  if (flowStep === 1) {
    disabled = !hasName;
    if (disabled) hintText = 'Enter a place name to continue.';
  } else if (flowStep === 2) {
    if (isTry)         { label = 'Save to Want to Try'; }
    else if (addType)  { label = 'Next'; }
    else               { disabled = true; hintText = 'Have you been? Pick one to continue.'; }
  } else {
    label = editingId ? 'Save take' : 'Share take';
  }

  btn.textContent = label;
  btn.disabled = disabled;
  hint.textContent = hintText;
  hint.classList.toggle('hidden', !hintText);
}

// Kept as the shared name places-service error paths call after a failed save.
function updateSubmitBtn() { updateFlowUI(); }

// Lock/unlock the fields that belong to the place row (not the user's take).
// Place metadata can't be edited after creation (IT-035 resolved decision #1),
// so these are disabled whenever the place already exists.
function setPlaceFieldsLocked(locked) {
  placeFieldsLocked = locked;
  ['f-name', 'f-location', 'f-cuisine'].forEach(id => {
    document.getElementById(id).disabled = locked;
  });
  document.getElementById('tog-restaurant').disabled = locked;
  document.getElementById('tog-bar').disabled        = locked;
  document.querySelectorAll('#price-seg .seg-btn').forEach(b => { b.disabled = locked; });
}

// Prefill the place fields of the modal from an allPlaces entry and lock them.
function _prefillPlaceFields(place) {
  document.getElementById('f-name').value     = place.name     || '';
  document.getElementById('f-location').value = place.location || '';
  document.getElementById('f-cuisine').value  = place.cuisine  || '';
  setPrice(place.price || '');
  setPlaceType(place.placeType || 'restaurant');
  setPlaceFieldsLocked(true);
}

// "Add your take" CTA on a place card where the current user has no entry yet.
// Place is pre-filled → the flow starts at step 2 (skips Place).
function addTakeForPlace(placeId) {
  const place = allPlaces[placeId];
  if (!place) return;
  clearForm();
  addingToPlaceId = placeId;
  skipPlaceStep   = true;
  _prefillPlaceFields(place);
  document.getElementById('modal-overlay').classList.add('open');
  goToStep(2);
}

function upgradeToTried(entryId) {
  editEntry(entryId);
  if (!editingId) return; // entry not found
  setIntent('been');
}

function editEntry(entryId) {
  // Locate my take and its place in the place-keyed store
  let place = null, take = null;
  for (const p of Object.values(allPlaces)) {
    const t = p.takes.find(t => t.entryId === entryId);
    if (t) { place = p; take = t; break; }
  }
  if (!place) return;

  clearForm();
  editingId      = entryId;
  editingPlaceId = place.id;
  skipPlaceStep  = true;
  _prefillPlaceFields(place);
  document.getElementById('modal-overlay').classList.add('open');

  if (take.status === 'want-to-go') {
    document.getElementById('f-try-note').value = take.tryNote || '';
    document.getElementById('f-url').value      = take.url     || '';
    goToStep(2);
    setIntent('try');
  } else {
    if (take.status === 'been-skip' || take.status === 'been-recommend') {
      setGoNowOrHardPass(take.status); // marks Recommend / Hard pass active
    }
    if (take.rating > 0) setStars(take.rating);
    let hasFactors = false;
    ['quality','service','value','ambiance'].forEach(f => {
      if (take.factorRatings && take.factorRatings[f]) {
        setFactorStar(f, take.factorRatings[f]);
        hasFactors = true;
      }
    });
    if (hasFactors) setDetailsOpen(true);
    document.getElementById('f-notes').value = take.notes || '';
    document.getElementById('intent-been').classList.add('selected');
    goToStep(3);
  }
}

function toggleCommentForm(id) {
  const form    = document.getElementById('cf-' + id);
  const opening = form.style.display !== 'block';
  form.style.display = opening ? 'block' : 'none';
  if (opening) document.getElementById('ci-' + id).focus();
}

async function submitComment(placeId, btn) {
  const input = document.getElementById('ci-' + placeId);
  const text  = input.value.trim();
  if (!text) { input.focus(); return; }
  btn.disabled = true;

  // IT-035 (migration 0010): comments are keyed straight to places — one
  // shared thread per restaurant, regardless of whose take you're reading.
  const row = {
    place_id:  placeId,
    author_id: currentUser.id,
    text
  };

  // Quote reply: snapshot the original's author + text at write time.  A
  // snapshot (rather than a parent_id join) survives the original being
  // edited or deleted — quotes are a record of what was said at the time.
  if (_pendingQuote && _pendingQuote.placeId === placeId) {
    row.quoted_comment_id = _pendingQuote.commentId;
    row.quoted_author     = _pendingQuote.author;
    row.quoted_text       = _pendingQuote.text;
  }

  const { error } = await supabaseClient.from('comments').insert(row);
  if (error) {
    console.error(error);
    showToast('Could not post comment.');
    btn.disabled = false;
    return;
  }

  input.value = '';
  cancelQuote(placeId);
  btn.disabled = false;
  // Refresh explicitly — don't rely on realtime (see workspace/phase-2-4-test-results.md:
  // the realtime publication may not include the new tables).
  await loadPlaces();
}

// ── Quote replies ─────────────────────────────────
// _pendingQuote holds the comment being replied to until the reply is posted.
// Keyed by placeId so an abandoned reply on one card can't leak into another.
let _pendingQuote = null;

function startQuoteReply(placeId, commentId) {
  const place = allPlaces[placeId];
  const c = place && place.comments.find(c => c.id === commentId);
  if (!c || c.deleted) return;

  _pendingQuote = { placeId, commentId: c.id, author: c.author, text: c.text };

  // Make sure the comment form is open, then render the preview above it
  const form = document.getElementById('cf-' + placeId);
  if (form && form.style.display !== 'block') toggleCommentForm(placeId);

  const previewEl = document.getElementById('quote-preview-' + placeId);
  if (previewEl) {
    const snippet = c.text.length > 140 ? c.text.slice(0, 140) + '…' : c.text;
    previewEl.innerHTML = `
      <div class="quote-preview">
        <strong>Replying to ${esc(c.author)}:</strong>
        <div class="quote-preview-text">${esc(snippet)}</div>
        <button class="quote-cancel" onclick="cancelQuote('${placeId}')" title="Cancel reply">×</button>
      </div>`;
    previewEl.style.display = 'block';
  }
  document.getElementById('ci-' + placeId)?.focus();
}

function cancelQuote(placeId) {
  if (_pendingQuote && _pendingQuote.placeId !== placeId) return;
  _pendingQuote = null;
  const previewEl = document.getElementById('quote-preview-' + placeId);
  if (previewEl) { previewEl.innerHTML = ''; previewEl.style.display = 'none'; }
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

async function saveCommentEdit(recId, commentKey, btn) {
  const textarea = document.getElementById('cet-' + recId + '-' + commentKey);
  const text = textarea.value.trim();
  if (!text) { textarea.focus(); return; }
  btn.disabled = true;
  const { error } = await supabaseClient.from('comments')
    .update({ text }).eq('id', commentKey);
  if (error) {
    console.error(error);
    showToast('Could not save edit.');
  }
  btn.disabled = false;
  if (!error) await loadPlaces(); // explicit refresh — realtime may not be enabled
}

async function deleteComment(recId, commentKey) {
  if (!confirm('Delete this comment? This cannot be undone.')) return;
  // v0.3: soft-delete is now a timestamp (`deleted_at`), not a boolean.
  // The legacy `deleted` column no longer exists.
  const { error } = await supabaseClient.from('comments')
    .update({ deleted_at: new Date().toISOString(), text: null })
    .eq('id', commentKey);
  if (error) {
    console.error(error);
    showToast('Could not delete comment.');
    return;
  }
  await loadPlaces(); // explicit refresh — realtime may not be enabled
}

// ── Emoji Reactions ──────────────────────────────
const REACTION_EMOJIS = ['👍','👎','❤️','💀','😂','😮','😢','💩'];

async function toggleReaction(recId, commentKey, emoji) {
  // v0.3: reactions live in their own table (public.comment_reactions) with
  // (comment_id, user_id) as the primary key — at most one reaction per
  // user per comment, enforced by Postgres.  RLS restricts writes to rows
  // where user_id = auth.uid(), so each user can only toggle their own.
  //
  // Toggle semantics (matches the legacy RPC):
  //   - User has THIS emoji on this comment        → DELETE the row (toggle off)
  //   - User has a DIFFERENT emoji on this comment → UPSERT to the new emoji
  //   - User has no reaction yet                   → INSERT
  //
  // We read current state from allPlaces (already fetched) instead of round-
  // tripping to the DB.  Comments are an array now — find by uuid.
  const place   = allPlaces[recId];
  const comment = place && place.comments.find(c => c.id === commentKey);
  const myName  = currentUser.display_name;

  // Find what emoji (if any) this user currently has on this comment.
  let currentEmoji = null;
  if (comment && comment.reactions) {
    for (const [e, voters] of Object.entries(comment.reactions)) {
      if (voters && voters[myName]) { currentEmoji = e; break; }
    }
  }

  let error;
  if (currentEmoji === emoji) {
    // Toggle off: same emoji clicked again
    ({ error } = await supabaseClient.from('comment_reactions').delete()
      .eq('comment_id', commentKey)
      .eq('user_id',    currentUser.id));
  } else {
    // Insert or change emoji.  upsert on the (comment_id, user_id) PK does
    // both in one round-trip: insert if absent, update emoji if present.
    ({ error } = await supabaseClient.from('comment_reactions').upsert(
      { comment_id: commentKey, user_id: currentUser.id, emoji },
      { onConflict: 'comment_id,user_id' }
    ));
  }

  if (error) {
    console.error(error);
    showToast('Could not save reaction.');
    return;
  }
  await loadPlaces(); // explicit refresh — realtime may not be enabled on these tables
}

// Show a popup listing who has reacted, grouped by emoji
function showReactionViewers(btn, recId, commentKey) {
  document.querySelectorAll('.reaction-viewers-popup').forEach(p => p.remove());
  const place = allPlaces[recId];
  const comment = place && place.comments.find(c => c.id === commentKey);
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

// ── Verdict segmented control — Recommend / Hard pass (step 3) ──
function setGoNowOrHardPass(status) {
  // Toggle off only when this button was already explicitly active.
  // Without the beenStatusChosen guard, clicking Recommend when addType is
  // already 'been-recommend' (the neutral been state) would incorrectly
  // fire the de-select branch instead of selecting the button.
  if (addType === status && beenStatusChosen) {
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
  updateFlowUI();
}

// ══════════════════════════════════════════════════

//  FORM CONTROLS
// ══════════════════════════════════════════════════
function setPlaceType(t) {
  placeType = t;
  document.getElementById('tog-restaurant').classList.toggle('active', t === 'restaurant');
  document.getElementById('tog-bar').classList.toggle('active', t === 'bar');
}

// Price segmented control ($ / $$ / $$$ / $$$$) — writes the hidden #f-price
// input that places-service reads. Clicking the active one clears it.
function setPrice(p) {
  const current = document.getElementById('f-price').value;
  const next = (p && p !== current) ? p : '';
  document.getElementById('f-price').value = next;
  document.querySelectorAll('#price-seg .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.price === next);
  });
}

// Dashed disclosure — cuisine, price & detailed ratings (step 3, optional)
function setDetailsOpen(open) {
  document.getElementById('details-fields').classList.toggle('open', open);
  document.getElementById('details-disclosure').classList.toggle('open', open);
  document.getElementById('details-disclosure').setAttribute('aria-expanded', String(open));
  document.getElementById('disc-arrow').textContent = open ? '▾' : '▸';
}

function toggleDetails() {
  setDetailsOpen(!document.getElementById('details-fields').classList.contains('open'));
}

function setStars(n) {
  selectedStars = n;
  document.querySelectorAll('#star-picker span').forEach((s, i) => {
    s.classList.toggle('filled', i < n);
  });
}

function setFactorStar(factor, n) {
  factorRatings[factor] = n;
  document.querySelectorAll(`#fp-${factor} span`).forEach((s, i) => {
    s.classList.toggle('filled', i < n);
  });
}

function clearForm() {
  ['f-name','f-location','f-cuisine','f-try-note','f-url','f-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setPrice('');
  setStars(0);
  setPlaceType('restaurant');
  setPlaceFieldsLocked(false);
  flowStep = 1;
  document.getElementById('step-place').style.display  = 'block';
  document.getElementById('step-intent').style.display = 'none';
  document.getElementById('step-review').style.display = 'none';
  addType          = null;
  editingId        = null;
  editingPlaceId   = null;
  addingToPlaceId  = null;
  beenStatusChosen = false;
  skipPlaceStep    = false;
  // Reset intent cards
  document.getElementById('intent-try').classList.remove('selected');
  document.getElementById('intent-been').classList.remove('selected');
  // Reset verdict buttons
  document.getElementById('btn-go-now').classList.remove('active');
  document.getElementById('btn-hard-pass').classList.remove('active');
  // Reset factor ratings + collapse the details disclosure
  factorRatings = { quality: 0, service: 0, value: 0, ambiance: 0 };
  ['quality','service','value','ambiance'].forEach(f => {
    document.querySelectorAll(`#fp-${f} span`).forEach(s => s.classList.remove('filled'));
  });
  setDetailsOpen(false);
  selectedPlaceLat = null;
  selectedPlaceLng = null;
  selectedPlaceId  = null;
  updateFlowUI();
}

// ══════════════════════════════════════════════════
