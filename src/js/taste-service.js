// ══════════════════════════════════════════════════
//  TASTE SERVICE + TASTE GRID (v0.5.0 Phase 3 · IT-047 · REL-12)
//
//  HOW IT WORKS (overview for learning):
//  ─────────────────────────────────────
//  This is the *explicit* half of the v0.6 trust model: I directly name
//  a friend and a category and say how much I trust their pick there.
//  Nothing is computed over places yet (that's v0.6's implicit similarity);
//  here we only COLLECT the signal.
//
//  Three reference reads + one write target:
//    - public.categories            — 19 seeded factors (read-all)
//    - public.place_categories      — place↔category join (read-all; used
//                                     only to personalise which columns show)
//    - public.friend_taste_overrides — MY per-friend/per-category weight
//                                     (own-row RLS, keyed on rater_id = me)
//
//  THE NULL vs 0 INVARIANT (do not break — see migration 0022 header):
//    NULL / no row = "no opinion / use default"
//    0             = "explicit mute"   ← quant mode only (Phase 4)
//    1..5          = ascending trust
//  The casual 5-dot grid NEVER writes 0.  Clearing a cell DELETEs the row
//  (back to default) — it must never be coerced to 0, or it poisons the
//  v0.6 blend.  See setTasteDot() / upsertOverride().
//
//  Screen ownership mirrors friends-service.js: that file owns the Friends
//  screen's data + rendering, so this file owns the Taste tab's.  (The plan
//  sketched ui-render.js, but the established convention is service-owns-
//  screen; kept consistent here.)  Static listeners still live in
//  ui-events.js by convention; the tab itself rides the existing #friends-
//  tabs delegation, so no new listener is needed.
// ══════════════════════════════════════════════════


// ── Module state ─────────────────────────────────
let _categories        = [];    // all seeded categories, sorted by sort_order
let _mostUsedCats      = [];     // personalised subset shown as columns by default
let _tasteOverrides    = {};     // { friendId: { categoryId: weight } }  (weight may be null/0)
let _showAllCategories = false;  // "Show all categories" expander state
let _tasteLoaded       = false;  // first-load spinner guard
const _tasteSaveTimers = {};     // debounce timers keyed by "friendId::categoryId"

const TASTE_DEFAULT_COLS = 6;    // most-used columns before "show all"
const TASTE_SAVE_DEBOUNCE_MS = 300;


// ══════════════════════════════════════════════════
//  SERVICE LAYER  (data reads + the single write path)
// ══════════════════════════════════════════════════

// getCategories: all seeded factors, ORDER BY sort_order (cuisines, then
// venue types, then the catch-all 'other' at 900).  Cached — the seed set
// is controlled reference data and never changes within a session.
async function getCategories() {
  if (_categories.length) return _categories;
  const { data, error } = await supabaseClient
    .from('categories')
    .select('id, slug, display_name, category_type, sort_order')
    .order('sort_order');
  if (error) {
    console.error('[getCategories]', error);
    return [];
  }
  _categories = data || [];
  return _categories;
}

// getMyOverrides: my explicit weights, shaped for O(1) cell lookup.
// RLS returns only rows where rater_id = me, so no filter is strictly
// needed — we pass one anyway to be explicit and index-friendly.
// A row may carry weight NULL (created via quant mode) — kept as-is so the
// null≠0 distinction survives the round-trip.
async function getMyOverrides() {
  const { data, error } = await supabaseClient
    .from('friend_taste_overrides')
    .select('friend_id, category_id, weight')
    .eq('rater_id', currentUser.id);
  if (error) {
    console.error('[getMyOverrides]', error);
    return {};
  }
  const map = {};
  for (const r of data || []) {
    (map[r.friend_id] = map[r.friend_id] || {})[r.category_id] = r.weight;
  }
  return map;
}

