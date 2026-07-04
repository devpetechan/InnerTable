// ══════════════════════════════════════════════════
//  UI EVENTS
//  All static event listeners for index.html elements.
//  Dynamically generated card/comment handlers remain
//  in app.js until Step 4 modularisation.
// ══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {

  // ── Header ────────────────────────────────────────
  document.querySelector('.header-logo')
    .addEventListener('click', goHome);

  document.querySelector('.user-chip')
    .addEventListener('click', signOut);

  // ── Home CTAs ─────────────────────────────────────
  const homeBtns = document.querySelectorAll('.home-cta-btn');
  homeBtns[0].addEventListener('click', () => navigateToList('all'));
  homeBtns[1].addEventListener('click', () => navigateToList('restaurant'));
  homeBtns[2].addEventListener('click', () => navigateToList('bar'));
  homeBtns[3].addEventListener('click', openModal);

  // ── View tabs (event delegation — data-view attr) ─
  document.querySelector('.view-tabs')
    .addEventListener('click', e => {
      const tab = e.target.closest('.view-tab');
      if (tab) setView(tab.dataset.view, tab);
    });

  // ── Display mode toggle ───────────────────────────
  document.getElementById('mode-list')
    .addEventListener('click', () => setDisplayMode('list'));
  document.getElementById('mode-map')
    .addEventListener('click', () => setDisplayMode('map'));

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

  // ── Add/Edit modal ────────────────────────────────
  document.getElementById('modal-overlay')
    .addEventListener('click', closeModalOnBg);

  document.querySelector('#modal-overlay .btn-close')
    .addEventListener('click', closeModal);

  // Name input — enable/disable submit button
  document.getElementById('f-name')
    .addEventListener('input', updateSubmitBtn);

  // Place type toggle
  document.getElementById('tog-restaurant')
    .addEventListener('click', () => setPlaceType('restaurant'));
  document.getElementById('tog-bar')
    .addEventListener('click', () => setPlaceType('bar'));

  // Experience toggle (I've Been / Want to Try)
  document.getElementById('exp-been')
    .addEventListener('click', () => setBeenOrTry('been'));
  document.getElementById('exp-try')
    .addEventListener('click', () => setBeenOrTry('try'));

  // Overall star picker
  document.querySelectorAll('#star-picker span')
    .forEach((span, i) => span.addEventListener('click', () => setStars(i + 1)));

  // Go Now / Hard Pass
  document.getElementById('btn-go-now')
    .addEventListener('click', () => setGoNowOrHardPass('been-recommend'));
  document.getElementById('btn-hard-pass')
    .addEventListener('click', () => setGoNowOrHardPass('been-skip'));

  // Factor star pickers
  ['quality', 'service', 'value', 'ambiance'].forEach(factor => {
    document.querySelectorAll(`#fp-${factor} span`)
      .forEach((span, i) => span.addEventListener('click', () => setFactorStar(factor, i + 1)));
  });

  // Main submit button
  document.getElementById('submit-btn')
    .addEventListener('click', submitEntry);

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
