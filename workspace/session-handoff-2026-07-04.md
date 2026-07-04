# InnerTable — Session Handoff (2026-07-04)

Context for continuing work. Previous session completed IT-035/IT-036 (v0.3
"one place card, many takes" refactor) end to end. All claims below were
verified by testing, not assumed.

## Current state — code

- Repo: github.com/devpetechan/InnerTable. Branches `main` and
  `feat/IT-035-place-cards` are merged and pushed; live site (GitHub Pages
  from main) serves the current build and works in Chrome + Safari.
- IT-035 phases 1–5 done and deployed: places/entries data adapter
  (`allPlaces`, place-keyed), one-card-per-place renderer with stacked takes,
  place-upsert + entry write path (no duplicate modal), per-place comment
  threads with @-mention autocomplete/chips and quote replies (snapshot
  columns; quotes survive deletion of the original).
- supabase-js pinned to 2.110.0 in index.html (was unpinned @2 — a silent
  CDN upgrade caused an auth deadlock).
- auth.js: onAuthStateChange defers Supabase calls via setTimeout(0) —
  DO NOT make that callback async or call Supabase directly in it (deadlock).
- Comment writes call loadPlaces() explicitly after insert/update/delete —
  belt-and-braces alongside realtime.

## Current state — database (Supabase)

- Schema at migration 0010: comments keyed by place_id (NOT NULL) with
  quoted_comment_id/quoted_text/quoted_author + deleted_at; comment_reactions
  (comment_id,user_id PK); places/entries live; legacy `recommendations`
  table still exists (14 rows) pending IT-037.
- Entries columns are overall_rating/quality/service/value/ambiance
  (NOT rating_overall etc. — the IT-035 plan doc has stale names).
- A DB restore in July had clobbered 0009/0010; remediated via
  scripts/restore-remediation-2026-07-03.sql (7 comments + reactions
  migrated, comments_v2 dropped). Realtime publication was fixed by adding
  places/entries/comments/comment_reactions to supabase_realtime.
- .env.local is untracked from git (was leaking); src/js/env.js is
  intentionally committed (Pages serves it; anon key is public by design,
  RLS is the security layer).
- Redirect URLs include http://localhost:8080/** (wildcard needed —
  exact-match rejected the trailing slash and silently bounced to Site URL).

## Manual QA (Phase 7) — PASSED

Full pass in Chrome and Safari on localhost: map pins deduped, Google
autocomplete add, realtime cross-window updates, two-account test (stacked
takes, mentions, quote replies). Machine-tested earlier: all Phase 2–5
acceptance checks (see workspace/phase-2-4-test-results.md).

## Open items (start here)

1. IT-035 Phase 6 cleanup (small): remove vestigial `let allRecs = {}` in
   app.js:18; decide whether to commit workspace/phase-2-4-test-*.md docs.
2. Tracker hygiene: mark IT-035 + IT-036 done in dev-workspace (user was
   re-adding a GitHub PAT to the tracker; data file
   workspace/workspace-data.json is intact — 83 items, 18 releases).
3. Verify the ZZZ IT-035 Test Bistro place row was deleted from prod
   (SQL: DELETE FROM public.places WHERE name LIKE 'ZZZ%').
4. Next backlog (v0.3 remainder, then close REL-10):
   - IT-056 [P1/M]: cache Google Places aggregate ratings in a
     place_external_aggregates table with TTL; cards read cache, not live API.
   - IT-037 [P2/S]: 3-phase legacy `recommendations` teardown (rename →
     strip columns → drop) — deliberately starts a few days after v0.3
     has been live (clock started 2026-07-04).

## Known issues / backlog notes (not urgent)

- Google-auth users display as raw emails (users.display_name empty);
  author filter matches by display-name string — collision-prone; should
  match user_id. Fold into IT-039/onboarding.
- Orphaned places: deleting a place's last take leaves an empty card and a
  DB row (no client DELETE policy on places). Product decision needed.
- Deleting a comment leaves a "Comment deleted." stub in the thread (soft
  delete by design).
- Old Google Maps API key exists in git history — confirm the current key
  has HTTP-referrer restrictions in Google Cloud console.
- Tracker (dev-workspace.html) stores its GitHub PAT + cache in
  localStorage, which is per-origin — always open it the same way, or it
  looks empty.

## Working conventions

- Never commit without explicit user approval (project rule).
- User is a PM learning to code — explain concepts as you go.
- User codes via Claude in Cursor/VS Code; this assistant can test the app
  live through the user's Chrome (navigate/JS-execute on localhost or the
  Pages site) and verify writes directly against Supabase — use that for
  acceptance testing instead of asking the user to click through.
