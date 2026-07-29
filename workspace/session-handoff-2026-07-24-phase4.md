# Session Handoff — 2026-07-24 (v0.5.0 Phase 3 done + QA'd → start Phase 4)

**For the next agent session.** Read `workspace/v0.5.0-implementation-plan.md` first
(the Design decision record + the **Phase 4** section), then this file — it's the
delta since the Phase 3 handoff: what shipped, what QA verified, the loose ends,
and the code-verified integration points Phase 4 needs.

## Where things stand

- Branch/deploy state changed this session: Phase 3 was **merged to `main` and
  deployed** for prod QA. The repo is currently checked out on **`main`**, in sync
  with `origin/main`, at:
  - `93a89a0` — **Phase 3**: taste service + casual 5-dot grid (IT-047). 4 files
    (`src/js/taste-service.js` new, `index.html`, `src/js/friends-service.js`,
    `src/styles/main.css`).
  - `8cb6b01` — Phase 2 (migration 0022) · `d38a908` — Phase 1 (migration 0021).
  - `feat/v0.5.0-explicit-taste` points at the same commit (main fast-forwarded to
    it). **Confirm with Peter which branch to commit Phase 4 on** — the effective
    workflow is now "commit on the branch → merge to `main` to deploy each phase for
    prod QA." Don't assume; the checkout is on `main` right now.
- **Phase 3 QA: PASS** (Parts 0–7) on deployed prod, automated by Claude via the
  Chrome plugin (real dot clicks + RLS-respecting `supabaseClient` console checks).
  Full results: `workspace/v0.5.0-qa-test-results.md`. The **NULL≠0 invariant is
  confirmed** — the casual grid never writes `0`; clearing DELETEs the row.
- Migrations 0021/0022 remain applied + verified in prod. **Phase 3 had no
  migration; the next migration number is 0023** (Phase 4 will likely need one — see
  below).

## Uncommitted / untracked in the working tree (read before you commit anything)

