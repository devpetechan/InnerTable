# Session Handoff — 2026-07-22 (v0.5.0 Phases 1–2 done → start Phase 3)

**For the next agent session.** Read `workspace/v0.5.0-implementation-plan.md` first
(especially the Design decision record and the Phase 3 section). This file is the
delta: what shipped, what's verified, and the concrete integration points Phase 3 needs.

## Where things stand

- Branch: `feat/v0.5.0-explicit-taste`. Two commits on top of main:
  - `d38a908` — Phase 1: migration **0021** (categories + place_categories + seed + backfill) + test.
  - `8cb6b01` — Phase 2: migration **0022** (friend_taste_overrides) + test.
- **Both migrations are applied to production Supabase and verified** (to_regclass,
  pg_policies, seed counts / trigger check, plus acceptance tests in the SQL editor:
  0021 = 12/12 PASS, 0022 = 18/18 PASS). Both commits are pushed; origin is in
  sync at `8cb6b01`.
- Acceptance tests are **tracked deliverables** in `supabase/snippets/` (gitignore
  exception decided 2026-07-22). Both were also dry-run in the sandbox first
  (embedded Postgres + Supabase-faithful stub; migrations applied twice to prove
  idempotence).
- `workspace/workspace-data.json` is modified in the working tree but is **main-only —
  never commit or edit it on this branch** (structured `releaseNotes` shape, see plan
  Phase 7). The untracked plan/handoff/backup files in `workspace/` stay uncommitted
  for now.
- **Next: Phase 3** — taste service layer + casual 5-dot grid (IT-047). Phases 4–7
  follow per the plan. No commits until Peter reviews each phase.

## What the DB now gives you (the Phase 3 contract)

- `public.categories` — 19 seeded rows: 16 `cuisine` + 3 `venue_type`
  (`cocktail-bar`, `wine-bar`, `craft-beer`); catch-all `other` sorts last
  (`sort_order 900`; dropdown cuisines 10–150, venue types 200–220 — ORDER BY
  sort_order gives display order). Read-all for authenticated, **no client writes**.
- `public.place_categories` — read-all join, no client writes (editing UI deferred).
  12 production places have ≥1 row, 3 don't (empty/unmapped cuisine) — known, fine.
- `public.friend_taste_overrides` — the Phase 3 write target:
  - Columns: `rater_id` (me), `friend_id` (them), `category_id`, `weight smallint
    NULL CHECK (0..5)`, `updated_at`. PK `(rater_id, friend_id, category_id)`;
    `rater_id <> friend_id` CHECK.
  - RLS: own rows only (`rater_id = auth.uid()`), all four verbs. Overrides are
    **private to the rater** — no realtime needed, explicit refresh after own
    writes is trivially correct here.
  - `updated_at` auto-refreshes via trigger on UPDATE, so a plain
    `.upsert(..., { onConflict: 'rater_id,friend_id,category_id' })` is enough.
  - Non-friend guard is deliberately absent (commented-out note in 0022 §4):
    writing an override for a stranger is allowed and harmless.

## NULL vs 0 — the invariant Phase 3 must not break

`NULL` = no opinion / use default. `0` = explicit mute. These are different and the
DB keeps them distinguishable (tested). Per the plan:

- The **casual 5-dot grid does not expose 0** (mute lives in quant mode, Phase 4).
- **Clearing a cell DELETEs the row** (back to default) — it must never write 0.
- If any write path coerces "cleared" → 0, it poisons the v0.6 blend (plan Risks).
  Keep this in the Phase 3 acceptance check: cleared cell → row gone (or weight
  NULL), reload shows saved state.

## Phase 3 integration points (verified against the code, not the plan's guesses)

- **No bundler, no modules.** `index.html` loads plain `<script src>` tags in order
  (env → config → utils → app → auth → external-aggregates → places-service →
  friends-service → ui-render → map → ui-events). A new `src/js/taste-service.js`
  must be added to that list (after friends-service, before ui-events) and shares
  globals implicitly. The Supabase client is the global `supabaseClient`.
- **Friends data:** `friends-service.js` has no exported `getMyFriends()` (the plan's
  name is aspirational). It keeps module-global state: `myFriends` = accepted edges
  enriched with an embedded `profile` (`{ id, display_name, handle, avatar_url, bio }`),
  loaded by `loadFriends()`. Reuse that state/loader for the grid rows (accepted only)
  rather than duplicating the query — check how the friends screen triggers
  `loadFriends()` before relying on it being populated.
- **Screens & events:** the Friends screen swaps the list region while the header
  stays (see `app.js` ~line 60–94 and `setView()`); static event listeners live in
  `ui-events.js` by convention; rendering helpers in `ui-render.js`; styles in
  `src/styles/main.css` (tokens under `src/styles/tokens/`).
- **Most-used categories** (`getMostUsedCategories()`): personalize from the user's
  own entries → `entries.place_id` → `place_categories` → `categories`. Note the
  3 uncategorized places and any unmapped cuisine simply don't count — fine.
  Fall back to seed `sort_order` when the user has few/no categorized entries.
- **Service shape per plan:** `getCategories()`, `getMyOverrides()`,
  `upsertOverride(friendId, categoryId, weight|null)` (delete when cleared),
  `getMostUsedCategories()`. Debounced ~300 ms save-as-you-go.

## Working conventions (unchanged, hard-won — don't relearn)

- Sandbox git can commit but **cannot switch branches / unlink files**; pushes come
  from Peter's terminal. A failed git op leaves `.git/index.lock` only Peter can rm.
- Migrations (none expected in Phase 3): pre-verify in sandbox (`npm install
  embedded-postgres pg` in a scratch dir; must run **outside** the sandbox for
  shmget), Peter applies by hand in the SQL editor, verify after (0019 lesson —
  misses are silent). Next number would be 0023.
- Test-harness gotchas (if you touch the SQL tests): cast `pg_attribute.attname::text`
  before array comparisons; RLS write denials raise `insufficient_privilege` (42501);
  RLS-filtered UPDATE/DELETE just affect 0 rows (no error); `_results` bookkeeping
  only after `RESET ROLE`.
- Browser QA via the Chrome extension against the deployed app; native `confirm()`
  dialogs freeze automation — Peter clicks those. Explicit refresh after own writes
  (IT-107); realtime is only for *other* users' changes.

## Open items (non-blocking)

- 3 production places lack a category row (empty/unmapped cuisine) — waits for the
  deferred place→category editing UI.
- The cuisine→slug normalization exists in both 0021 §5 and test_0021 — keep in
  sync if it ever changes.
- Free-text `places.cuisine` / `place_type` stay as fallback; cleanup is later.
- IT-110 (stale detail panel after delete) is Phase 6, untouched.
