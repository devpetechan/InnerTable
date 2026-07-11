// ══════════════════════════════════════════════════
//  FRIENDS SERVICE + FRIENDS SCREEN (v0.4.0 Phase 2 · REL-11)
//
//  HOW IT WORKS (overview for learning):
//  ─────────────────────────────────────
//  The friendships table stores TWO rows per relationship, one per
//  direction (see migration 0017).  RLS only ever returns *my* edges
//  (user_id = me), so every row we receive reads naturally as
//  "my relationship with friend_id".
//
//  All writes go through Postgres RPCs (send_friend_request, etc.) —
//  the table itself accepts no direct INSERT/UPDATE/DELETE from clients.
//  That keeps the two-row pair consistent and the state machine rules
//  (no self-friending, blocked pairs can't re-request…) in one place,
//  inside the database.
//
//  This file owns: friendship data loading, RPC wrappers, the Find
//  Friends search, and rendering of the Friends screen.  Static event
//  listeners live in ui-events.js, following the existing convention.
// ══════════════════════════════════════════════════


// ── Global state ─────────────────────────────────
let myFriends        = [];  // accepted edges, enriched with profile
let incomingRequests = [];  // pending, requested by the other party
let outgoingRequests = [];  // pending, requested by me
let blockedUsers     = [];  // edges I have blocked
let currentFriendsTab = 'friends';   // 'friends' | 'requests' | 'find'

// ── Module-private state ─────────────────────────
let _relationshipById = {};  // { uuid: 'friends'|'pending-in'|'pending-out'|'blocked' }
let _searchTimer      = null;
let _searchSeq        = 0;   // guards against out-of-order responses
let _lastSearchRows   = [];  // kept so CTAs can re-render after an action
let _friendsChannel   = null; // Supabase Realtime channel (set up once)
let _friendsDebounce  = null;
let _profileUserId    = null; // uuid of the friend profile being viewed


// ══════════════════════════════════════════════════
//  DATA LOADING
// ══════════════════════════════════════════════════

// loadFriends: fetch my friendship edges with the other party's profile
// embedded.  users!friendships_friend_id_fkey tells Supabase WHICH of the
// table's three FKs to users to join through (user_id, friend_id and
// requested_by all reference users — without the hint the join is ambiguous).
async function loadFriends() {
  const { data, error } = await supabaseClient
    .from('friendships')
    .select(`
      friend_id, status, requested_by, created_at, accepted_at,
      profile:users!friendships_friend_id_fkey ( id, display_name, handle, avatar_url, bio )
    `)
    .in('status', ['pending', 'accepted', 'blocked']);

  if (error) {
    console.error('[loadFriends] query failed:', error);
    return;
  }

  myFriends        = [];
  incomingRequests = [];
  outgoingRequests = [];
  blockedUsers     = [];
  _relationshipById = {};

  for (const row of data || []) {
    const edge = {
      userId:      row.friend_id,
      profile:     row.profile || { id: row.friend_id, display_name: 'Unknown', handle: null, avatar_url: null },
      requestedAt: new Date(row.created_at).getTime(),
      acceptedAt:  row.accepted_at ? new Date(row.accepted_at).getTime() : null
    };
    if (row.status === 'accepted') {
      myFriends.push(edge);
      _relationshipById[row.friend_id] = 'friends';
    } else if (row.status === 'pending' && row.requested_by === row.friend_id) {
      incomingRequests.push(edge);
      _relationshipById[row.friend_id] = 'pending-in';
    } else if (row.status === 'pending') {
      outgoingRequests.push(edge);
      _relationshipById[row.friend_id] = 'pending-out';
    } else if (row.status === 'blocked') {
      _relationshipById[row.friend_id] = 'blocked';
    }
  }

  myFriends.sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));

  renderFriendsScreen();
}


// ══════════════════════════════════════════════════
//  RPC WRAPPERS
//  Each returns true on success and refreshes local state.
// ══════════════════════════════════════════════════
async function _friendRpc(fn, args, successMsg) {
  const { error } = await supabaseClient.rpc(fn, args);
  if (error) {
    console.error(`[${fn}]`, error);
    // The RPCs raise readable errors ("Already friends", …) — surface them.
    showToast(error.message || 'Something went wrong.');
    return false;
  }
  if (successMsg) showToast(successMsg);
  await loadFriends();
  _rerenderSearchCtas();
  return true;
}