- **`src/styles/main.css` — MODIFIED, and it is NOT mine and NOT Phase 3.** It's an
  IT-106 polish (settings-modal header padding so the title/close button don't hug
  the modal edges). It appeared during/after QA and is live-uncommitted on `main`.
  Decide with Peter: commit it on its own (e.g. "IT-106 polish: settings modal
  header padding") or discard. Don't silently fold it into a Phase 4 commit.
- **`workspace/workspace-data.json` — MODIFIED — main-only.** Never commit or edit it
  from a feature branch (structured `releaseNotes` shape; plan Phase 7). Leave it.
- **Untracked `workspace/*.md`** (this handoff, the Phase 3 handoff, the plan, the new
  `v0.5.0-qa-test-plan.md` + `v0.5.0-qa-test-results.md`, the backup json) stay
  **uncommitted** for now — same convention as before.

## Loose ends from Phase 3 QA (non-blocking, but close them)

- **Leftover test row:** `friend_taste_overrides` has one row — `Peter × Indian,
  weight = 4` (created for QA step 4.3, account `dev.pete.chan@gmail.com`). Delete it
  for a clean slate:
  `delete from public.friend_taste_overrides where rater_id = auth.uid();` (run from
  the app console as that user — SQL editor runs as service role, `auth.uid()` is null there).
- **Part 6.2 (personalization positive case) inconclusive:** the QA account has **no
  own rated places**, so "most-used cuisines surface first" fell back to seed order
  (correct, but the positive case wasn't demonstrated). Re-run on an account with
  several own ratings.
- **Part 7.4 (Remove-friend row disappears from the grid):** not run — native
  `confirm()` freezes automation; **Peter** clicks it.
- **Part 7.5 (mobile layout):** the plugin couldn't shrink the viewport below
  ~1298px; the sticky-name/horizontal-scroll mechanism is confirmed, but eyeball the
  4-tab fit on a real phone.
- **Map base tiles render grey** in Map view (markers fine) — pre-existing, unrelated
  to Phase 3, **not** an REL-12 item; noted for awareness.

## Phase 4 = Quant mode (IT-048) + global "advanced details" toggle (IT-049)

Two skins over the **same** `friend_taste_overrides` dataset — no new columns on that
table. The service layer already does what Phase 4 needs; most work is UI + a
persisted app-level flag.

### The toggle (IT-049) — build it app-level, not taste-page-local

- Plan is explicit (Risks): a page-local flag would have to be rebuilt for v0.6 score
  breakdowns. Make it a general app preference, **persisted server-side**.
- Natural home: a new boolean on `public.users` (e.g. `show_advanced_details boolean
  NOT NULL DEFAULT false`) → **migration 0023** (pre-verify in sandbox, Peter applies
  by hand, verify after — 0019 silent-miss lesson). The profile-settings path already
  writes `users` (`openProfileSettings`/`saveProfileSettings` in
  `friends-service.js`, reading/writing `handle,bio,allow_email_lookup`) — add the
  toggle there and/or in the account menu (`#user-menu` in `index.html`).
- `currentUser` (global, shape `{ id, display_name, avatar_url, is_admin }`) is
  hydrated in `auth.js` `showApp()`. Load the new pref alongside it into a global
  (e.g. keep on `currentUser` or a dedicated `advancedDetails` flag) so any surface
  can read it. Flipping it must re-render the active surface and persist.

### Quant view (IT-048)

- Same rows shown as precise sliders/number inputs; **exposes the full category list**
  and the explicit **`0`/mute** state distinct from unset.
- **The taste-service write path already handles this correctly** —
  `upsertOverride(friendId, categoryId, weight)`:
  - `1..5` → upsert; **`0` → upsert (mute)** — the `weight BETWEEN 0 AND 5` CHECK
    allows 0; nothing special needed;
  - `null` → DELETE (back to default/no-opinion).
  So "set mute" = `upsertOverride(f, c, 0)` and "clear to default" =
  `upsertOverride(f, c, null)`. That gives you `0` vs no-row(≈NULL) distinctly, which
  is exactly the Phase 4 acceptance check.
- Rendering: `renderTasteGrid()` in `taste-service.js` currently renders the casual
  dots and treats `0`/NULL/absent identically as empty (correct for casual). Branch on
  the toggle — either extend `renderTasteGrid()` or add a sibling `renderTasteGridQuant()`
  that reuses the same `_tasteOverrides` state + `upsertOverride` but renders inputs
  that show and can set `0`/mute. Keep the debounced-save pattern (`_tasteSaveTimers`,
  ~300 ms) and the horizontal-scroll/sticky-first-column table shell.
- `_tasteDotCellHtml` maps weight `0` → 0 filled dots on purpose (casual hides mute);
  don't "fix" that. Quant gets its own cell renderer.

### Touches (per plan)

`taste-service.js`, `index.html`, `app.js`, `src/styles/main.css`, and the
settings/menu path in `friends-service.js`; migration **0023** for the `users` flag.

### Phase 4 acceptance check (from the plan)

Toggle flips **both** surfaces and persists across reload; a weight set in casual
shows identically in quant and vice-versa; quant can set and clear `0`/mute and it
round-trips **distinct from NULL**.

## Working conventions (unchanged — don't relearn)

- **Sandbox can commit but cannot switch branches / push / unlink files.** Pushes +
  branch merges come from **Peter's terminal**. A failed git op leaves
  `.git/index.lock` only Peter can rm.
- **Browser QA via the Chrome plugin against the deployed prod app works well** — it
  drove real dot clicks and ran `supabaseClient` reads in the page console this
  session. Use console reads (RLS-respecting, run as the user) as the source of truth,
  not the SQL editor (service role bypasses RLS; `auth.uid()` is null there). **Native
  `confirm()` dialogs freeze automation — Peter clicks those.**
- **Explicit refresh after own writes** (IT-107); realtime is only for *other* users'
  changes. Overrides are private to the rater, so no realtime is involved at all.
- Migrations: pre-verify in the sandbox (`embedded-postgres` + `pg` in a scratch dir,
  **outside** the sandbox for shmget), Peter applies by hand in the SQL editor, verify
  after with `to_regclass` / row counts / `pg_policies`.
- Local static QA server (if useful): `python3 -m http.server 8000` from repo root;
  it talks to prod Supabase (Google OAuth redirect may not allow `localhost:8000`, so
  prod is the reliable QA target).

## Deferred (unchanged from the plan)

Phase 5 (friend-profile tuning, IT-050), Phase 6 (IT-110 stale detail panel), Phase 7
(QA + release: backlog statuses IT-045–050/110 → done, REL-12 released, the main-only
`releaseNotes` update). Anchor calibration (IT-111) and any similarity/blend math are
v0.6.
