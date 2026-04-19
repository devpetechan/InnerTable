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
    .addEventListener('click', submitRec);

  // ── Attach step ───────────────────────────────────
  document.getElementById('atc-been')
    .addEventListener('click', () => setAttachExperience('been'));
  document.getElementById('atc-try')
    .addEventListener('click', () => setAttachExperience('try'));

  document.querySelectorAll('#attach-star-picker span')
    .forEach((span, i) => span.addEventListener('click', () => setAttachStars(i + 1)));

  document.getElementById('abtn-go-now')
    .addEventListener('click', () => setAttachGoNowOrHardPass('been-recommend'));
  document.getElementById('abtn-hard-pass')
    .addEventListener('click', () => setAttachGoNowOrHardPass('been-skip'));

  ['quality', 'service', 'value', 'ambiance'].forEach(factor => {
    document.querySelectorAll(`#afp-${factor} span`)
      .forEach((span, i) => span.addEventListener('click', () => setAttachFactorStar(factor, i + 1)));
  });

  document.getElementById('attach-submit-btn')
    .addEventListener('click', submitAttach);

  // ── Duplicate prompt ──────────────────────────────
  document.getElementById('dup-overlay')
    .addEventListener('click', closeDupOnBg);

  document.querySelector('#dup-overlay .btn-close')
    .addEventListener('click', closeDupPrompt);

  document.getElementById('dup-primary-btn')
    .addEventListener('click', confirmDup);

  document.querySelector('#dup-overlay .btn-ghost')
    .addEventListener('click', closeDupPromptAndContinue);

  // ── Place detail panel ────────────────────────────
  document.getElementById('place-detail-overlay')
    .addEventListener('click', closeDetailOnBg);

  document.querySelector('#place-detail-panel .btn-close')
    .addEventListener('click', closeDetailPanel);

});
