//  RENDER CARDS (IT-085: "4b Richer / top take" card, one per place)
// ══════════════════════════════════════════════════

// The multicolour Google "G" mark, inlined as SVG so it needs no image
// request and scales with the text (IT-056 rating chip).
const GOOGLE_G_SVG = `<svg class="google-g" viewBox="0 0 18 18" width="11" height="11" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"/><path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"/></svg>`;
function renderCards() {
  const container = document.getElementById('cards-container');

  // First render can happen before the initial fetch resolves (the list is
  // now the landing screen, IT-093) — keep the spinner, don't flash empty.
  if (!placesLoaded) {
    container.innerHTML = '<div class="loading-spinner">Loading…</div>';
    return;
  }

  let places = Object.values(allPlaces);

  // Status filter (view tabs) — applied to takes, not the place itself
  if (currentView !== 'all') {
    places = places.filter(p => p.takes.some(t => {
      if (currentView === 'try')         return t.status === 'want-to-go';
      if (currentView === 'recommended') return t.status === 'been-recommend';
      if (currentView === 'no')          return t.status === 'been-skip';
      return true;
    }));
  }

  // Type filter — tags first (v0.4.0 Phase 6), place_type as fallback.
  // A place someone tagged 'bar' shows under Bars even if created as a
  // restaurant — the social layer overrides the creation-time binary.
  if (currentTypeFilter !== 'all') {
    places = places.filter(p =>
      (p.tags && p.tags[currentTypeFilter]) || p.placeType === currentTypeFilter);
  }

  // Lens filter (v0.4.0) — a relevance lens over already-RLS-filtered data,
  // not access control.  'circle' = places someone in my circle (me or an
  // accepted friend) has a take on; 'mine' = my takes; 'all' = every member.
  // _relationshipById comes from friends-service (loaded at sign-in).
  places = places.filter(p => {
    if (currentFilter === 'all')  return true;
    if (currentFilter === 'mine') return p.takes.some(t => t.userId === currentUser.id);
    return p.takes.some(t =>
      t.userId === currentUser.id || _relationshipById[t.userId] === 'friends');
  });

  document.getElementById('rec-count').textContent = places.length;

  if (!places.length) {
    container.innerHTML = emptyStateHTML();
    return;
  }

  // Sort: by aggregate rating, or by most-recent take timestamp
  if (currentSort === 'rating') {
    places.sort((a, b) => {
      if (b.aggregate.avgRating !== a.aggregate.avgRating) {
        return b.aggregate.avgRating - a.aggregate.avgRating;
      }
      return latestTakeTs(b) - latestTakeTs(a); // tie-break: newest first
    });
  } else {
    places.sort((a, b) => latestTakeTs(b) - latestTakeTs(a));
  }

  container.innerHTML = `<div class="cards-grid">${places.map(placeCardHTML).join('')}</div>`;
}

function latestTakeTs(place) {
  return Math.max(0, ...place.takes.map(t => t.ts || 0));
}

function updateFriendFilters() {
  // IT-002: Only "Everyone" and "Just Mine" filters are shown; no per-user chips.
}