// upsertOverride: the ONE write path for taste weights.
//   weight null/undefined → DELETE the row (back to default/NULL — never 0)
//   weight 0..5           → upsert (updated_at auto-refreshes via trigger)
// The (rater_id, friend_id, category_id) PK makes the upsert idempotent, so
// repeated taps on the same cell collapse to one row.
async function upsertOverride(friendId, categoryId, weight) {
  if (weight === null || weight === undefined) {
    const { error } = await supabaseClient
      .from('friend_taste_overrides')
      .delete()
      .eq('rater_id',    currentUser.id)
      .eq('friend_id',   friendId)
      .eq('category_id', categoryId);
    if (error) {
      console.error('[upsertOverride:delete]', error);
      showToast('Could not clear that rating.');
      return false;
    }
    return true;
  }

  const { error } = await supabaseClient
    .from('friend_taste_overrides')
    .upsert(
      { rater_id: currentUser.id, friend_id: friendId, category_id: categoryId, weight },
      { onConflict: 'rater_id,friend_id,category_id' }
    );
  if (error) {
    console.error('[upsertOverride]', error);
    showToast('Could not save that rating.');
    return false;
  }
  return true;
}

// getMostUsedCategories: personalise the default columns from the user's own
// entries → place_categories → categories.  Ordered by how often the user
// has rated a place in that category (desc), tie-broken by seed sort_order.
// Falls back to / pads with seed order when the user has few categorised
// entries — the 3 uncategorised production places (and any unmapped cuisine)
// simply don't count, which is fine (place_categories is best-effort v0.6 prep).
async function getMostUsedCategories(limit = TASTE_DEFAULT_COLS) {
  const cats = await getCategories();
  if (!cats.length) return [];

  const counts = {};
  const { data: entries, error: entriesErr } = await supabaseClient
    .from('entries')
    .select('place_id')
    .eq('user_id', currentUser.id);
  if (entriesErr) console.error('[getMostUsedCategories:entries]', entriesErr);

  const placeIds = [...new Set((entries || []).map(e => e.place_id).filter(Boolean))];
  if (placeIds.length) {
    const { data: pcs, error: pcErr } = await supabaseClient
      .from('place_categories')
      .select('category_id')
      .in('place_id', placeIds);
    if (pcErr) console.error('[getMostUsedCategories:place_categories]', pcErr);
    for (const pc of pcs || []) {
      counts[pc.category_id] = (counts[pc.category_id] || 0) + 1;
    }
  }

  // Personalised first (by usage desc, then sort_order), then pad to `limit`
  // with the remaining categories in seed order so the grid always has columns.
  const used = cats
    .filter(c => counts[c.id])
    .sort((a, b) => (counts[b.id] - counts[a.id]) || (a.sort_order - b.sort_order));

  const result = [];
  for (const c of used) {
    if (result.length >= limit) break;
    result.push(c);
  }
  if (result.length < limit) {
    for (const c of cats) {
      if (result.length >= limit) break;
      if (!result.includes(c)) result.push(c);
    }
  }
  return result;
}


// ══════════════════════════════════════════════════
//  TASTE TAB — LOAD + RENDER
//  Reuses friends-service's myFriends (accepted edges, loaded at startup)
//  for the rows rather than re-querying the friend graph.
// ══════════════════════════════════════════════════

// Called by switchFriendsTab('taste') in friends-service.js.  Explicit
// refresh on every open (IT-107): overrides are private to the rater, so no
// realtime is involved — a fresh read after our own writes is exactly right.
async function loadTasteScreen() {
  const el = document.getElementById('taste-grid');
  if (el && !_tasteLoaded) el.innerHTML = '<div class="loading-spinner">Loading…</div>';

  await getCategories();
  _mostUsedCats   = await getMostUsedCategories();
  _tasteOverrides = await getMyOverrides();
  _tasteLoaded    = true;
  renderTasteGrid();
}

