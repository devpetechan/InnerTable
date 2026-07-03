//  RENDER CARDS (IT-035: one card per place, takes stacked inside)
// ══════════════════════════════════════════════════
function renderCards() {
  const container = document.getElementById('cards-container');
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

  // Type filter
  if (currentTypeFilter !== 'all') {
    places = places.filter(p => p.placeType === currentTypeFilter);
  }

  // Author filter — show only places where the chosen author has a take
  places = places.filter(p => {
    if (currentFilter === 'all')  return true;
    if (currentFilter === 'mine') return p.takes.some(t => t.author === currentUser.display_name);
    return p.takes.some(t => t.author === currentFilter);
  });

  document.getElementById('rec-count').textContent = places.length;

  if (!places.length) {
    let emptyMsg = 'Nothing here yet — be the first to add a spot!';
    if (currentView === 'try') emptyMsg = 'No "want to try" places yet. Add one from the + button!';
    else if (currentView === 'recommended') emptyMsg = 'No recommended places yet. Visit somewhere and rate it!';
    else if (currentFilter === 'mine') emptyMsg = "You haven't added any places yet. Tap + Add Place to get started.";
    else if (currentTypeFilter === 'restaurant') emptyMsg = 'No restaurants match these filters.';
    else if (currentTypeFilter === 'bar') emptyMsg = 'No bars match these filters.';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🍜</div><p>${emptyMsg}</p></div>`;
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


// ══════════════════════════════════════════════════
//  PLACE CARD
//  placeCardBodyHTML is shared between the list card and the detail panel.
// ══════════════════════════════════════════════════
function placeCardHTML(place) {
  return `
    <div class="rec-card">
      <div class="card-top">
        <div class="card-name">${esc(place.name)}</div>
        ${aggregateStarsHTML(place)}
      </div>
      ${placeCardBodyHTML(place)}
    </div>`;
}

function aggregateStarsHTML(place) {
  const { avgRating, ratingsCount } = place.aggregate;
  if (avgRating <= 0) return '';
  const stars = '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating));
  return `<div class="stars" title="${avgRating.toFixed(1)} avg (${ratingsCount} rating${ratingsCount !== 1 ? 's' : ''})">${stars}</div>`;
}

function placeCardBodyHTML(place) {
  const typeTag = place.placeType === 'bar'
    ? `<span class="tag type-bar">🍸 Bar</span>`
    : `<span class="tag type-restaurant">🍽 Restaurant</span>`;

  const meta = `
    <div class="card-meta">
      ${typeTag}
      ${place.cuisine  ? `<span class="tag cuisine">${esc(place.cuisine)}</span>` : ''}
      ${place.price    ? `<span class="tag price">${esc(place.price)}</span>`     : ''}
      ${place.location ? `<a class="tag" href="${buildMapsUrl({ placeId: place.googlePlaceId, name: place.name, location: place.location })}" target="_blank" rel="noopener" style="text-decoration:none;">📍 ${esc(place.location)}</a>` : ''}
    </div>`;

  const takesStack = place.takes.length
    ? `<div class="takes-stack">${place.takes.map(t => takeRowHTML(place, t)).join('')}</div>`
    : '';

  // "Add your take" CTA — only when the current user has no take here.
  // Opens the modal prefilled with this place (place fields locked).
  const hasMyTake = place.takes.some(t => t.userId === currentUser.id);
  const addTakeCta = hasMyTake ? '' : `
    <div class="add-your-take-cta">
      <button class="card-btn primary-action" onclick="addTakeForPlace('${place.id}')">➕ Add your take</button>
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
    bits.push(`★ ${agg.avgRating.toFixed(1)} (${agg.ratingsCount} rating${agg.ratingsCount !== 1 ? 's' : ''})`);
  }
  if (agg.recommends.length) bits.push(`✅ Recommended by ${agg.recommends.map(esc).join(', ')}`);
  if (agg.hardPasses.length) bits.push(`🚫 Hard pass from ${agg.hardPasses.map(esc).join(', ')}`);
  if (agg.wantsToGo.length)  bits.push(`📌 ${agg.wantsToGo.map(esc).join(', ')} want${agg.wantsToGo.length === 1 ? 's' : ''} to go`);
  if (!bits.length) return '';
  return `<div class="aggregate-row">${bits.join(' · ')}</div>`;
}