// Empty state — "5b" from design/the-list.dc.html, message tuned to filters.
// The true first-run case doubles as the welcome/onboarding moment now that
// the Home hero is gone (IT-093, IT-096).
function emptyStateHTML() {
  let heading = 'Welcome to the Inner Table';
  let msg = 'This is your group\u2019s shared list of places to eat and drink \u2014 spots your inner circle loves or wants to try. Save the first place to get started.';
  if (currentView === 'try')              { heading = 'Nothing to try yet';     msg = 'No \u201cwant to try\u201d places match. Save one from the button below.'; }
  else if (currentView === 'recommended') { heading = 'No recommendations yet'; msg = 'Nobody\u2019s recommended a place here yet. Visit somewhere and rate it.'; }
  else if (currentFilter === 'mine')      { heading = 'Nothing of yours yet';   msg = 'You haven\u2019t added any places yet. Add one to get started.'; }
  else if (currentFilter === 'circle')    { heading = 'Your circle is quiet';   msg = 'Nobody in your circle has added a place yet. Find friends from the header, or switch the lens to Everyone.'; }
  else if (currentTypeFilter === 'restaurant') { heading = 'No restaurants here'; msg = 'No restaurants match these filters.'; }
  else if (currentTypeFilter === 'bar')        { heading = 'No bars here';        msg = 'No bars match these filters.'; }

  return `<div class="empty-state">
    <div class="table-mark"></div>
    <h3>${heading}</h3>
    <p>${msg}</p>
    <div class="empty-legend">
      <span class="micro-label">How the group marks places</span>
      <div class="empty-legend-chips">
        <span class="chip chip-try"><span class="chip-dot"></span>Want to Try</span>
        <span class="chip chip-rec"><span class="chip-dot"></span>Recommends</span>
        <span class="chip chip-pass"><span class="chip-dot"></span>Hard Pass</span>
      </div>
    </div>
  </div>`;
}


// ══════════════════════════════════════════════════
//  PLACE CARD — "4b Richer / top take" (IT-085)
//  Rows: name+chip · signal · hairline+top take · footer.
//  Everything below the signal expands into the Place Detail panel;
//  placeCardBodyHTML (below) is the detail-panel body.
// ══════════════════════════════════════════════════

// Overall place status → chip.  Any hard pass alongside a recommend = Mixed.
function placeStatus(place) {
  const { recommends, hardPasses, wantsToGo } = place.aggregate;
  if (recommends.length && hardPasses.length) return 'mixed';
  if (recommends.length)                      return 'rec';
  if (hardPasses.length)                      return 'pass';
  if (wantsToGo.length)                       return 'try';
  return null;
}

function statusChipHTML(status) {
  if (status === 'rec')   return `<span class="chip chip-rec"><span class="chip-dot"></span>Recommended</span>`;
  if (status === 'try')   return `<span class="chip chip-try"><span class="chip-dot"></span>Want to Try</span>`;
  if (status === 'pass')  return `<span class="chip chip-pass"><span class="chip-dot"></span>Hard Pass</span>`;
  if (status === 'mixed') return `<span class="chip chip-mixed">Mixed</span>`;
  return '';
}

// Muted dot-string: Restaurant · cuisine · price · neighborhood
function placeMetaLine(place) {
  return [
    place.placeType === 'bar' ? 'Bar' : 'Restaurant',
    place.cuisine,
    place.price,
    place.location
  ].filter(Boolean).map(esc).join(' · ');
}

// Avatar stack (26px, paper border, -8px overlap) for up to `max` authors.
function avatarStackHTML(names, max = 3) {
  return `<div class="avatar-stack">${names.slice(0, max).map(n =>
    `<span class="stack-avatar ${getUserColor(n)}">${esc((n || '?').slice(0, 2).toUpperCase())}</span>`
  ).join('')}</div>`;
}

// The 1-second read: who's behind this place, in one line.
function signalHTML(place, status) {
  const { recommends, hardPasses, wantsToGo } = place.aggregate;
  let names = [], text = '';

  if (status === 'rec') {
    names = recommends;
    const shown = recommends.slice(0, 2).map(esc).join(', ');
    const extra = recommends.length - 2;
    text = `${shown} <span class="signal-muted">${extra > 0 ? `+${extra} ` : ''}recommend</span>`;
  } else if (status === 'mixed') {
    names = [...recommends, ...hardPasses];
    text = `${recommends.length} recommend · <span class="pass-text">${hardPasses.length} passed</span>`;
  } else if (status === 'pass') {
    names = hardPasses;
    text = `<span class="pass-text">${hardPasses.length} passed</span>`;
  } else if (status === 'try') {
    names = wantsToGo;
    text = wantsToGo.length === 1
      ? `${esc(wantsToGo[0])} wants to try`
      : `${wantsToGo.length} friends want to try`;
  } else {
    return '';
  }

  // Friend-group rating in clay; degrade to muted Google aggregate when
  // nobody in the circle has been (IT-056 cache table).
  let rating = '';
  if (place.aggregate.avgRating > 0) {
    rating = `<span class="pc-rating" title="${place.aggregate.ratingsCount} rating${place.aggregate.ratingsCount !== 1 ? 's' : ''}">★ ${place.aggregate.avgRating.toFixed(1)}</span>`;
  } else if (place.external?.rating) {
    // Same G-mark treatment as the detail panel (IT-099).
    rating = `<span class="pc-rating google" title="Google rating, cached">${GOOGLE_G_SVG} ${place.external.rating.toFixed(1)}</span>`;
  }

  return `<div class="pc-signal">
    <div class="pc-signal-left">
      ${avatarStackHTML(names)}
      <span class="pc-signal-text">${text}</span>
    </div>
    ${rating}
  </div>`;
}