function renderTasteGrid() {
  const el = document.getElementById('taste-grid');
  if (!el) return;

  // Preserve horizontal scroll across the full re-render a tap triggers, so
  // editing a far-right column doesn't snap the grid back to the first one.
  const prevScroll = el.querySelector('.taste-grid-wrap')?.scrollLeft || 0;

  if (!myFriends.length) {
    el.innerHTML = `
      <div class="friends-empty">
        <p>No friends yet.</p>
        <p class="friends-empty-hint">Add friends first, then tune how much you trust their taste, category by category.</p>
      </div>`;
    return;
  }

  // Quant mode (IT-048) exposes the FULL category list by design (precise
  // inspect/override), so it ignores the most-used short list.  Casual keeps
  // the personalised short list with a "show all" expander.
  const quant = advancedDetails;
  const cols  = (quant || _showAllCategories) ? _categories : _mostUsedCats;

  const cellFn = quant ? _tasteQuantCellHtml : _tasteDotCellHtml;

  const head = cols
    .map(c => `<th class="tg-col" scope="col" title="${esc(c.display_name)}">${esc(c.display_name)}</th>`)
    .join('');

  const rows = myFriends.map(f => {
    const ov = _tasteOverrides[f.userId] || {};
    const cells = cols.map(c => cellFn(f.userId, c.id, ov[c.id])).join('');
    return `
      <tr>
        <th class="tg-friend" scope="row">
          <span class="tg-friend-name">${esc(f.profile.display_name)}</span>
        </th>
        ${cells}
      </tr>`;
  }).join('');

  // Two skins over one dataset.  Casual hides mute and offers the expander;
  // quant shows every category and the explicit 0/mute vs blank(=default).
  const hint = quant
    ? 'Precise trust per category. <strong>0</strong> = mute (never weight their pick here); <strong>—</strong> = no opinion / use default.'
    : 'More dots = you trust their pick more in that category. Tap a filled dot again to clear it.';

  const expander = quant ? '' : `
    <button class="taste-showall" onclick="toggleShowAllCategories()">
      ${_showAllCategories ? 'Show fewer categories' : 'Show all categories'}
    </button>`;

  el.innerHTML = `
    <div class="friends-subheading">Rate your friends' taste</div>
    <p class="taste-hint">${hint}</p>

    <div class="taste-grid-wrap">
      <table class="taste-grid${quant ? ' taste-grid-quant' : ''}">
        <thead>
          <tr><th class="tg-corner" scope="col"><span class="sr-only">Friend</span></th>${head}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${expander}`;

  const wrap = el.querySelector('.taste-grid-wrap');
  if (wrap) wrap.scrollLeft = prevScroll;
}

// One cell = a 5-dot control.  A NULL/0/absent weight renders as 0 filled
// dots (casual mode deliberately does not distinguish mute from unset —
// that lives in quant mode, Phase 4).
function _tasteDotCellHtml(friendId, categoryId, weight) {
  const filled = (typeof weight === 'number' && weight > 0) ? weight : 0;
  let dots = '';
  for (let i = 1; i <= 5; i++) {
    dots += `<span class="tg-dot${i <= filled ? ' filled' : ''}"
      role="button" tabindex="0" aria-label="Set trust ${i} of 5"
      onclick="setTasteDot('${friendId}','${categoryId}',${i})"></span>`;
  }
  return `<td class="tg-cell">${dots}</td>`;
}

// Quant cell (IT-048): a precise <select> exposing every state the casual dots
// deliberately hide — blank (—) = no opinion/default, 0 = explicit mute, 1..5 =
// ascending trust.  A <select> (over a slider/number input) makes the null-vs-0
// distinction unambiguous and self-documenting, and round-trips cleanly through
// the SAME upsertOverride path (— → DELETE, 0..5 → upsert).  weight may arrive
// as a number (incl. 0), or null/undefined for no row — both render as blank.
function _tasteQuantCellHtml(friendId, categoryId, weight) {
  const cur = (typeof weight === 'number') ? String(weight) : '';   // '' = default/NULL
  const muted = cur === '0';
  const opt = (val, label) =>
    `<option value="${val}"${val === cur ? ' selected' : ''}>${label}</option>`;
  return `<td class="tg-cell">
    <select class="tg-quant${muted ? ' muted' : ''}" aria-label="Trust weight 0 to 5, or default"
      onchange="setTasteQuant('${friendId}','${categoryId}',this.value)">
      ${opt('',  '—')}
      ${opt('0', '0')}
      ${opt('1', '1')}
      ${opt('2', '2')}
      ${opt('3', '3')}
      ${opt('4', '4')}
      ${opt('5', '5')}
    </select>
  </td>`;
}