function sendFriendRequest(targetId)      { return _friendRpc('send_friend_request',    { p_target: targetId }, 'Request sent.'); }
function acceptFriendRequest(otherId)     { return _friendRpc('respond_friend_request', { p_other: otherId, p_accept: true  }, 'You are now friends.'); }
function declineFriendRequest(otherId)    { return _friendRpc('respond_friend_request', { p_other: otherId, p_accept: false }, 'Request declined.'); }
function cancelFriendRequest(targetId)    { return _friendRpc('cancel_friend_request',  { p_target: targetId }, 'Request cancelled.'); }
function removeFriend(targetId) {
  if (!confirm('Remove this friend? They will no longer see your notes.')) return;
  return _friendRpc('remove_friend', { p_target: targetId }, 'Friend removed.');
}
function blockUser(targetId) {
  if (!confirm('Block this user? They will not be able to send you requests.')) return;
  return _friendRpc('block_user', { p_target: targetId }, 'User blocked.');
}


// ══════════════════════════════════════════════════
//  FIND FRIENDS — SEARCH
//  One input, two modes: text containing '@' is treated as an exact
//  email lookup (via the opt-in-only RPC); anything else matches
//  handle OR display name.
// ══════════════════════════════════════════════════

// Debounced input handler (wired in ui-events.js).  "Debounce" means:
// wait until the user pauses typing (300 ms) before querying, instead of
// hitting the database on every keystroke.
function onFriendSearchInput() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(runFriendSearch, 300);
}

async function runFriendSearch() {
  const input = document.getElementById('friend-search-input');
  const q = input.value.trim();
  const seq = ++_searchSeq;

  if (q.length < 2) {
    _lastSearchRows = [];
    renderSearchResults([], '');
    return;
  }

  let rows = [];
  if (q.includes('@')) {
    // Exact email lookup — returns a match only if that user opted in
    // (users.allow_email_lookup) and never reveals the email itself.
    const { data, error } = await supabaseClient.rpc('find_user_by_email', { p_email: q });
    if (error) console.error('[runFriendSearch] email lookup:', error);
    rows = data || [];
  } else {
    // Handle / name search.  Strip characters that would break the
    // PostgREST .or() filter syntax before interpolating.
    const safe = q.replace(/[,()%]/g, '');
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, display_name, handle, avatar_url')
      .or(`handle.ilike.%${safe}%,display_name.ilike.%${safe}%`)
      .neq('id', currentUser.id)
      .limit(10);
    if (error) console.error('[runFriendSearch] handle search:', error);
    rows = data || [];
  }

  if (seq !== _searchSeq) return;  // a newer search superseded this one
  _lastSearchRows = rows.filter(r => r.id !== currentUser.id);
  renderSearchResults(_lastSearchRows, q);
}

// After an action (send/cancel/accept) the relationship map changes;
// re-render the current results so CTAs update in place.
function _rerenderSearchCtas() {
  if (currentFriendsTab === 'find' && _lastSearchRows.length) {
    renderSearchResults(_lastSearchRows,
      document.getElementById('friend-search-input').value.trim());
  }
}


// ══════════════════════════════════════════════════
//  RENDERING
// ══════════════════════════════════════════════════

function switchFriendsTab(tab, el) {
  currentFriendsTab = tab;
  document.querySelectorAll('#friends-tabs .view-tab').forEach(t => {
    t.classList.toggle('active', t === el);
    t.setAttribute('aria-selected', String(t === el));
  });
  document.getElementById('ftab-friends').style.display  = tab === 'friends'  ? 'block' : 'none';
  document.getElementById('ftab-requests').style.display = tab === 'requests' ? 'block' : 'none';
  document.getElementById('ftab-find').style.display     = tab === 'find'     ? 'block' : 'none';
  if (tab === 'find') {
    setTimeout(() => document.getElementById('friend-search-input').focus(), 50);
  }
  renderFriendsScreen();
}

function renderFriendsScreen() {
  const section = document.getElementById('friends-section');
  if (!section || section.style.display === 'none') return;
  _renderMyFriends();
  _renderRequests();
  _updateRequestsBadge();
}

// ── Shared bits ───────────────────────────────────
function _friendAvatarHtml(profile) {
  if (profile.avatar_url) {
    return `<div class="avatar friend-avatar"><img src="${esc(profile.avatar_url)}" alt="" /></div>`;
  }
  const initials = (profile.display_name || '?').slice(0, 2).toUpperCase();
  return `<div class="avatar friend-avatar ${getUserColor(profile.display_name || '?')}">${esc(initials)}</div>`;
}