// Pick the ONE take worth surfacing: prefer been-takes with a note,
// then higher rating, then most recent.
function topTake(place) {
  const beenTakes = place.takes.filter(t => t.status !== 'want-to-go');
  if (!beenTakes.length) return null;
  return [...beenTakes].sort((a, b) =>
    (!!b.notes - !!a.notes) || ((b.rating || 0) - (a.rating || 0)) || ((b.ts || 0) - (a.ts || 0))
  )[0];
}

function topTakeHTML(place) {
  const take = topTake(place);
  if (!take) {
    return `<div class="pc-toptake pc-nobody">Nobody\u2019s been yet \u2014 be the first to try it.</div>`;
  }

  const verdict = take.status === 'been-skip'
    ? `<span class="minichip-pass"><span class="chip-dot"></span>Hard Pass</span>`
    : (take.rating > 0 ? `<span class="pc-take-star">★ ${take.rating.toFixed(1)}</span>` : '');

  const note = take.notes ? `<div class="pc-take-note">\u201c${esc(take.notes)}\u201d</div>` : '';

  return `<div class="pc-toptake" onclick="openPlaceDetail('${place.id}')">
    <span class="take-avatar ${getUserColor(take.author)}">${esc((take.author || '?').slice(0, 2).toUpperCase())}</span>
    <div class="pc-take-body">
      <div class="pc-take-head">
        <span class="pc-take-author">${esc(take.author)}</span>
        ${verdict}
      </div>
      ${note}
    </div>
  </div>`;
}

function cardFooterHTML(place) {
  const myTake     = place.takes.find(t => t.userId === currentUser.id);
  const nobodyBeen = !place.takes.some(t => t.status !== 'want-to-go');

  let cta;
  if (myTake) {
    cta = `<button class="pc-cta outline" onclick="editEntry('${myTake.entryId}')">Edit your take</button>`;
  } else if (nobodyBeen) {
    cta = `<button class="pc-cta filled" onclick="addTakeForPlace('${place.id}')">I\u2019ve been \u2014 add a take</button>`;
  } else {
    cta = `<button class="pc-cta outline" onclick="addTakeForPlace('${place.id}')">+ Add your take</button>`;
  }

  const count = place.comments.filter(c => !c.deleted).length;
  const label = count ? `${count} comment${count !== 1 ? 's' : ''}` : 'Comment';

  return `<div class="pc-footer">
    ${cta}
    <button class="pc-comments" onclick="openPlaceDetail('${place.id}')">
      <span class="bubble"></span>${label} <span class="chev">›</span>
    </button>
  </div>`;
}

function placeCardHTML(place) {
  const status = placeStatus(place);
  // Chevron after the name signals the title is tappable (IT-095).
  return `
    <div class="place-card">
      <div class="pc-top">
        <div class="pc-title" onclick="openPlaceDetail('${place.id}')" role="button" tabindex="0"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlaceDetail('${place.id}')}">
          <div class="pc-name">${esc(place.name)}<span class="pc-name-chev" aria-hidden="true">›</span></div>
          <div class="pc-meta">${placeMetaLine(place)}</div>
        </div>
        ${statusChipHTML(status)}
      </div>
      ${signalHTML(place, status)}
      ${topTakeHTML(place)}
      ${cardFooterHTML(place)}
    </div>`;
}


