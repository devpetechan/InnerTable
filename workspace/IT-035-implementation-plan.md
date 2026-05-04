# IT-035 / IT-036 Implementation Plan
**Bundled scope:** card UI refactor + write-path rebuild + per-place comments + @-mentions + quote replies

This document is meant to be fed into Cursor in pieces. Each phase is sized so the AI can take it on without losing context, and each one has its own acceptance check before moving to the next.

---

## Goals (one-line each)

1. One card per *place*, not per *entry*. Each card shows a stacked list of friends' takes.
2. Adding a place that already exists silently attaches your entry — no duplicate-prompt modal.
3. Comments are per-place, not per-take. Single thread per restaurant.
4. Comments support `@-mentions` and quote replies.

## Out of scope (deliberately deferred)

- Notifications for mentions (would need a separate notifications table / email pipeline)
- Threaded reply chains (quote replies are flat — one quote per comment, no recursion)
- Dropping the legacy `recommendations` table (that's IT-037)

---

## Phase 0 — Branch + safety

```
git checkout -b feat/IT-035-place-cards
```

Don't commit anything until each phase below is reviewed and approved by the user. Run the full app locally after each phase before moving on.

---

## Phase 1 — Schema migration

**New file:** `supabase/migrations/0010_comments_place_id_and_quotes.sql`

This migration does four things:
1. Adds `place_id` to `comments`, backfills it from each comment's `entry_id`, makes it `NOT NULL`, and drops `entry_id`.
2. Adds three columns for quote replies: `quoted_comment_id`, `quoted_text`, `quoted_author`.
3. Updates indexes (drop the entry-based one, add a place-based one).
4. RLS stays unchanged — read-all / author-only writes still apply.

```sql
-- =============================================================================
-- Migration: 0010_comments_place_id_and_quotes.sql
-- IT-035: re-key comments to places, add quote-reply columns.
--
-- WHY
-- ─────────────────────────────────────────────────────────
-- v0.3 (migration 0009) keyed comments to entries, which meant each user's
-- take on a place had its own comment thread.  IT-035 collapses to one card
-- per place, which means one shared thread per place.  We re-key
-- comments.entry_id → comments.place_id and drop the entry FK.
--
-- Quote replies are stored as a snapshot (quoted_text + quoted_author at
-- write time) rather than a parent_id chain.  This keeps quote rendering
-- simple, survives the original being edited or deleted, and avoids
-- recursive thread queries.  Tradeoff: edits to the original don't
-- propagate to the quote.  That's intentional — quotes are a record of
-- what was said at the time.
-- =============================================================================

-- 1. Add place_id column (nullable for now so backfill can run)
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES public.places (id) ON DELETE CASCADE;

-- 2. Backfill place_id from the entry the comment was attached to
UPDATE public.comments c
   SET place_id = e.place_id
  FROM public.entries e
 WHERE c.entry_id = e.id
   AND c.place_id IS NULL;

-- 3. Lock it in
ALTER TABLE public.comments
  ALTER COLUMN place_id SET NOT NULL;

-- 4. Drop the old entry-based index, add a place-based one
DROP INDEX IF EXISTS comments_entry_id_created_at_idx;
CREATE INDEX IF NOT EXISTS comments_place_id_created_at_idx
  ON public.comments (place_id, created_at)
  WHERE deleted_at IS NULL;

-- 5. Drop the old FK (and the column itself — comments are place-keyed now)
ALTER TABLE public.comments
  DROP COLUMN IF EXISTS entry_id;

-- 6. Quote-reply columns (all nullable — only set when this comment is a reply)
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS quoted_comment_id uuid REFERENCES public.comments (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted_text       text,
  ADD COLUMN IF NOT EXISTS quoted_author     text;

-- RLS policies don't change — they were only ever scoped on author_id.
-- Realtime subscription on public.comments keeps working — same table.
```

**Acceptance check (Phase 1):**
- `supabase db reset` runs cleanly through 0001 → 0010.
- `SELECT count(*) FROM comments WHERE place_id IS NULL;` returns 0.
- `\d comments` shows place_id (NOT NULL), quoted_comment_id, quoted_text, quoted_author. No entry_id.

---

## Phase 2 — Data adapter rewrite (`places-service.js`)

This is the structural shift that everything else depends on.

### New shape: `allPlaces` replaces `allRecs`

```js
// allPlaces is keyed by place.id (uuid)
{
  "<place_uuid>": {
    // ── Place fields (one row from `places`) ─────────
    id:            "<place_uuid>",
    name:          "Tartine Bakery",
    cuisine:       "Bakery",
    price:         "$$",
    location:      "San Francisco, CA",
    lat:           37.7614,
    lng:           -122.4241,
    googlePlaceId: "ChIJ...",
    placeType:     "restaurant",

    // ── Takes (entries joined to users) ──────────────
    takes: [
      {
        entryId:       "<entry_uuid>",
        userId:        "<user_uuid>",
        author:        "Alice",          // display_name
        ts:            1714000000000,    // ms since epoch
        status:        "been-recommend", // 'want-to-go' | 'been-recommend' | 'been-skip'
        rating:        5,                // overall stars (0 if not rated)
        factorRatings: { quality: 5, service: 4, value: 5, ambiance: 5 },
        notes:         "Best croissants in SF",
        tryNote:       "",
        url:           ""
      },
      // ... one per user with an entry on this place
    ],

    // ── Comments (one shared thread per place) ───────
    comments: [
      {
        id:             "<comment_uuid>",
        author:         "Bob",
        authorId:       "<user_uuid>",
        text:           "Going Saturday — anyone want to come?",
        ts:             1714100000000,
        deleted:        false,
        reactions:      { "🔥": { "Alice": true, "Carol": true } },
        // Quote-reply fields (null on top-level comments)
        quotedCommentId: null,
        quotedAuthor:    null,
        quotedText:      null,
        // Mentions parsed client-side from text on each fetch
        mentions:       ["Alice"]
      }
    ],

    // ── Aggregates derived in JS (cheaper than re-deriving in render) ────
    aggregate: {
      avgRating:      4.5,
      ratingsCount:   2,
      recommends:     ["Alice", "Bob"],   // names with status === 'been-recommend'
      hardPasses:     [],
      wantsToGo:      ["Carol"],
      triedBy:        ["Alice", "Bob"]
    }
  }
}
```

### Function-by-function changes in `places-service.js`

**Replace `fetchAllRecs()` with `fetchAllPlaces()`:**

```js
async function fetchAllPlaces() {
  // 1. Users (uuid → display_name lookup)
  const { data: users } = await supabaseClient.from('users').select('id, display_name');
  _userIdToName = {};
  (users || []).forEach(u => { _userIdToName[u.id] = u.display_name; });

  // 2. All places
  const { data: places } = await supabaseClient
    .from('places').select('*').order('name');

  // 3. All entries
  const { data: entries } = await supabaseClient
    .from('entries').select('*').order('created_at', { ascending: false });

  // 4. Comments (now place-keyed)
  const { data: comments } = await supabaseClient
    .from('comments').select('*').order('created_at', { ascending: true });

  // 5. Reactions
  const { data: reactionRows } = await supabaseClient
    .from('comment_reactions').select('*');

  // 6. Build the result
  const result = {};
  for (const p of places || []) {
    result[p.id] = {
      id:            p.id,
      name:          p.name,
      cuisine:       p.cuisine,
      price:         p.price,
      location:      p.location,
      lat:           p.lat,
      lng:           p.lng,
      googlePlaceId: p.google_place_id,
      placeType:     p.place_type || 'restaurant',
      takes:         [],
      comments:      [],
      aggregate:     { avgRating: 0, ratingsCount: 0, recommends: [], hardPasses: [], wantsToGo: [], triedBy: [] }
    };
  }

  // 7. Attach takes
  for (const e of entries || []) {
    const place = result[e.place_id];
    if (!place) continue;
    place.takes.push({
      entryId:       e.id,
      userId:        e.user_id,
      author:        _userIdToName[e.user_id] || e.user_id,
      ts:            new Date(e.created_at).getTime(),
      status:        e.status,
      rating:        e.rating_overall || 0,
      factorRatings: {
        quality:  e.rating_quality  || 0,
        service:  e.rating_service  || 0,
        value:    e.rating_value    || 0,
        ambiance: e.rating_ambiance || 0
      },
      notes:    e.notes    || '',
      tryNote:  e.try_note || '',
      url:      e.url      || ''
    });
  }

  // 8. Bucket reactions by comment_id (jsonb-shape compatible with existing render)
  const reactionsByComment = {};
  for (const r of reactionRows || []) {
    if (!reactionsByComment[r.comment_id]) reactionsByComment[r.comment_id] = {};
    if (!reactionsByComment[r.comment_id][r.emoji]) reactionsByComment[r.comment_id][r.emoji] = {};
    reactionsByComment[r.comment_id][r.emoji][_userIdToName[r.user_id] || r.user_id] = true;
  }

  // 9. Attach comments
  for (const c of comments || []) {
    const place = result[c.place_id];
    if (!place) continue;
    place.comments.push({
      id:               c.id,
      author:           _userIdToName[c.author_id] || c.author_id,
      authorId:         c.author_id,
      text:             c.text || '',
      ts:               new Date(c.created_at).getTime(),
      deleted:          c.deleted_at !== null && c.deleted_at !== undefined,
      reactions:        reactionsByComment[c.id] || {},
      quotedCommentId:  c.quoted_comment_id,
      quotedAuthor:     c.quoted_author,
      quotedText:       c.quoted_text,
      mentions:         parseMentions(c.text || '')
    });
  }

  // 10. Compute aggregates per place
  for (const place of Object.values(result)) {
    let total = 0, count = 0;
    for (const t of place.takes) {
      if (t.status === 'been-recommend') place.aggregate.recommends.push(t.author);
      if (t.status === 'been-skip')      place.aggregate.hardPasses.push(t.author);
      if (t.status === 'want-to-go')     place.aggregate.wantsToGo.push(t.author);
      if (t.status === 'been-recommend' || t.status === 'been-skip') place.aggregate.triedBy.push(t.author);
      if (t.rating > 0) { total += t.rating; count++; }
    }
    place.aggregate.avgRating    = count > 0 ? total / count : 0;
    place.aggregate.ratingsCount = count;
  }

  return result;
}

// Helper: parse @mentions out of comment text into a list of display names.
// Matches @Alice, @alice_b, @Bob-Smith. Stops at whitespace or punctuation.
function parseMentions(text) {
  const matches = text.match(/@([a-zA-Z0-9_-]+)/g) || [];
  return matches.map(m => m.slice(1));
}
```

**Replace `loadRecs()` and `_onDbChange` to operate on `allPlaces`:**

```js
async function loadPlaces() {
  allPlaces = await fetchAllPlaces();
  if (document.getElementById('list-map-section').style.display !== 'none') {
    if (currentDisplayMode === 'map' && mapInstance) renderMapMarkers();
    else renderCards();
  }
  updateFriendFilters();

  if (_realtimeChannel) return;
  _realtimeChannel = supabaseClient
    .channel('inner-table-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'places'             }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries'            }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments'           }, _onDbChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comment_reactions'  }, _onDbChange)
    .subscribe();
}
```

**Delete:**
- The entire duplicate-detection block (`checkForDuplicate`, `closeDupOnBg`, `closeDupPrompt`, `closeDupPromptAndContinue`, `confirmDup`, `confirmAttach`).
- The attach-form block (`setAttachStatus`, `setAttachStars`, `setAttachFactorStar`, `resetAttachStars`, `submitAttach`).
- The `_recIdToEntryId` / `_entryIdToRecId` bridge maps and `recIdToEntryId()` helper.
- All `recommendations` and `votes` queries — gone in this refactor.
- The `pendingDupId`, `pendingDupIsOwn`, `attachingToId`, `attachStatus`, `attachStars`, `attachFactorRatings` globals.

**Acceptance check (Phase 2):**
- `console.log(allPlaces)` after auth shows the new shape.
- App still loads, even if cards render blank — that's fine until Phase 3.

---

## Phase 3 — Renderer rewrite (`ui-render.js`)

The renderer now takes a `place` object and emits one card with a takes-stack inside. Comments live at the bottom of the card (one thread per place).

### New `renderCards()`

```js
function renderCards() {
  const container = document.getElementById('cards-container');
  let places = Object.values(allPlaces);

  // Status filter (view tabs) — now applied to takes, not the place itself
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
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🍜</div><p>Nothing here yet.</p></div>`;
    return;
  }

  // Sort: by aggregate rating, or by most-recent take timestamp
  if (currentSort === 'rating') {
    places.sort((a, b) => b.aggregate.avgRating - a.aggregate.avgRating);
  } else {
    places.sort((a, b) => {
      const aLatest = Math.max(0, ...a.takes.map(t => t.ts));
      const bLatest = Math.max(0, ...b.takes.map(t => t.ts));
      return bLatest - aLatest;
    });
  }

  container.innerHTML = `<div class="cards-grid">${places.map(placeCardHTML).join('')}</div>`;
}
```

### New `placeCardHTML(place)` — sketch only, fill in details from existing styles

Sections, top to bottom:

1. **Header**: place name, type tag, cuisine, price, location (with maps link), aggregate stars (if any rated takes).
2. **Aggregate row**: "★ 4.5 (2 ratings) · Recommended by Alice, Bob".
3. **Takes stack** — one mini-block per take:
   - Avatar + name + relative date
   - Status chip (Want to Try / Recommends / Hard Pass)
   - Stars (if rated)
   - Notes / try-note
   - Edit/Delete buttons if it's the current user's take
4. **"Add your take" CTA** — only when `currentUser` doesn't appear in `place.takes`.
5. **Comments section** — one shared thread (see Phase 5 for quote/mention rendering).

Reuse existing CSS classes (`rec-card`, `card-meta`, `card-notes`, etc.) and add new ones for the takes stack:

```css
/* Add to src/styles/main.css */
.takes-stack { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.take-row    { display: flex; gap: 10px; padding: 8px; border: 1px solid var(--tan); border-radius: 8px; }
.take-meta   { flex: 1; font-size: .85rem; }
.take-author { font-weight: 600; }
.take-status-chip { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: .72rem; }
.take-status-chip.recommended  { background: var(--ok); color: #fff; }
.take-status-chip.hard-pass    { background: var(--danger); color: #fff; }
.take-status-chip.want-to-try  { background: var(--accent); color: #fff; }
.add-your-take-cta { margin-top: 10px; padding: 10px; background: var(--bg-soft); border-radius: 8px; text-align: center; }
```

### `openPlaceDetail(id)` becomes simpler

The detail panel now just shows the same `placeCardHTML` content but in the side panel layout. Map markers call it with a place id, not an entry id.

**Acceptance check (Phase 3):**
- Each place renders exactly once on the list.
- A place with takes from 3 friends shows 3 stacked takes inside one card.
- Filtering by "Just Mine" shows only places where I have a take.
- Map pins are deduplicated by place.

---

## Phase 4 — Write path rewrite (`places-service.js` + `app.js` + `index.html`)

This is the IT-036 piece. The new `submitEntry()` (rename from `submitRec`) does the place upsert + entry write atomically.

```js
async function submitEntry() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { shake(document.getElementById('f-name')); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  // ── Build the place row (everything that's about the venue, not the user) ──
  const placeRow = {
    name,
    place_type:      placeType,
    location:        document.getElementById('f-location').value.trim(),
    cuisine:         document.getElementById('f-cuisine').value || null,
    price:           document.getElementById('f-price').value   || null,
    lat:             selectedPlaceLat,
    lng:             selectedPlaceLng,
    google_place_id: selectedPlaceId || null
  };

  // ── Upsert the place by google_place_id (or by name+location for non-Google) ──
  let placeId;
  try {
    if (selectedPlaceId) {
      // We have a Google ID — upsert by it
      const { data, error } = await supabaseClient
        .from('places').upsert(placeRow, { onConflict: 'google_place_id' })
        .select('id').single();
      if (error) throw error;
      placeId = data.id;
    } else if (editingId) {
      // Editing existing entry — keep its place_id
      placeId = allPlaces[/* find via entry */];
      // ... update placeRow if needed
    } else {
      // No Google ID — insert a fresh place row
      const { data, error } = await supabaseClient
        .from('places').insert(placeRow).select('id').single();
      if (error) throw error;
      placeId = data.id;
    }
  } catch (err) {
    console.error('[submitEntry] place upsert failed:', err);
    showToast('❌ Could not save the place.');
    btn.disabled = false; btn.textContent = 'Save';
    return;
  }

  // ── Now write the user's entry row (per-user data) ──
  const entryRow = {
    user_id:  currentUser.id,
    place_id: placeId,
    status:   computeUserStatus(addType),  // helper: maps addType to entries.status
    notes:    document.getElementById('f-notes').value.trim()    || null,
    try_note: document.getElementById('f-try-note').value.trim() || null,
    url:      document.getElementById('f-url').value.trim()      || null
  };

  if (selectedStars > 0) {
    entryRow.rating_overall  = selectedStars;
    entryRow.rating_quality  = factorRatings.quality  || null;
    entryRow.rating_service  = factorRatings.service  || null;
    entryRow.rating_value    = factorRatings.value    || null;
    entryRow.rating_ambiance = factorRatings.ambiance || null;
  }

  const { error: entryErr } = await supabaseClient
    .from('entries').upsert(entryRow, { onConflict: 'user_id,place_id' });
  if (entryErr) {
    console.error('[submitEntry] entry write failed:', entryErr);
    showToast('❌ Could not save your entry.');
    btn.disabled = false; btn.textContent = 'Save';
    return;
  }

  showToast('🎉 Saved!');
  closeModal();
  btn.disabled = false; btn.textContent = 'Save';
}
```

### Delete from `index.html`

- The duplicate-prompt overlay (`#dup-overlay` and everything inside it).
- The attach-step UI (`#attach-step` and all `#abtn-*`, `#afp-*`, `#atc-*` elements).

### Delete from `app.js`

- `editEntry()` rewires to load entry data + place data into the modal (place fields read-only or admin-only).
- `upgradeToTried()` updates the user's entry, doesn't touch the place.
- `deleteEntry(id)` now means "delete *my entry* on this place" — never deletes the place itself.

**Acceptance check (Phase 4):**
- Adding a brand-new place creates one row in `places` and one in `entries`.
- Adding a place that already exists (matched by google_place_id) creates only an `entries` row, no modal.
- Editing my entry updates only `entries`, leaves `places` untouched.
- Deleting my entry removes the entries row but leaves the place visible to others who have entries on it.

---

## Phase 5 — Comments: per-place + @-mentions + quote replies

### Write path: `submitComment(placeId, btn, opts = {})`

```js
async function submitComment(placeId, btn, opts = {}) {
  const input = document.getElementById('ci-' + placeId);
  const text = input.value.trim();
  if (!text) return;

  const row = {
    place_id:  placeId,
    author_id: currentUser.id,
    text
  };

  // Quote-reply: snapshot the original at write time
  if (opts.quotedComment) {
    row.quoted_comment_id = opts.quotedComment.id;
    row.quoted_author     = opts.quotedComment.author;
    row.quoted_text       = opts.quotedComment.text;
  }

  const { error } = await supabaseClient.from('comments').insert(row);
  if (error) { console.error(error); showToast('❌ Could not post.'); return; }

  input.value = '';
  // Realtime will trigger a re-render; no need to manually refresh
}
```

### @-mentions UI

When the user types `@` in the comment textarea:
1. Detect the `@` and the partial username after it.
2. Show a dropdown anchored to the textarea with matching `display_name`s from `_userIdToName`.
3. On selection, replace the partial with `@DisplayName ` (with trailing space).
4. On render, wrap each `@Name` match in a `<span class="mention">` with hover styling.

```js
// In ui-events.js or similar
function attachMentionAutocomplete(textareaEl) {
  const dropdown = document.createElement('ul');
  dropdown.className = 'mention-dropdown';
  textareaEl.parentElement.appendChild(dropdown);

  textareaEl.addEventListener('input', () => {
    const cursorPos = textareaEl.selectionStart;
    const before    = textareaEl.value.slice(0, cursorPos);
    const match     = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (!match) { dropdown.style.display = 'none'; return; }

    const partial = match[1].toLowerCase();
    const candidates = Object.values(_userIdToName)
      .filter(n => n.toLowerCase().startsWith(partial))
      .slice(0, 5);

    if (!candidates.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = candidates.map(n => `<li data-name="${n}">${n}</li>`).join('');
    dropdown.style.display = 'block';
    // Position the dropdown near the cursor — see existing places-dropdown for reference.
  });

  dropdown.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const name = li.dataset.name;
    const cursorPos = textareaEl.selectionStart;
    const before = textareaEl.value.slice(0, cursorPos).replace(/@[a-zA-Z0-9_-]*$/, `@${name} `);
    const after  = textareaEl.value.slice(cursorPos);
    textareaEl.value = before + after;
    textareaEl.focus();
    dropdown.style.display = 'none';
  });
}
```

### Render @-mentions

In the comment text rendering, swap plain `@Name` for styled chips:

```js
function renderCommentText(text, knownNames) {
  const knownSet = new Set(knownNames);
  return esc(text).replace(/@([a-zA-Z0-9_-]+)/g, (full, name) => {
    if (knownSet.has(name)) return `<span class="mention" title="@${name}">@${name}</span>`;
    return full; // unknown name — render as plain text
  });
}
```

CSS:
```css
.mention { background: var(--accent-soft); color: var(--accent); padding: 1px 4px; border-radius: 4px; font-weight: 600; }
.mention-dropdown { position: absolute; background: var(--bg); border: 1px solid var(--tan); border-radius: 6px; list-style: none; padding: 4px 0; margin: 0; max-width: 220px; box-shadow: 0 4px 12px rgba(0,0,0,.1); display: none; z-index: 20; }
.mention-dropdown li { padding: 6px 12px; cursor: pointer; font-size: .85rem; }
.mention-dropdown li:hover { background: var(--bg-soft); }
```

### Quote replies UI

Each comment renders a "Reply" button next to Edit/Delete. Clicking it:
1. Stashes the comment's `id`, `author`, and `text` in a module-level `_pendingQuote = { commentId, author, text }`.
2. Pre-populates the comment input with a visual quote block (rendered, not typed) above the textarea.
3. On submit, `submitComment` reads `_pendingQuote` and includes it in the insert.

```js
let _pendingQuote = null;

function startQuoteReply(placeId, commentId) {
  const place = allPlaces[placeId];
  const c = place.comments.find(c => c.id === commentId);
  if (!c) return;

  _pendingQuote = { commentId: c.id, author: c.author, text: c.text };

  // Render a quote preview above the comment textarea
  const previewEl = document.getElementById('quote-preview-' + placeId);
  previewEl.innerHTML = `
    <div class="quote-preview">
      <strong>Replying to ${esc(c.author)}:</strong>
      <div class="quote-preview-text">${esc(c.text.slice(0, 140))}${c.text.length > 140 ? '…' : ''}</div>
      <button class="quote-cancel" onclick="cancelQuote('${placeId}')">×</button>
    </div>`;
  previewEl.style.display = 'block';
  document.getElementById('ci-' + placeId).focus();
}

function cancelQuote(placeId) {
  _pendingQuote = null;
  const previewEl = document.getElementById('quote-preview-' + placeId);
  previewEl.innerHTML = '';
  previewEl.style.display = 'none';
}

// In submitComment, pass _pendingQuote into the insert and clear after.
```

### Render quote in displayed comments

```js
const quotedHtml = c.quotedCommentId ? `
  <div class="comment-quote">
    <div class="comment-quote-author">${esc(c.quotedAuthor || '')}</div>
    <div class="comment-quote-text">${esc(c.quotedText || '')}</div>
  </div>` : '';
```

CSS:
```css
.comment-quote { border-left: 3px solid var(--tan); padding-left: 10px; margin-bottom: 6px; font-size: .82rem; color: var(--muted); }
.comment-quote-author { font-weight: 600; }
.quote-preview { background: var(--bg-soft); border-left: 3px solid var(--accent); padding: 6px 10px; margin-bottom: 8px; font-size: .82rem; position: relative; }
.quote-cancel { position: absolute; top: 4px; right: 6px; background: none; border: none; cursor: pointer; font-size: 1.1rem; }
```

**Acceptance check (Phase 5):**
- Each place card has exactly one comment thread.
- Typing `@A` in a comment shows a dropdown with matching display names; clicking inserts `@Alice `.
- Submitted comment renders `@Alice` as a styled chip.
- Clicking "Reply" on a comment shows a quote preview above the input; submitting saves the quote in the new row.
- The quoted block renders inside the new comment, with the original author + a snippet of the original text.
- Deleting the original comment doesn't delete the quote — the quote persists with its snapshot.

---

## Phase 6 — Cleanup

After all phases pass:

- Delete from `app.js`: any global state that was tied to the dup modal or attach flow.
- Delete from `index.html`: confirm `#dup-overlay` and `#attach-step` are gone.
- Search for `recommendations` table references in JS — should all be gone.
- Update `workspace-data.json` (the project tracker) to mark IT-035 and IT-036 as `done`.

---

## Phase 7 — Manual test plan

Run through these as the user before approving the PR:

1. **Fresh place**: Add a new restaurant via Google autocomplete. Verify one card appears with one take (yours).
2. **Duplicate place — different user**: Sign in as User B, add the same restaurant. Verify still one card, now with two takes stacked. No modal popped.
3. **Edit your take**: Click Edit on your take. Change rating from 4 to 5. Save. Card updates without page reload.
4. **Delete your take**: Click Delete. Your take disappears from the stack. Card still visible (other user's take remains).
5. **Filter "Just Mine"**: Only places where you have a take show up.
6. **Map view**: Each pin = one place. Clicking opens the detail panel with all takes.
7. **Comment**: Post a comment. Appears under the card.
8. **@-mention**: Type `@A`, pick Alice, submit. Comment renders with `@Alice` as a styled chip.
9. **Quote reply**: Click Reply on someone's comment. Quote preview shows. Type your reply. Submit. New comment renders with the quoted block above your text.
10. **Quote survives delete**: Delete the original comment. The quoting comment still shows the snapshot.

---

## Phasing recommendation for Cursor

Tackle in order. Don't move to the next phase until the previous one's acceptance check passes. Sizes are rough effort, not time:

| Phase | Files touched | Effort |
|---|---|---|
| 1 — Migration | 1 new SQL file | S |
| 2 — Adapter rewrite | `places-service.js` | M |
| 3 — Renderer rewrite | `ui-render.js`, `main.css` | L |
| 4 — Write path | `places-service.js`, `app.js`, `index.html` | M |
| 5 — Comments + mentions + quotes | `places-service.js`, `ui-render.js`, `ui-events.js`, `main.css` | M |
| 6 — Cleanup | `app.js`, `index.html`, `workspace-data.json` | S |
| 7 — Manual QA | — | S |

Each phase is a self-contained Cursor session. When you start a phase, paste the corresponding section of this doc into Cursor as the brief.

---

## Open questions to confirm before Phase 1 starts

1. **Place edits — admin-only or anyone-with-an-entry?** The current ticket says "for v0.3, update the places row (admin-like — log the change)." But there's no admin UI today. Easiest interpretation: anyone with an entry on a place can update the place's cuisine/price; we're trusting friends. Confirm or push this to a later ticket.
2. **`@-mention` matching is case-insensitive on autocomplete but stored exactly as typed.** Is that acceptable, or do we want to normalize on insert?
3. **Quote-reply nesting.** A comment that quotes another comment can itself be quoted. The snapshot model handles this fine, but the UI only ever shows *one* level of quote. Is that the intended behavior?
