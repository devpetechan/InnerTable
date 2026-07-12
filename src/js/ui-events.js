// ══════════════════════════════════════════════════
//  UI EVENTS
//  All static event listeners for index.html elements.
//  Dynamically generated card/comment handlers remain
//  inline (onclick) in ui-render.js.
// ══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {

  // ── Header ────────────────────────────────────────
  document.querySelector('.header-logo')
    .addEventListener('click', goHome);

  // IT-106: the user chip opens the account menu (settings / sign out)
  // instead of signing out directly.
  document.querySelector('.user-chip')
    .addEventListener('click', toggleUserMenu);
  document.getElementById('menu-signout')
    .addEventListener('click', signOut);
  document.getElementById('menu-settings')
    .addEventListener('click', openProfileSettings);
  document.getElementById('settings-close')
    .addEventListener('click', closeProfileSettings);
  document.getElementById('settings-save')
    .addEventListener('click', saveProfileSettings);
  document.getElementById('settings-overlay')
    .addEventListener('click', e => {
      if (e.target === document.getElementById('settings-overlay')) closeProfileSettings();
    });

  // ── Friends screen (v0.4.0) ───────────────────────
  document.getElementById('friends-btn')
    .addEventListener('click', showFriendsScreen);

  // Subview tabs (event delegation — data-ftab attr)
  document.getElementById('friends-tabs')
    .addEventListener('click', e => {
      const tab = e.target.closest('.view-tab');
      if (tab) switchFriendsTab(tab.dataset.ftab, tab);
    });

  // Debounced friend search
  document.getElementById('friend-search-input')
    .addEventListener('input', onFriendSearchInput);

  // ── Segmented status control (event delegation — data-view attr) ─
  document.querySelector('.view-tabs')
    .addEventListener('click', e => {
      const tab = e.target.closest('.view-tab');
      if (tab) setView(tab.dataset.view, tab);
    });

  // ── List | Map toggle ─────────────────────────────
  document.getElementById('mode-list')
    .addEventListener('click', () => setDisplayMode('list'));
  document.getElementById('mode-map')
    .addEventListener('click', () => setDisplayMode('map'));

  // ── Filter & sort pill (IT-086 — reveals the chip rows; the designed
  //    sheet is an explicit follow-up ticket) ────────
  document.getElementById('filter-sort-btn')
    .addEventListener('click', toggleFilterSort);

  // ── Friend filter chips (event delegation) ────────
  document.getElementById('friend-filter-bar')
    .addEventListener('click', e => {
      const chip = e.target.closest('.filter-chip');
      if (chip) setFilter(chip.dataset.filter, chip);
    });

  // ── Type filter chips (event delegation) ──────────
  document.getElementById('type-filter-bar')
    .addEventListener('click', e => {
      const chip = e.target.closest('.filter-chip');
      if (chip) setTypeFilter(chip.dataset.type, chip);
    });

  // ── Sort chips (event delegation) ─────────────────
  document.getElementById('sort-filter-bar')
    .addEventListener('click', e => {
      const chip = e.target.closest('.filter-chip');
      if (chip) setSort(chip.dataset.sort, chip);
    });

  // ── FAB ───────────────────────────────────────────
  document.getElementById('add-place-fab')
    .addEventListener('click', openModal);

  // ══════════════════════════════════════════════════
  //  ADD/EDIT FLOW (IT-087 "6b Guided multi-step")
  // ══════════════════════════════════════════════════
  document.getElementById('modal-overlay')
    .addEventListener('click', closeModalOnBg);

  // Header: Cancel (first step) / ‹ back (later steps)
  document.getElementById('flow-back-btn')
    .addEventListener('click', flowBack);

  // Sticky footer primary — Next / Save to Want to Try / Share take
  document.getElementById('submit-btn')
    .addEventListener('click', flowPrimaryAction);

  // ── Step 1 · Place ────────────────────────────────
  document.getElementById('f-name')
    .addEventListener('input', updateFlowUI);
  document.getElementById('f-name')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); flowPrimaryAction(); }
    });

  document.getElementById('tog-restaurant')
    .addEventListener('click', () => setPlaceType('restaurant'));
  document.getElementById('tog-bar')
    .addEventListener('click', () => setPlaceType('bar'));

  // ── Step 2 · Intent ───────────────────────────────
  // Mini-card Edit → back to step 1 (hidden when the place is locked)
  document.getElementById('minicard-edit')
    .addEventListener('click', () => goToStep(1));

  // Intent cards.  Clicks inside the expanded note fields of the
  // want-to-try card must not re-fire selection.
  document.getElementById('intent-try')
    .addEventListener('click', e => {
      if (e.target.closest('input, textarea, label')) return;
      setIntent('try');
    });
  document.getElementById('intent-try')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIntent('try');
      }
    });
  document.getElementById('intent-been')
    .addEventListener('click', () => setIntent('been'));
  document.getElementById('intent-been')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIntent('been');
      }
    });

  // ── Step 3 · Review ───────────────────────────────
  document.querySelectorAll('#star-picker span')
    .forEach((span, i) => span.addEventListener('click', () => setStars(i + 1)));

  document.getElementById('btn-go-now')
    .addEventListener('click', () => setGoNowOrHardPass('been-recommend'));
  document.getElementById('btn-hard-pass')
    .addEventListener('click', () => setGoNowOrHardPass('been-skip'));

  // Dashed disclosure — cuisine, price & detailed ratings
  document.getElementById('details-disclosure')
    .addEventListener('click', toggleDetails);

  // Price segmented control
  document.querySelectorAll('#price-seg .seg-btn')
    .forEach(btn => btn.addEventListener('click', () => setPrice(btn.dataset.price)));

  // Sub-rating star pickers
  ['quality', 'service', 'value', 'ambiance'].forEach(factor => {
    document.querySelectorAll(`#fp-${factor} span`)
      .forEach((span, i) => span.addEventListener('click', () => setFactorStar(factor, i + 1)));
  });

  // ── Place detail panel ────────────────────────────
  document.getElementById('place-detail-overlay')
    .addEventListener('click', closeDetailOnBg);

  document.querySelector('#place-detail-panel .btn-close')
    .addEventListener('click', closeDetailPanel);

  // ── @-mention autocomplete (IT-035 Phase 5) ───────
  // Comment textareas are re-created on every render, so we use one
  // DELEGATED listener plus a single shared dropdown element, instead of
  // attaching per-textarea. Works in cards and the map detail panel alike.
  initMentionAutocomplete();

});