// ══════════════════════════════════════════════════
//  PLACE DETAIL BODY
//  Full takes stack + shared comment thread, rendered into the detail panel.
// ══════════════════════════════════════════════════
function placeCardBodyHTML(place) {
  const meta = `
    <div class="card-meta">
      <span class="tag">${place.placeType === 'bar' ? 'Bar' : 'Restaurant'}</span>
      ${place.cuisine  ? `<span class="tag">${esc(place.cuisine)}</span>` : ''}
      ${place.price    ? `<span class="tag">${esc(place.price)}</span>`   : ''}
      ${place.location ? `<a class="tag" href="${buildMapsUrl({ placeId: place.googlePlaceId, name: place.name, location: place.location })}" target="_blank" rel="noopener">${esc(place.location)} ↗</a>` : ''}
    </div>
    ${userTagsHTML(place)}`;

  const takesStack = place.takes.length
    ? `<div class="takes-stack">${place.takes.map(t => takeRowHTML(place, t)).join('')}</div>`
    : '';

  // (userTagsHTML is defined below, near the other card-section helpers.)

  // "Add your take" CTA — only when the current user has no take here.
  // Opens the add flow prefilled with this place (place fields locked).
  const hasMyTake = place.takes.some(t => t.userId === currentUser.id);
  const addTakeCta = hasMyTake ? '' : `
    <div class="add-your-take-cta">
      <button class="pc-cta outline" onclick="addTakeForPlace('${place.id}')">+ Add your take</button>
    </div>`;

  return `
    ${meta}
    ${aggregateRowHTML(place)}
    ${takesStack}
    ${addTakeCta}
    ${commentsSectionHTML(place)}`;
}

function aggregateRowHTML(place) {
  const agg = place.aggregate;
  const bits = [];
  if (agg.ratingsCount > 0) {
    bits.push(`<span class="agg-star">★ ${agg.avgRating.toFixed(1)}</span> (${agg.ratingsCount} rating${agg.ratingsCount !== 1 ? 's' : ''})`);
  }
  // IT-056: Google's aggregate (from our cache table) — the fallback signal
  // when the friend circle is sparse.
  if (place.external?.rating) {
    const count = place.external.ratingCount
      ? ` (${place.external.ratingCount.toLocaleString()})` : '';
    bits.push(`<span class="google-agg" title="Google rating, cached">${GOOGLE_G_SVG} ${place.external.rating.toFixed(1)}${count}</span>`);
  }
  if (agg.recommends.length) bits.push(`Recommended by ${agg.recommends.map(esc).join(', ')}`);
  if (agg.hardPasses.length) bits.push(`Hard pass from ${agg.hardPasses.map(esc).join(', ')}`);
  if (agg.wantsToGo.length)  bits.push(`${agg.wantsToGo.map(esc).join(', ')} want${agg.wantsToGo.length === 1 ? 's' : ''} to go`);
  if (!bits.length) return '';
  // (bits with HTML are pre-escaped above; author names go through esc())
  return `<div class="aggregate-row">${bits.join(' · ')}</div>`;
}