function takeRowHTML(place, t) {
  const isMine   = currentUser?.is_admin || t.userId === currentUser.id;
  const color    = getUserColor(t.author);
  const initials = (t.author || '?').slice(0, 2).toUpperCase();
  const date     = t.ts ? new Date(t.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  const chipMap = {
    'been-recommend': `<span class="take-status-chip recommended">✅ Recommends</span>`,
    'been-skip':      `<span class="take-status-chip hard-pass">🚫 Hard Pass</span>`,
    'want-to-go':     `<span class="take-status-chip want-to-try">📌 Want to Try</span>`
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
    ? `<div class="card-url"><a href="${esc(t.url)}" target="_blank" rel="noopener">🔗 See review</a></div>`
    : '';

  // Edit/Delete call app.js handlers by entry id — rewired in Phase 4.
  const actions = isMine ? `
    <div class="take-actions">
      <button class="card-btn" onclick="editEntry('${t.entryId}')">✏️ Edit</button>
      <button class="card-btn danger" onclick="deleteEntry('${t.entryId}')">🗑 Delete</button>
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
//  Write path (submitComment) is rewired in Phase 5; edit/delete/reactions
//  already operate on comment uuids and keep working.
// ══════════════════════════════════════════════════
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
    const editActions = isMyComment ? `<div class="comment-edit-actions">
      <button class="comment-action-btn" onclick="startEditComment('${id}','${c.id}')">Edit</button>
      <button class="comment-action-btn danger" onclick="deleteComment('${id}','${c.id}')">Delete</button>
    </div>` : '';
    // Reaction pills — click to view who reacted
    const reactionPills = Object.entries(c.reactions || {}).map(([emoji, users]) => {
      const decodedEmoji = decodeURIComponent(emoji);
      const voters = Object.keys(users).filter(u => users[u]);
      if (!voters.length) return '';
      const mine = voters.includes(currentUser.display_name);
      return `<button class="reaction-pill${mine ? ' mine' : ''}" onclick="showReactionViewers(this,'${id}','${c.id}')" title="Click to see who reacted">${decodedEmoji} <span class="reaction-count">${voters.length}</span></button>`;
    }).join('');
    const reactionsHtml = `<div class="comment-reactions">${reactionPills}<button class="reaction-add-btn" onclick="showReactionPicker(this,'${id}','${c.id}')" title="Add a reaction">＋ 😊</button></div>`;
    // Quote block (comment is a reply) — full styling lands in Phase 5
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
          <span class="comment-text">${esc(c.text)}</span>
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
  const commentLabel = visibleCount ? `💬 ${visibleCount} comment${visibleCount !== 1 ? 's' : ''}` : '💬 Comment';
  return `<div class="card-comments">
    ${commentsList}
    <div class="comment-form" id="cf-${id}">
      <textarea class="comment-input" id="ci-${id}" placeholder="Add a comment…" rows="2" maxlength="300"></textarea>
      <div class="comment-actions">
        <button class="comment-submit" onclick="submitComment('${id}',this)">Post</button>
        <button class="comment-cancel" onclick="toggleCommentForm('${id}')">Cancel</button>
      </div>
    </div>
    <button class="card-btn" onclick="toggleCommentForm('${id}')">${commentLabel}</button>
  </div>`;
}


// ══════════════════════════════════════════════════
//  PLACE DETAIL PANEL (from map)
//  Same body as the list card, rendered into the side panel.
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
