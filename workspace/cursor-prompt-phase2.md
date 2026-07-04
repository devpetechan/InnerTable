# Cursor prompt — IT-035 Phase 2 (data adapter rewrite)

**Before pasting:** open these files in Cursor's editor so they're in context:
`src/js/places-service.js`, `src/js/auth.js`, `workspace/IT-035-implementation-plan.md`

Then paste everything below the line into Claude in Cursor.

---

Implement **Phase 2 only** of `workspace/IT-035-implementation-plan.md` (section "Phase 2 — Data adapter rewrite"). Read that section carefully first — it contains the target data shape and reference implementations for `fetchAllPlaces()` and `loadPlaces()`. Follow it, with the corrections and constraints below, which reflect the live database state as of 2026-07-03 (the plan was written earlier and a few details have drifted).

## Corrections to the plan

1. **Do not query `user_rec_interactions` — the table no longer exists in the database.** The current `fetchAllRecs()` queries it (line ~87); that query and everything consuming `interactions` must be deleted, not ported.
2. **Do not query `votes` in the new adapter.** The plan already says votes are gone in this refactor; note the current file also *writes* to votes (`toggleVote`, ~line 273) and to `user_rec_interactions` (`setUserRecInteraction`, ~line 700). Delete those write helpers too — they are part of the legacy path.
3. **Migration 0010 is applied to the live DB**: `comments` is keyed by `place_id` (NOT NULL), has `quoted_comment_id` / `quoted_text` / `quoted_author` and `deleted_at`, and has **no** `entry_id`. Build `fetchAllPlaces()` against that shape exactly as the plan shows.
4. **One call site outside this file may be updated:** `src/js/auth.js` line ~93 calls `loadRecs()` inside `showApp()`. Change that single line to `loadPlaces()`. Do not make any other change to auth.js — in particular do not touch the `onAuthStateChange` callback; it deliberately defers work via `setTimeout(0)` to avoid a supabase-js initialization deadlock.

## Scope guardrails

- **Files you may modify:** `src/js/places-service.js`, plus the single line in `src/js/auth.js`.
- **Do NOT touch** `ui-render.js`, `map.js`, `app.js`, `index.html`, or any CSS. They still reference `allRecs` and will be broken at runtime after this phase. That is expected — Phase 3 rewrites the renderer. Do not "helpfully" fix them.
- **Do not commit anything.** Leave all changes uncommitted for review.
- Keep the global variable `allPlaces` (replacing `allRecs`) declared where `allRecs` currently is (`app.js` declares it — leave the old declaration alone; declare `allPlaces` in places-service.js or note it needs a home and ask me).
- The realtime subscription must listen on `places`, `entries`, `comments`, `comment_reactions` — drop the old `recommendations`/`votes` channels.

## Deletions (from the plan, confirmed still accurate)

- `checkForDuplicate`, `closeDupOnBg`, `closeDupPrompt`, `closeDupPromptAndContinue`, `confirmDup`, `confirmAttach`
- `setAttachStatus`, `setAttachStars`, `setAttachFactorStar`, `resetAttachStars`, `submitAttach`
- `_recIdToEntryId` / `_entryIdToRecId` bridge maps and `recIdToEntryId()`
- All `recommendations`, `votes`, and `user_rec_interactions` queries and writes
- `pendingDupId`, `pendingDupIsOwn`, `attachingToId`, `attachStatus`, `attachStars`, `attachFactorRatings` globals

If any of these are referenced from files outside places-service.js, do NOT delete the external references — just delete the definitions here and list the dangling references in your summary so we can address them in Phase 3/4.

## Acceptance check (run before declaring done)

1. `node --check src/js/places-service.js` and `node --check src/js/auth.js` pass.
2. Serve the app locally, sign in, and in the browser console: `allPlaces` shows ~13 places keyed by uuid, each with `takes` (13 entries total across places), `comments` (7 total, with `quotedCommentId`/`mentions` fields), and computed `aggregate`. Cards rendering blank/broken is fine at this stage.
3. Zero remaining references to `fetchAllRecs`, `user_rec_interactions`, or `from('recommendations')` inside places-service.js.

When done: list every function added, changed, and deleted, plus any dangling references you found in other files, and wait for my review. Do not proceed to Phase 3.