function _friendIdentityHtml(profile) {
  const handle = profile.handle ? `@${profile.handle}` : '';
  return `
    <div class="friend-identity">
      <div class="friend-name">${esc(profile.display_name)}</div>
      ${handle ? `<div class="friend-handle">${esc(handle)}</div>` : ''}
    </div>`;
}

// Count of entries this user has made — derived from the already-loaded
// allPlaces cache rather than a separate query.
function _entryCountFor(userId) {
  let n = 0;
  for (const p of Object.values(allPlaces)) {
    if (p.takes.some(t => t.userId === userId)) n++;
  }
  return n;
}

// ── My Friends tab ────────────────────────────────
function _renderMyFriends() {
  const el = document.getElementById('my-friends-list');
  if (!myFriends.length) {
    el.innerHTML = `
      <div class="friends-empty">
        <p>No friends yet.</p>
        <p class="friends-empty-hint">Find people you know by handle or email, and their notes will join your circle.</p>
        <button class="btn-inline-primary" onclick="switchFriendsTab('find', document.querySelector('[data-ftab=find]'))">Find friends</button>
      </div>`;
    return;
  }
  el.innerHTML = myFriends.map(f => {
    const places = _entryCountFor(f.userId);
    return `
      <div class="friend-card">
        ${_friendAvatarHtml(f.profile)}
        ${_friendIdentityHtml(f.profile)}
        <span class="friend-meta">${places} place${places === 1 ? '' : 's'}</span>
        <button class="friend-cta ghost" onclick="removeFriend('${f.userId}')">Remove</button>
      </div>`;
  }).join('');
}

// ── Requests tab (incoming + outgoing) ───────────
function _renderRequests() {
  const el = document.getElementById('requests-lists');
  const inc = incomingRequests.map(r => `
    <div class="friend-card">
      ${_friendAvatarHtml(r.profile)}
      ${_friendIdentityHtml(r.profile)}
      <button class="friend-cta primary" onclick="acceptFriendRequest('${r.userId}')">Accept</button>
      <button class="friend-cta ghost"   onclick="declineFriendRequest('${r.userId}')">Decline</button>
    </div>`).join('');
  const out = outgoingRequests.map(r => `
    <div class="friend-card">
      ${_friendAvatarHtml(r.profile)}
      ${_friendIdentityHtml(r.profile)}
      <span class="friend-meta">Pending</span>
      <button class="friend-cta ghost" onclick="cancelFriendRequest('${r.userId}')">Cancel</button>
    </div>`).join('');

  el.innerHTML = `
    <div class="friends-subheading">Incoming</div>
    ${inc || '<div class="friends-empty-line">No incoming requests.</div>'}
    <div class="friends-subheading">Outgoing</div>
    ${out || '<div class="friends-empty-line">No outgoing requests.</div>'}`;
}

function _updateRequestsBadge() {
  const badge = document.getElementById('requests-badge');
  const n = incomingRequests.length;
  badge.textContent = n;
  badge.style.display = n > 0 ? '' : 'none';
}

// ── Find tab results ──────────────────────────────
function _searchCtaHtml(userId) {
  switch (_relationshipById[userId]) {
    case 'friends':     return `<span class="friend-meta friends-yes">Friends ✓</span>`;
    case 'pending-out': return `<button class="friend-cta ghost" onclick="cancelFriendRequest('${userId}')">Cancel request</button>`;
    case 'pending-in':  return `<button class="friend-cta primary" onclick="acceptFriendRequest('${userId}')">Accept</button>`;
    case 'blocked':     return `<span class="friend-meta">Blocked</span>`;
    default:            return `<button class="friend-cta primary" onclick="sendFriendRequest('${userId}')">Send request</button>`;
  }
}

function renderSearchResults(rows, q) {
  const el = document.getElementById('friend-search-results');
  if (!q) { el.innerHTML = ''; return; }
  if (!rows.length) {
    el.innerHTML = `
      <div class="friends-empty-line">
        No one found for “${esc(q)}”.
        ${q.includes('@') ? 'Email search needs the exact address, and only finds people who allow it.' : ''}
      </div>`;
    return;
  }
  el.innerHTML = rows.map(r => `
    <div class="friend-card">
      ${_friendAvatarHtml(r)}
      ${_friendIdentityHtml(r)}
      ${_searchCtaHtml(r.id)}
    </div>`).join('');
}