function takeRowHTML(place, t) {
  const isMine   = currentUser?.is_admin || t.userId === currentUser.id;
  const color    = getUserColor(t.author);
  const initials = (t.author || '?').slice(0, 2).toUpperCase();
  const date     = t.ts ? new Date(t.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  const chipMap = {
    'been-recommend': `<span class="take-status-chip recommended">Recommends</span>`,
    'been-skip':      `<span class="take-status-chip hard-pass">Hard Pass</span>`,
    'want-to-go':     `<span class="take-status-chip want-to-try">Want to Try</span>`
  };
  const chip = chipMap[t.status] || '';

  let stars = '';
  if (t.rating > 0) {
    const fr = t.factorRatings || {};
    const factorTip = ['quality', 'service', 'value', 'ambiance']
      .filter(f => fr[f] > 0)
      .map(f => `${f.charAt(0).toUpperCase() + f.slice(1)}: ${fr[f]}`)
      .join(' · ');
    stars = `<span class="take-stars"${factorTip ? ` title="${factorTip}"` : ''}>${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</span>`;
  }

  const note = t.status === 'want-to-go'
    ? (t.tryNote ? `<div class="take-note">${esc(t.tryNote)}</div>` : '')
    : (t.notes   ? `<div class="take-note">${esc(t.notes)}</div>`   : '');

  const url = (t.status === 'want-to-go' && t.url)
    ? `<div class="card-url"><a href="${esc(t.url)}" target="_blank" rel="noopener">See review ↗</a></div>`
    : '';

  const actions = isMine ? `
    <div class="take-actions">
      <button class="card-btn" onclick="editEntry('${t.entryId}')">Edit</button>
      <button class="card-btn danger" onclick="deleteEntry('${t.entryId}')">Delete</button>
    </div>` : '';

  return `
    <div class="take-row">
      <div class="avatar-sm ${color}">${initials}</div>
      <div class="take-meta">
        <span class="take-author">${esc(t.author)}${t.userId === currentUser.id ? ' (you)' : ''}</span>
        <span class="take-date">${date}</span>
        <div class="take-status-line">${chip}${stars}</div>
        ${note}
        ${url}
        ${actions}
      </div>
    </div>`;
}


// ══════════════════════════════════════════════════
//  COMMENTS (one shared thread per place)
// ══════════════════════════════════════════════════
// Render comment text with @-mentions wrapped in styled chips.
// Matching is case-insensitive against known display names (stored text is
// untouched — see IT-035 plan, resolved decision #2). Unknown @names render
// as plain text so a stray email address doesn't turn into a chip.
function renderCommentText(text) {
  const known = new Set(Object.values(_userIdToName).filter(Boolean).map(n => n.toLowerCase()));
  return esc(text).replace(/@([a-zA-Z0-9_-]+)/g, (full, name) =>
    known.has(name.toLowerCase()) ? `<span class="mention" title="@${name}">@${name}</span>` : full
  );
}

function commentsSectionHTML(place) {
  const id = place.id;
  const commentsList = place.comments.length ? `<div class="comments-list">${place.comments.map(c => {
    if (c.deleted) {
      return `<div class="comment-item"><div class="comment-body"><span class="comment-deleted">Comment deleted.</span></div></div>`;
    }
    const cc = getUserColor(c.author);
    const ci = (c.author || '?').slice(0, 2).toUpperCase();
    const cd = c.ts ? new Date(c.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const isMyComment = c.authorId === currentUser.id;
    const editActions = `<div class="comment-edit-actions">
      <button class="comment-action-btn" onclick="startQuoteReply('${id}','${c.id}')">Reply</button>${isMyComment ? `
      <button class="comment-action-btn" onclick="startEditComment('${id}','${c.id}')">Edit</button>
      <button class="comment-action-btn danger" onclick="deleteComment('${id}','${c.id}')">Delete</button>` : ''}
    </div>`;
    // Reaction pills — click to view who reacted
    const reactionPills = Object.entries(c.reactions || {}).map(([emoji, users]) => {
      const decodedEmoji = decodeURIComponent(emoji);
      const voters = Object.keys(users).filter(u => users[u]);
      if (!voters.length) return '';
      const mine = voters.includes(currentUser.display_name);
      return `<button class="reaction-pill${mine ? ' mine' : ''}" onclick="showReactionViewers(this,'${id}','${c.id}')" title="Click to see who reacted">${decodedEmoji} <span class="reaction-count">${voters.length}</span></button>`;
    }).join('');
    const reactionsHtml = `<div class="comment-reactions">${reactionPills}<button class="reaction-add-btn" onclick="showReactionPicker(this,'${id}','${c.id}')" title="Add a reaction">＋ 😊</button></div>`;
    // Quote block (comment is a reply)
    const quotedHtml = c.quotedCommentId ? `
      <div class="comment-quote">
        <div class="comment-quote-author">${esc(c.quotedAuthor || '')}</div>
        <div class="comment-quote-text">${esc(c.quotedText || '')}</div>
      </div>` : '';
    return `<div class="comment-item">
      <div class="avatar-sm ${cc}">${ci}</div>
      <div class="comment-body">
        <span class="comment-author">${esc(c.author)}</span><span class="comment-date">${cd}</span>
        <div id="cv-${id}-${c.id}">
          ${quotedHtml}
          <span class="comment-text">${renderCommentText(c.text)}</span>
          ${editActions}
        </div>
        <div class="comment-edit-form" id="cef-${id}-${c.id}" style="display:none">
          <textarea class="comment-input" id="cet-${id}-${c.id}" rows="2" maxlength="300">${esc(c.text)}</textarea>
          <div class="comment-actions">
            <button class="comment-submit" onclick="saveCommentEdit('${id}','${c.id}',this)">Save</button>
            <button class="comment-cancel" onclick="cancelEditComment('${id}','${c.id}')">Cancel</button>
          </div>
        </div>
        ${reactionsHtml}
      </div>
    </div>`;
  }).join('')}</div>` : '';

  const visibleCount = place.comments.filter(c => !c.deleted).length;
  const commentLabel = visibleCount ? `${visibleCount} comment${visibleCount !== 1 ? 's' : ''}` : 'Add a comment';
  return `<div class="card-comments">
    ${commentsList}
    <div class="comment-form" id="cf-${id}">
      <div class="quote-preview-holder" id="quote-preview-${id}" style="display:none"></div>
      <textarea class="comment-input" id="ci-${id}" placeholder="Add a comment… (@ to mention)" rows="2" maxlength="300"></textarea>
      <div class="comment-actions">
        <button class="comment-submit" onclick="submitComment('${id}',this)">Post</button>
        <button class="comment-cancel" onclick="toggleCommentForm('${id}')">Cancel</button>
      </div>
    </div>
    <button class="card-btn" onclick="toggleCommentForm('${id}')">${commentLabel}</button>
  </div>`;
}


// ══════════════════════════════════════════════════
//  USER TAGS (v0.4.0 Phase 6 — multi-author classification)
//  Aggregated chips: "date spot ×3".  Your own tags show a remove ×;
//  the add row writes through places-service addPlaceTag.
//  data-tag carries the value so quotes in tags can't break the handler.
// ══════════════════════════════════════════════════
function userTagsHTML(place) {
  const entries = Object.entries(place.tags || {});
  const chips = entries.map(([tag, info]) => `
    <span class="tag user-tag${info.mine ? ' mine' : ''}">
      ${esc(tag)}${info.count > 1 ? `<span class="tag-count">×${info.count}</span>` : ''}
      ${info.mine ? `<button class="tag-remove" title="Remove your tag"
        data-tag="${esc(tag)}" onclick="removePlaceTag('${place.id}', this.dataset.tag)">×</button>` : ''}
    </span>`).join('');

  return `
    <div class="user-tags-row">
      ${chips}
      <span class="tag tag-add">
        <input class="tag-add-input" id="tag-input-${place.id}" type="text"
               maxlength="30" placeholder="+ tag"
               onkeydown="if(event.key==='Enter'){event.preventDefault();addPlaceTag('${place.id}', this.value, this);}"
               onclick="event.stopPropagation()" />
      </span>
    </div>`;
}


// ══════════════════════════════════════════════════
//  PLACE DETAIL PANEL (from cards + map)
// ══════════════════════════════════════════════════
function openPlaceDetail(id) {
  const place = allPlaces[id];
  if (!place) return;

  document.getElementById('detail-panel-title').textContent = place.name;
  document.getElementById('detail-panel-content').innerHTML = placeCardBodyHTML(place);
  document.getElementById('place-detail-overlay').classList.add('open');
}

function closeDetailPanel() {
  document.getElementById('place-detail-overlay').classList.remove('open');
}

function closeDetailOnBg(e) {
  if (e.target === document.getElementById('place-detail-overlay')) closeDetailPanel();
}

// ══════════════════════════════════════════════════
