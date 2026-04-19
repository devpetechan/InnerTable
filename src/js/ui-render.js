//  RENDER CARDS
// ══════════════════════════════════════════════════
function renderCards() {
  const container = document.getElementById('cards-container');
  let entries = Object.entries(allRecs);

  // Status filter (view tabs)
  entries = entries.filter(([,r]) => {
    if (currentView === 'try')         return r.status === 'try';
    if (currentView === 'recommended') return r.status === 'recommended';
    if (currentView === 'no')          return r.status === 'not-recommended';
    return true;
  });

  // Type filter
  if (currentTypeFilter !== 'all') {
    entries = entries.filter(([,r]) => r.placeType === currentTypeFilter);
  }

  // Author filter
  entries = entries.filter(([,r]) => {
    if (currentFilter === 'all')  return true;
    if (currentFilter === 'mine') return r.author === currentUser.display_name;
    return r.author === currentFilter;
  });

  document.getElementById('rec-count').textContent = entries.length;

  if (!entries.length) {
    let emptyMsg = 'Nothing here yet — be the first to add a spot!';
    if (currentView === 'try') emptyMsg = 'No "want to try" places yet. Add one from the + button!';
    else if (currentView === 'recommended') emptyMsg = 'No recommended places yet. Visit somewhere and rate it!';
    else if (currentFilter === 'mine') emptyMsg = "You haven't added any places yet. Tap + Add Place to get started.";
    else if (currentTypeFilter === 'restaurant') emptyMsg = 'No restaurants match these filters.';
    else if (currentTypeFilter === 'bar') emptyMsg = 'No bars match these filters.';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🍜</div><p>${emptyMsg}</p></div>`;
    return;
  }

  if (currentSort === 'rating') {
    entries.sort((a,b) => {
      const avgA = computeAvgRating(a[1]).avg;
      const avgB = computeAvgRating(b[1]).avg;
      if (avgB !== avgA) return avgB - avgA;
      return (b[1].ts||0) - (a[1].ts||0); // tie-break: newest first
    });
  } else {
    entries.sort((a,b) => (b[1].ts||0) - (a[1].ts||0));
  }
  container.innerHTML = `<div class="cards-grid">${entries.map(([id,r]) => cardHTML(id,r)).join('')}</div>`;
}

function cardHTML(id, r) {
  const isMine      = isAdmin || r.author === currentUser.display_name;
  const statusClass = r.status === 'recommended' ? 'recommended' : r.status === 'not-recommended' ? 'not-recommended' : 'want-to-try';
  const color       = getUserColor(r.author);
  const initials    = (r.author||'?').slice(0,2).toUpperCase();
  const date        = r.ts ? new Date(r.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';

  const { avg, count } = computeAvgRating(r);
  const roundedAvg = Math.round(avg * 2) / 2;
  const avgStars   = avg > 0 ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) : '';
  const avgFactors = computeAvgFactors(r);

  // Creation byline: author + full date/time with timezone (IT-020)
  let byline = '';
  if (r.ts) {
    const formattedTs = new Date(r.ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
    byline = `<div class="card-byline">Added by <strong>${esc(r.author)}</strong> · ${formattedTs}</div>`;
  } else if (r.author) {
    byline = `<div class="card-byline">Added by <strong>${esc(r.author)}</strong></div>`;
  }

  const typeTag = r.placeType === 'bar'
    ? `<span class="tag type-bar">🍸 Bar</span>`
    : `<span class="tag type-restaurant">🍽 Restaurant</span>`;

  // Hard Pass is shown via consolidated social signals; only Want to Try needs a tag here
  const statusTag = r.status === 'try'
    ? `<span class="tag status-try">📌 Want to Try</span>`
    : '';

  const meta = `
    <div class="card-meta">
      ${typeTag}
      ${statusTag}
      ${r.cuisine  ? `<span class="tag cuisine">${esc(r.cuisine)}</span>`  : ''}
      ${r.price    ? `<span class="tag price">${esc(r.price)}</span>`      : ''}
      ${r.location ? `<a class="tag" href="${buildMapsUrl(r)}" target="_blank" rel="noopener" style="text-decoration:none;">📍 ${esc(r.location)}</a>` : ''}
    </div>`;

  const notes = (r.status === 'try')
    ? (r.tryNote ? `<div class="card-notes">${esc(r.tryNote)}</div>` : '')
    : (r.notes   ? `<div class="card-notes">${esc(r.notes)}</div>`   : '');

  const urlEl = (r.status === 'try' && r.url)
    ? `<div class="card-url"><a href="${esc(r.url)}" target="_blank" rel="noopener">🔗 See review</a></div>`
    : '';

  // Factor ratings average display (recommended entries only)
  let factorsDisplay = '';
  if (avgFactors && r.status === 'recommended') {
    const items = ['quality','service','value','ambiance'].map(f => {
      if (!avgFactors[f]) return '';
      const fStars = '★'.repeat(Math.round(avgFactors[f])) + '☆'.repeat(5 - Math.round(avgFactors[f]));
      return `<div class="factor-display"><div class="factor-display-label">${f.charAt(0).toUpperCase()+f.slice(1)}</div><div class="factor-display-stars">${fStars}</div></div>`;
    }).filter(Boolean).join('');
    if (items) factorsDisplay = `<div class="card-factors-grid">${items}</div>`;
  }

  // "Tried by" note for want-to-try entries
  let triedNote = '';
  if (r.status === 'try' && r.triedBy) {
    const triedNames = Object.keys(r.triedBy).filter(n => n !== r.author);
    if (triedNames.length) {
      triedNote = `<div class="card-tried-note">✅ Tried by: ${triedNames.map(esc).join(', ')}</div>`;
    }
  }

  // Owner actions
  let actions = '';
  if (isMine) {
    let btns = `<button class="card-btn" onclick="editEntry('${id}')">✏️ Edit</button>`;
    if (r.status === 'try') {
      btns += `<button class="card-btn primary-action" onclick="upgradeToTried('${id}')">🍴 I've Been Here</button>`;
    }
    btns += `<button class="card-btn danger" onclick="deleteEntry('${id}')">🗑 Delete</button>`;
    actions = `<div class="card-actions">${btns}</div>`;
  }

  // Non-author actions + inline "I've Been Here" form
  let nonAuthorSection = '';
  if (!isMine) {
    const myUserStatus = r.userStatuses && r.userStatuses[currentUser.display_name];
    const myStatusVal  = myUserStatus ? myUserStatus.status : null;
    const myRating     = r.userRatings && r.userRatings[currentUser.display_name];

    // Button label reflects the user's current visit status.
    // go-icon is intentionally omitted here — the consolidated social signals section
    // is the single source of the green checkmark / hard pass indicator.
    let beenBtnLabel;
    if (myStatusVal === 'been-recommend') {
      const myStars = myRating && (myRating.overall||0) > 0 ? ' ' + '★'.repeat(myRating.overall) : '';
      beenBtnLabel = `✓ Go Now${myStars}`;
    } else if (myStatusVal === 'been-skip') {
      beenBtnLabel = 'Hard Pass';
    } else if (myRating && (myRating.overall||0) > 0) {
      beenBtnLabel = `✓ Rated ${'★'.repeat(myRating.overall)}`;
    } else {
      beenBtnLabel = '🍴 I\'ve Been Here';
    }
    nonAuthorSection += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
      <button class="card-btn" onclick="toggleRatingForm('${id}')">${beenBtnLabel}</button>
    </div>`;

    // Inline form: overall rating required; Go Now / Hard Pass optional
    nonAuthorSection += `
    <div class="inline-rating-form" id="rf-${id}" style="display:none">
      <div class="form-label" style="margin-bottom:8px;">Overall Rating *</div>
      <div class="star-picker" id="ur-stars-${id}">
        <span onclick="setUserRatingStar('${id}',1)">☆</span><span onclick="setUserRatingStar('${id}',2)">☆</span>
        <span onclick="setUserRatingStar('${id}',3)">☆</span><span onclick="setUserRatingStar('${id}',4)">☆</span>
        <span onclick="setUserRatingStar('${id}',5)">☆</span>
      </div>
      <div class="form-label" style="margin-top:14px;margin-bottom:8px;">Go Now / Hard Pass <span style="font-weight:400;color:var(--muted)">(optional)</span></div>
      <div class="rec-toggle" id="visit-status-${id}" style="margin-bottom:14px;">
        <button class="rec-btn yes" id="vs-gn-${id}" onclick="setVisitStatus('${id}','been-recommend')">✅ Go Now</button>
        <button class="rec-btn no"  id="vs-hp-${id}" onclick="setVisitStatus('${id}','been-skip')">🚫 Hard Pass</button>
      </div>
      <div class="form-label" style="margin-bottom:8px;">Detailed Ratings (optional)</div>
      <div class="factor-ratings-grid">
        ${['quality','service','value','ambiance'].map(f => `
        <div class="factor-item">
          <div class="factor-label">${f.charAt(0).toUpperCase()+f.slice(1)}</div>
          <div class="factor-star-picker" id="ur-${f}-${id}">
            <span onclick="setUserFactorStar('${id}','${f}',1)">☆</span><span onclick="setUserFactorStar('${id}','${f}',2)">☆</span>
            <span onclick="setUserFactorStar('${id}','${f}',3)">☆</span><span onclick="setUserFactorStar('${id}','${f}',4)">☆</span>
            <span onclick="setUserFactorStar('${id}','${f}',5)">☆</span>
          </div>
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="card-btn primary-action" id="ur-save-${id}" onclick="submitUserRating('${id}')" disabled>Save</button>
        <button class="card-btn" onclick="toggleRatingForm('${id}')">Cancel</button>
      </div>
    </div>`;
  }

  // Vote buttons (non-authors only)
  let voteRow = '';
  if (!isMine) {
    const myVote    = r.votes ? r.votes[currentUser.display_name] : null;
    const upClass   = myVote === 'up'   ? 'vote-btn active-up'   : 'vote-btn';
    const downClass = myVote === 'down' ? 'vote-btn active-down' : 'vote-btn';
    voteRow = `<div class="vote-row">
      <button class="${upClass}"   onclick="castVote('${id}','up')"  title="Agree with this pick">👍</button>
      <button class="${downClass}" onclick="castVote('${id}','down')" title="Disagree with this pick">👎</button>
    </div>`;
  }

  // Comments
  const commentEntries = r.comments ? Object.entries(r.comments).sort((a,b) => (a[1].ts||0)-(b[1].ts||0)) : [];
  const commentsList = commentEntries.length ? `<div class="comments-list">${commentEntries.map(([ck, c]) => {
    if (c.deleted) {
      return `<div class="comment-item"><div class="comment-body"><span class="comment-deleted">Comment deleted.</span></div></div>`;
    }
    const cc = getUserColor(c.author);
    const ci = (c.author||'?').slice(0,2).toUpperCase();
    const cd = c.ts ? new Date(c.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
    const isMyComment = c.author === currentUser.display_name;
    const editActions = isMyComment ? `<div class="comment-edit-actions">
      <button class="comment-action-btn" onclick="startEditComment('${id}','${ck}')">Edit</button>
      <button class="comment-action-btn danger" onclick="deleteComment('${id}','${ck}')">Delete</button>
    </div>` : '';
    // Reaction pills — click to view who reacted
    const reactions = c.reactions || {};
    const reactionPills = Object.entries(reactions).map(([emoji, users]) => {
      const decodedEmoji = decodeURIComponent(emoji);
      const voters = Object.keys(users).filter(u => users[u]);
      if (!voters.length) return '';
      const isMine = voters.includes(currentUser.display_name);
      return `<button class="reaction-pill${isMine ? ' mine' : ''}" onclick="showReactionViewers(this,'${id}','${ck}')" title="Click to see who reacted">${decodedEmoji} <span class="reaction-count">${voters.length}</span></button>`;
    }).join('');
    // Separate "add reaction" button — single click opens picker
    const reactionsHtml = `<div class="comment-reactions">${reactionPills}<button class="reaction-add-btn" onclick="showReactionPicker(this,'${id}','${ck}')" title="Add a reaction">＋ 😊</button></div>`;
    return `<div class="comment-item">
      <div class="avatar-sm ${cc}">${ci}</div>
      <div class="comment-body">
        <span class="comment-author">${esc(c.author)}</span><span class="comment-date">${cd}</span>
        <div id="cv-${id}-${ck}">
          <span class="comment-text">${esc(c.text)}</span>
          ${editActions}
        </div>
        <div class="comment-edit-form" id="cef-${id}-${ck}" style="display:none">
          <textarea class="comment-input" id="cet-${id}-${ck}" rows="2" maxlength="300">${esc(c.text)}</textarea>
          <div class="comment-actions">
            <button class="comment-submit" onclick="saveCommentEdit('${id}','${ck}',this)">Save</button>
            <button class="comment-cancel" onclick="cancelEditComment('${id}','${ck}')">Cancel</button>
          </div>
        </div>
        ${reactionsHtml}
      </div>
    </div>`;
  }).join('')}</div>` : '';

  const visibleCommentCount = commentEntries.filter(([,c]) => !c.deleted).length;
  const commentLabel = visibleCommentCount ? `💬 ${visibleCommentCount} comment${visibleCommentCount !== 1 ? 's' : ''}` : '💬 Comment';
  const comments = `<div class="card-comments">
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

  const ratingTip = count > 0 ? ` title="${avg.toFixed(1)} avg (${count} rating${count!==1?'s':''})"` : '';

  // Social signals from userStatuses
  const socialSignals = buildSocialSignals(id, r);

  const statusLabelMap = {
    'recommended': '<span class="card-status-label recommended">✅ Recommended</span>',
    'not-recommended': '<span class="card-status-label not-recommended">🚫 Hard Pass</span>',
    'want-to-try': '<span class="card-status-label want-to-try">📌 Want to Try</span>',
  };
  const statusLabel = statusLabelMap[statusClass] || '';

  return `
    <div class="rec-card ${statusClass}">
      ${statusLabel}
      <div class="card-top">
        <div class="card-name">${esc(r.name)}</div>
        ${avg > 0 ? `<div class="stars"${ratingTip}>${avgStars}</div>` : ''}
      </div>
      ${byline}
      ${meta}
      ${notes}
      ${urlEl}
      ${factorsDisplay}
      ${triedNote}
      ${socialSignals}
      ${actions}
      ${nonAuthorSection}
      ${voteRow}
      ${comments}
      <div class="card-footer">
        <div class="card-author">
          <div class="avatar-sm ${color}">${initials}</div>
          <span>${esc(r.author)}${isMine ? ' (you)' : ''}</span>
        </div>
        <span>${date}</span>
      </div>
    </div>`;
}

function updateFriendFilters() {
  // IT-002: Only "Everyone" and "Just Mine" filters are shown; no per-user chips.
}

// ══════════════════════════════════════════════════

//  PLACE DETAIL PANEL (from map)
// ══════════════════════════════════════════════════
function openPlaceDetail(id) {
  const r = allRecs[id];
  if (!r) return;

  const isMine = isAdmin || r.author === currentUser.display_name;
  const { avg, count } = computeAvgRating(r);
  const avgStars = avg > 0 ? '★'.repeat(Math.round(avg))+'☆'.repeat(5-Math.round(avg)) : '';
  const avgFactors = computeAvgFactors(r);
  const color = getUserColor(r.author);
  const initials = (r.author||'?').slice(0,2).toUpperCase();
  const date = r.ts ? new Date(r.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';

  const typeLabel = r.placeType === 'bar' ? '🍸 Bar' : '🍽 Restaurant';
  const statusLabel = r.status === 'try' ? '📌 Want to Try' : r.status === 'not-recommended' ? '🚫 Hard Pass' : '✅ Recommended';

  // Factor ratings display
  let factorsHtml = '';
  if (avgFactors) {
    const items = ['quality','service','value','ambiance'].map(f => {
      if (!avgFactors[f]) return '';
      const fStars = '★'.repeat(Math.round(avgFactors[f]))+'☆'.repeat(5-Math.round(avgFactors[f]));
      return `<div class="factor-display"><div class="factor-display-label">${f.charAt(0).toUpperCase()+f.slice(1)}</div><div class="factor-display-stars">${fStars}</div></div>`;
    }).filter(Boolean).join('');
    if (items) factorsHtml = `<div class="card-factors-grid" style="margin:10px 0;">${items}</div>`;
  }

  // Per-user ratings breakdown
  let userRatingsHtml = '';
  if (r.userRatings && Object.keys(r.userRatings).length > 0) {
    const rows = Object.entries(r.userRatings).map(([uname, ur]) => {
      const uStars = (ur.overall||0) > 0 ? '★'.repeat(ur.overall)+'☆'.repeat(5-ur.overall) : '—';
      const uColor = getUserColor(uname);
      const uInit = uname.slice(0,2).toUpperCase();
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div class="avatar-sm ${uColor}">${uInit}</div>
        <span style="font-size:.8rem;color:var(--muted);min-width:70px;">${esc(uname)}</span>
        <span style="color:#e8b844;font-size:.85rem;">${uStars}</span>
      </div>`;
    }).join('');
    userRatingsHtml = `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--tan);">
      <div class="form-label" style="margin-bottom:8px;">Ratings by</div>${rows}</div>`;
  }

  // "Tried by" for want-to-try
  let triedHtml = '';
  if (r.status === 'try' && r.triedBy) {
    const names = Object.keys(r.triedBy).filter(n => n !== r.author);
    if (names.length) triedHtml = `<div class="card-tried-note" style="margin-top:8px;">✅ Tried by: ${names.map(esc).join(', ')}</div>`;
  }

  // Non-author action buttons + inline "I've Been Here" form
  let nonAuthorHtml = '';
  if (!isMine) {
    const myUserStatus = r.userStatuses && r.userStatuses[currentUser.display_name];
    const myStatusVal  = myUserStatus ? myUserStatus.status : null;
    const myRating     = r.userRatings && r.userRatings[currentUser.display_name];

    // go-icon omitted — the consolidated social signals button is the single checkmark indicator
    let beenBtnLabel;
    if (myStatusVal === 'been-recommend') {
      const myStars = myRating && (myRating.overall||0) > 0 ? ' ' + '★'.repeat(myRating.overall) : '';
      beenBtnLabel = `✓ Go Now${myStars}`;
    } else if (myStatusVal === 'been-skip') {
      beenBtnLabel = 'Hard Pass';
    } else if (myRating && (myRating.overall||0) > 0) {
      beenBtnLabel = `✓ Rated ${'★'.repeat(myRating.overall)}`;
    } else {
      beenBtnLabel = '🍴 I\'ve Been Here';
    }
    nonAuthorHtml += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">
      <button class="card-btn" onclick="toggleDetailRatingForm('${id}')">${beenBtnLabel}</button>
    </div>`;

    nonAuthorHtml += `
    <div class="inline-rating-form" id="drf-${id}" style="display:none;margin-top:10px;">
      <div class="form-label" style="margin-bottom:8px;">How was it?</div>
      <div class="rec-toggle" id="dvisit-status-${id}" style="margin-bottom:14px;">
        <button class="rec-btn yes" id="dvs-gn-${id}" onclick="setDetailVisitStatus('${id}','been-recommend')">✅ Go Now</button>
        <button class="rec-btn no"  id="dvs-hp-${id}" onclick="setDetailVisitStatus('${id}','been-skip')">🚫 Hard Pass</button>
      </div>
      <div class="form-label" style="margin-bottom:8px;">Overall Rating (optional)</div>
      <div class="star-picker" id="dur-stars-${id}">
        <span onclick="setDetailUserRatingStar('${id}',1)">☆</span><span onclick="setDetailUserRatingStar('${id}',2)">☆</span>
        <span onclick="setDetailUserRatingStar('${id}',3)">☆</span><span onclick="setDetailUserRatingStar('${id}',4)">☆</span>
        <span onclick="setDetailUserRatingStar('${id}',5)">☆</span>
      </div>
      <div class="form-label" style="margin-top:12px;margin-bottom:8px;">Detailed Ratings (optional)</div>
      <div class="factor-ratings-grid">
        ${['quality','service','value','ambiance'].map(f => `
        <div class="factor-item">
          <div class="factor-label">${f.charAt(0).toUpperCase()+f.slice(1)}</div>
          <div class="factor-star-picker" id="dur-${f}-${id}">
            <span onclick="setDetailUserFactorStar('${id}','${f}',1)">☆</span><span onclick="setDetailUserFactorStar('${id}','${f}',2)">☆</span>
            <span onclick="setDetailUserFactorStar('${id}','${f}',3)">☆</span><span onclick="setDetailUserFactorStar('${id}','${f}',4)">☆</span>
            <span onclick="setDetailUserFactorStar('${id}','${f}',5)">☆</span>
          </div>
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="card-btn primary-action" onclick="submitDetailUserRating('${id}')">Save</button>
        <button class="card-btn" onclick="toggleDetailRatingForm('${id}')">Cancel</button>
      </div>
    </div>`;
  }

  // Owner buttons
  let ownerHtml = '';
  if (isMine) {
    ownerHtml = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      <button class="card-btn" onclick="closeDetailPanel();editEntry('${id}')">✏️ Edit</button>
      ${r.status === 'try' ? `<button class="card-btn primary-action" onclick="closeDetailPanel();upgradeToTried('${id}')">🍴 I've Been Here</button>` : ''}
      <button class="card-btn danger" onclick="closeDetailPanel();deleteEntry('${id}')">🗑 Delete</button>
    </div>`;
  }

  const notes = r.status === 'try'
    ? (r.tryNote ? `<div class="card-notes" style="margin:10px 0;">${esc(r.tryNote)}</div>` : '')
    : (r.notes   ? `<div class="card-notes" style="margin:10px 0;">${esc(r.notes)}</div>`   : '');

  const urlEl = r.status === 'try' && r.url
    ? `<div class="card-url" style="margin-bottom:8px;"><a href="${esc(r.url)}" target="_blank" rel="noopener">🔗 See review</a></div>`
    : '';

  document.getElementById('detail-panel-title').textContent = r.name;
  document.getElementById('detail-panel-content').innerHTML = `
    <div class="card-meta" style="margin-bottom:10px;">
      ${r.placeType === 'bar' ? `<span class="tag type-bar">🍸 Bar</span>` : `<span class="tag type-restaurant">🍽 Restaurant</span>`}
      ${r.status === 'try' ? `<span class="tag status-try">📌 Want to Try</span>` : ''}
      ${r.cuisine  ? `<span class="tag cuisine">${esc(r.cuisine)}</span>`  : ''}
      ${r.price    ? `<span class="tag price">${esc(r.price)}</span>`      : ''}
      ${r.location ? `<a class="tag" href="${buildMapsUrl(r)}" target="_blank" rel="noopener" style="text-decoration:none;">📍 ${esc(r.location)}</a>` : ''}
    </div>
    ${avg > 0 ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span class="stars">${avgStars}</span><span style="font-size:.82rem;font-weight:700;">${avg.toFixed(1)}</span><span style="font-size:.75rem;color:var(--muted);">(${count} rating${count!==1?'s':''})</span></div>` : ''}
    ${factorsHtml}
    ${notes}
    ${urlEl}
    ${triedHtml}
    ${userRatingsHtml}
    ${nonAuthorHtml}
    ${ownerHtml}
    <div class="card-footer" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--tan);">
      <div class="card-author">
        <div class="avatar-sm ${color}">${initials}</div>
        <span>Added by ${esc(r.author)}${isMine ? ' (you)' : ''}</span>
      </div>
      <span>${date}</span>
    </div>`;

  document.getElementById('place-detail-overlay').classList.add('open');
}

function closeDetailPanel() {
  document.getElementById('place-detail-overlay').classList.remove('open');
}

function closeDetailOnBg(e) {
  if (e.target === document.getElementById('place-detail-overlay')) closeDetailPanel();
}

async function markAsTriedFromDetail(id) {
  const { error } = await _upsertInteraction(id, { tried: true });
  if (error) { console.error(error); showToast('❌ Could not save.'); return; }
  showToast('✅ Marked as tried!');
  openPlaceDetail(id);
}

function toggleDetailRatingForm(id) {
  if (!pendingUserRatings[id]) {
    const r = allRecs[id];
    const existing       = r && r.userRatings  && r.userRatings[currentUser.display_name];
    const existingStatus = r && r.userStatuses && r.userStatuses[currentUser.display_name];
    pendingUserRatings[id] = existing
      ? { overall: existing.overall||0, quality: existing.quality||0, service: existing.service||0, value: existing.value||0, ambiance: existing.ambiance||0 }
      : { overall: 0, quality: 0, service: 0, value: 0, ambiance: 0 };
    if (existingStatus) pendingUserRatings[id].visitStatus = existingStatus.status;
  }
  const form = document.getElementById('drf-' + id);
  if (!form) return;
  const opening = form.style.display === 'none';
  form.style.display = opening ? 'block' : 'none';
  if (opening) {
    const state = pendingUserRatings[id];
    const starsEl = document.getElementById('dur-stars-' + id);
    if (starsEl) starsEl.querySelectorAll('span').forEach((s,i) => { s.textContent = i < state.overall ? '★' : '☆'; });
    ['quality','service','value','ambiance'].forEach(f => {
      const el = document.getElementById(`dur-${f}-${id}`);
      if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < (state[f]||0) ? '★' : '☆'; });
    });
    // Sync status toggle buttons
    const vs = state.visitStatus;
    const gnBtn = document.getElementById('dvs-gn-' + id);
    const hpBtn = document.getElementById('dvs-hp-' + id);
    if (gnBtn) gnBtn.classList.toggle('active', vs === 'been-recommend');
    if (hpBtn) hpBtn.classList.toggle('active', vs === 'been-skip');
  }
}

function setDetailVisitStatus(id, status) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  const gnBtn = document.getElementById('dvs-gn-' + id);
  const hpBtn = document.getElementById('dvs-hp-' + id);
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

function setDetailUserRatingStar(id, n) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  pendingUserRatings[id].overall = n;
  const el = document.getElementById('dur-stars-' + id);
  if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

function setDetailUserFactorStar(id, factor, n) {
  if (!pendingUserRatings[id]) pendingUserRatings[id] = { overall:0, quality:0, service:0, value:0, ambiance:0 };
  pendingUserRatings[id][factor] = n;
  const el = document.getElementById(`dur-${factor}-${id}`);
  if (el) el.querySelectorAll('span').forEach((s,i) => { s.textContent = i < n ? '★' : '☆'; });
}

async function submitDetailUserRating(id) {
  const state = pendingUserRatings[id] || { overall:0, quality:0, service:0, value:0, ambiance:0 };

  const ix = {
    tried:           true,
    rating_overall:  state.overall  || 0,
    rating_quality:  state.quality  || 0,
    rating_service:  state.service  || 0,
    rating_value:    state.value    || 0,
    rating_ambiance: state.ambiance || 0
  };
  if (state.visitStatus !== undefined) {
    ix.status = state.visitStatus; // null clears the column; string sets it
  }

  const { error } = await _upsertInteraction(id, ix);
  if (error) { console.error(error); showToast('❌ Could not save.'); return; }

  const toast = state.visitStatus === 'been-recommend' ? 'Go Now saved!'
              : state.visitStatus === 'been-skip'      ? '🚫 Hard Pass saved!'
              : '⭐ Rating saved!';
  showToast(toast);
  delete pendingUserRatings[id];
  openPlaceDetail(id); // refresh panel
}

// ══════════════════════════════════════════════════

//  SOCIAL SIGNALS
// ══════════════════════════════════════════════════
function buildSocialSignals(id, r) {
  const statuses = r.userStatuses ? Object.entries(r.userStatuses) : [];
  let recommends = statuses.filter(([,s]) => s && s.status === 'been-recommend');
  let skips      = statuses.filter(([,s]) => s && s.status === 'been-skip');

  // Fallback for legacy entries where the author's status wasn't written to userStatuses:
  // infer from the top-level r.status field so the count is always accurate.
  const authorInStatuses = statuses.some(([n]) => n === r.author);
  if (!authorInStatuses) {
    if (r.status === 'recommended')     recommends = [[r.author, {}], ...recommends];
    else if (r.status === 'not-recommended') skips = [[r.author, {}], ...skips];
  }

  if (!recommends.length && !skips.length) return '';

  const recLabel  = recommends.length === 1 ? '1 recommends' : `${recommends.length} recommend`;
  const skipLabel = skips.length === 1 ? '1 hard pass' : `${skips.length} hard passes`;
  const recBtn  = recommends.length
    ? `<button class="signal-btn" onclick="openStatusDetail('${id}','been-recommend')" title="See who recommends">✅ <span class="signal-count">${recLabel}</span></button>`
    : '';
  const skipBtn = skips.length
    ? `<button class="signal-btn" onclick="openStatusDetail('${id}','been-skip')" title="See who'd hard pass">🚫 <span class="signal-count">${skipLabel}</span></button>`
    : '';

  return `<div class="social-signals">${recBtn}${skipBtn}</div>`;
}

function openStatusDetail(id, filterStatus) {
  const r = allRecs[id];
  if (!r) return;

  const statuses = r.userStatuses ? Object.entries(r.userStatuses) : [];
  let recommends = statuses.filter(([,s]) => s && s.status === 'been-recommend').map(([n]) => n);
  let skips      = statuses.filter(([,s]) => s && s.status === 'been-skip').map(([n]) => n);

  // Legacy fallback: include author if not already in userStatuses
  const authorInStatuses = statuses.some(([n]) => n === r.author);
  if (!authorInStatuses) {
    if (r.status === 'recommended')      recommends = [r.author, ...recommends];
    else if (r.status === 'not-recommended') skips  = [r.author, ...skips];
  }

  const nameList = (names, emoji, label) => {
    if (!names.length) return '';
    const items = names.map(n => {
      const c = getUserColor(n);
      return `<div class="status-name-item"><div class="avatar-sm ${c}">${n.slice(0,2).toUpperCase()}</div>${esc(n)}</div>`;
    }).join('');
    return `<div style="margin-bottom:14px;"><div class="form-label" style="margin-bottom:8px;">${emoji} ${label}</div><div class="status-names-list">${items}</div></div>`;
  };

  document.getElementById('detail-panel-title').textContent = r.name;
  document.getElementById('detail-panel-content').innerHTML =
    nameList(recommends, '✅', 'Recommends') +
    nameList(skips,      '🚫', 'Hard Passes') +
    `<div class="card-footer" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--tan);">
      <span style="font-size:.8rem;color:var(--muted);">Tap a name to see their other picks — coming soon</span>
    </div>`;
  document.getElementById('place-detail-overlay').classList.add('open');
}

// ══════════════════════════════════════════════════
