# Session Handoff — 2026-07-30 (v0.5.0 SHIPPED / REL-12 released → start v0.6, REL-13)

**For the next chat.** v0.5.0 is done and released — Phases 1–7 all complete and QA'd PASS.
This session finished **Phase 6 (IT-110)** and **Phase 7 (release wrap)**. The next body of work is
**v0.6 (REL-13) — Implicit Similarity + Blended Trust**. Read this file, then
`workspace/InnerTable-Taste-Profiling-Direction.md` (§0/§6/§7 for the ratified taste-tab direction)
before planning v0.6. There is **no v0.6 implementation plan yet** — writing one is the first task.

## Where things stand

- **Branch `main`, latest commit `709d78f`** — Phase 7 release wrap. Peter committed + pushed, so
  `main` == `origin/main`. Prior: `1fdc2bb` Phase 6 (IT-110), `84f2e39` Phase 5 (IT-050).
- **REL-12 (v0.5.0) is `released`** on the board, with structured `releaseNotes`. **All 7 items done:**
  IT-045, IT-046, IT-047, IT-048, IT-049, IT-050, IT-110.
- Latest migration on disk: **`0023_show_advanced_details.sql`**. **Next migration number = 0024.**
- Full QA log: `workspace/v0.5.0-qa-test-results.md` — Phases 3–6 all PASS.

## What shipped this session

**Phase 6 — IT-110 (stale detail panel after deleting a take).**
- Fix in `src/js/places-service.js`: `deleteEntry` now captures the take's place via a new
  `_placeIdForEntry(entryId)` helper *before* `loadPlaces()` replaces the cache, then updates the
  open detail overlay — **re-renders in place** if takes remain, **closes the panel** if the deleted
  take was the last one. (Mirrors the tags `_refreshOpenDetailPanel` pattern, plus the close-if-empty
  case, because `openPlaceDetail` guards on `if (!place) return` and would otherwise leave stale content.)
- Shipped in its own commit `1fdc2bb`.

**Phase 6 QA — PASS (both cases), logged in `v0.5.0-qa-test-results.md`.**
- Case A (other takes remain → panel refreshes) and Case B (last take → panel closes) both verified
  on deployed prod as `dev.pete.chan@gmail.com`.
- **QA method note for next time:** the delete uses a native `confirm()`, which **freezes browser
  automation and drops the Chrome-plugin connection**. Workaround that worked well: run one real
  end-to-end delete (Peter clicks OK), then stub `window.confirm = () => true` in the page and drive
  the delete via JS so the *panel* behavior can be observed without the freeze. The stub bypasses only
  the dialog, not the code path under test.

**Phase 7 — release wrap (board bookkeeping, committed in `709d78f`).**
- Flipped IT-045/046/047/048/049/110 → `done`; marked **REL-12 `released`** with `releasedAt` +
  structured `releaseNotes` (“✨ What's New” ×6, “🐛 Fixes” ×1).
- `workspace-data.json` was edited programmatically (backup taken first); verified the round-trip is
  byte-clean and the `releaseNotes` shape is exactly
  `{generatedAt, releaseDate, sections:[{heading, notes:[{itemId,title,note}]}]}` — a plain string
  crashes the dev-workspace board, so **keep this shape**.

## Open loose ends (small)

- **Orphan test place `Nando's Soho`** (`places.id = a3053f6a-ba8f-4761-be70-174349ab104e`, 0 takes),
  created for Phase 6 Case B. Hidden from the list but still in the DB (deleting a take never deletes
  the place). Cleanup is a manual Supabase delete — Peter to run when convenient:
  `delete from public.places where id = 'a3053f6a-ba8f-4761-be70-174349ab104e';`
- **Optional v0.4.x regression pass** (friend graph, circle-scoped notes) — plan's Phase 7 item 1,
  not yet run. v0.5.0 features + IT-110 are QA'd; this is belt-and-suspenders on older behavior.
- **Untracked, left uncommitted on purpose:** `workspace/*.backup-*.json` (local safety snapshots)
  and `workspace/session-handoff-2026-07-29-phase5.md`. Add to git only if you want them tracked.

## Next up: v0.6 (REL-13) — Implicit Similarity + Blended Trust

**Goal (board):** compute per-category user↔user similarity from rating overlap, blend it with the
explicit override, and ship two-tier place cards (Google + Circle). **First task: write the v0.6
implementation plan** (same phased format as `workspace/v0.5.0-implementation-plan.md`).

**Ratified taste-tab direction (2026-07-29, Peter)** — see `InnerTable-Taste-Profiling-Direction.md`:
- Taste tab **defaults to the computed profile**; manual entry becomes an optional **override layer**.
- Computed value shown **live** as **“Predicted Similarity”** (no snapshot, no stored delta); the
  engine keeps computing but isn't applied where an override exists.
- Override UX = **0.5-step slider** (Untappd-style); Predicted Similarity rounded to nearest 0.5.
- Deviation display is **passive** (no nudges) at launch.
- **Compute cadence:** recommended **nightly/daily** (matches IT-052); weekly is a future cost
  optimization only — **still Peter's call to finalize.**

**REL-13 backlog (all `backlog`):**
- **Engine/data (build first, in order):** IT-051 `similarity_scores` table + indexes → IT-052 nightly
  Edge Function computing per-category Pearson similarity → IT-053 Empirical-Bayes shrinkage for
  low-overlap pairs → IT-054 blend engine (explicit override + implicit similarity → final trust
  weight) → IT-055 tiered prediction API (structured response per place).
- **UI:** IT-057 two-tier place card (Google + Circle) with a “Show math” peek.
- **Taste-tab rework (the ratified direction above):** IT-112 computed-first tab · IT-113 Predicted
  Similarity + 0.5 override slider + keep/modify/delete · **IT-114 migration widening
  `friend_taste_overrides.weight` `smallint → numeric` for 0.5 steps — BLOCKS IT-113.**
- **Other:** IT-111 anchor-place taste calibration (cold-start/similarity seeding) · IT-115
  adoption/behavioral trust signal (save→visit→rate on a friend's rec) · IT-079 analytics + error
  tracking (PostHog or Plausible).
- Note: IT-112/113 “computed” need the engine (IT-051→054) to exist first — sequence accordingly.

**v0.5.0 forward-compat contract to preserve:** the explicit override stays one source of truth
(`_tasteOverrides`), one write path (`upsertOverride`), with `NULL` (no opinion) ≠ `0` (mute). v0.6
adds the computed weight *next to* each row without forking read or write. Don't collapse NULL→0 —
it poisons the blend.

## Working conventions (unchanged — don't relearn)

- **Commits/pushes come from Peter's environment (Cursor).** The sandbox can't unlink
  `.git/index.lock`. **No commits without Peter's explicit approval.**
- **Migrations:** pre-verify in the sandbox, Peter applies by hand in the Supabase SQL editor, verify
  after applying (0019 silent-miss lesson). **Next migration number = 0024.**
- **`workspace-data.json` edits are main-only** and must keep the structured `releaseNotes` shape.
- **Browser QA via the Chrome plugin against deployed prod works well.** After a debounced write
  (~300 ms) wait ~1.5 s before reading the DB (read-races-write, bit us before). And remember the
  native-`confirm()` freeze workaround noted under Phase 6 QA above.
- **Never hard-delete DB rows from the sandbox/agent** — hand Peter the SQL to run himself.