function initMentionAutocomplete() {
  const dropdown = document.createElement('ul');
  dropdown.className = 'mention-dropdown';
  document.body.appendChild(dropdown);

  let activeTextarea = null;

  const hide = () => { dropdown.style.display = 'none'; activeTextarea = null; };

  // Typing in any comment textarea → maybe show candidates
  document.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea.comment-input');
    if (!ta) return;

    const before = ta.value.slice(0, ta.selectionStart);
    const match  = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (!match) { hide(); return; }

    const partial = match[1].toLowerCase();
    const candidates = Object.values(_userIdToName)
      .filter(Boolean)
      .filter(n => n.toLowerCase().startsWith(partial))
      .slice(0, 5);
    if (!candidates.length) { hide(); return; }

    dropdown.innerHTML = candidates
      .map(n => `<li data-name="${esc(n)}">${esc(n)}</li>`).join('');

    // Anchor the dropdown just below the textarea
    const r = ta.getBoundingClientRect();
    dropdown.style.left    = (r.left + window.scrollX) + 'px';
    dropdown.style.top     = (r.bottom + window.scrollY + 2) + 'px';
    dropdown.style.display = 'block';
    activeTextarea = ta;
  });

  // Click a candidate → replace the partial @name and refocus
  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep the textarea focused
    const li = e.target.closest('li');
    if (!li || !activeTextarea) return;
    const ta = activeTextarea;
    const cursor = ta.selectionStart;
    const before = ta.value.slice(0, cursor).replace(/@[a-zA-Z0-9_-]*$/, '@' + li.dataset.name + ' ');
    ta.value = before + ta.value.slice(cursor);
    ta.setSelectionRange(before.length, before.length);
    ta.focus();
    hide();
  });

  // Dismiss on blur, Escape, or scroll
  document.addEventListener('focusout', (e) => {
    if (e.target === activeTextarea) setTimeout(hide, 150);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('scroll', hide, true);
}