// Tap a dot: set weight = n, or clear (delete row) when tapping the dot that
// already represents the current value — the toggle-off pattern used by the
// price/star controls elsewhere.  Optimistic: update local state + re-render
// immediately, then persist debounced.  Clearing writes NULL → DELETE, never 0.
function setTasteDot(friendId, categoryId, n) {
  const current = (_tasteOverrides[friendId] || {})[categoryId];
  const next = (current === n) ? null : n;   // tap current value → clear

  // Optimistic local update
  if (next === null) {
    if (_tasteOverrides[friendId]) delete _tasteOverrides[friendId][categoryId];
  } else {
    (_tasteOverrides[friendId] = _tasteOverrides[friendId] || {})[categoryId] = next;
  }
  renderTasteGrid();

  // Debounced persist (per cell, ~300 ms) — save-as-you-go without a round
  // trip on every intermediate tap.
  const key = friendId + '::' + categoryId;
  clearTimeout(_tasteSaveTimers[key]);
  _tasteSaveTimers[key] = setTimeout(() => {
    delete _tasteSaveTimers[key];
    upsertOverride(friendId, categoryId, next);
  }, TASTE_SAVE_DEBOUNCE_MS);
}

// Pick a value in the quant <select>.  Mirrors setTasteDot's state handling but
// keeps the null≠0 distinction: '' → null → DELETE (default), '0'..'5' → number
// (0 = mute).  No full re-render — the <select> already shows the chosen value,
// and re-rendering would drop focus mid-interaction; we only refresh the cell's
// muted styling.  Persist debounced (coalesces rapid changes; same pattern as
// the casual dots) through the shared upsertOverride write path.
function setTasteQuant(friendId, categoryId, raw) {
  const next = (raw === '') ? null : Number(raw);

  if (next === null) {
    if (_tasteOverrides[friendId]) delete _tasteOverrides[friendId][categoryId];
  } else {
    (_tasteOverrides[friendId] = _tasteOverrides[friendId] || {})[categoryId] = next;
  }

  const key = friendId + '::' + categoryId;
  clearTimeout(_tasteSaveTimers[key]);
  _tasteSaveTimers[key] = setTimeout(() => {
    delete _tasteSaveTimers[key];
    upsertOverride(friendId, categoryId, next);
  }, TASTE_SAVE_DEBOUNCE_MS);
}

function toggleShowAllCategories() {
  _showAllCategories = !_showAllCategories;
  renderTasteGrid();
}

// setAdvancedDetails (IT-049): the ONE place the global toggle is flipped.
// Updates the in-memory flag, re-renders the active bilingual surface (only the
// taste grid today; v0.6 score breakdowns join later), then persists the
// preference server-side via the own-row users UPDATE (same path as
// saveProfileSettings).  Optimistic: the UI flips immediately; a save failure
// only toasts (the flag stays flipped for this session).
async function setAdvancedDetails(on) {
  advancedDetails = !!on;

  const adv = document.getElementById('menu-advanced-toggle');
  if (adv) {
    adv.checked = advancedDetails;
    adv.closest('.user-menu-toggle')?.setAttribute('aria-checked', String(advancedDetails));
  }

  if (currentFriendsTab === 'taste') renderTasteGrid();

  const { error } = await supabaseClient
    .from('users')
    .update({ show_advanced_details: advancedDetails })
    .eq('id', currentUser.id);
  if (error) {
    console.error('[setAdvancedDetails]', error);
    showToast('Could not save that preference.');
  }
}
