# Session Handoff — 2026-07-13 (post-v0.4.0, start of v0.5.0)

**For the next Claude session.** Read this plus `InnerTable-Vision-and-Strategy.md` and
`workspace/v0.4.0-implementation-plan.md` (its Design Decision Record especially) before planning REL-12.

## Where things stand

- **v0.4.0 (REL-11, Friend Circles) is RELEASED.** Merged to `main`, deployed via GitHub Pages,
  migrations **0017–0020** applied to production Supabase, QA passed
  (`workspace/v0.4.0-qa-test-results.md`: 42/42 automated DB checks + browser pass).
- `main` is the only branch; working tree clean; origin in sync at `3574ecf`.
- One carried item: **IT-110** (P3, stale detail panel after delete) now in REL-12.
- To confirm with Peter: his manual two-account checks (realtime badge across browsers,
  remove/block via UI, handle+email search end-to-end) and pull-to-refresh on iPhone.

## Decisions that constrain future work (details in the v0.4.0 plan's decision record)

1. **Ratings are network signal; notes are candor.** `entries` (status + ratings) is member-visible;
   free text lives in `entry_notes` / `comments` behind circle-scoped RLS. No per-entry visibility
   selector, no private flag. The trust engine (v0.6+) may compute over ALL ratings server-side —
   RLS on client reads never blocks SECURITY DEFINER computation.
2. **Quote replies are fail-closed:** visible only if the viewer is in the quoter's AND the quoted
   author's circles (`comments.quoted_user_id`, trigger-derived).
3. **Friendships = two directional rows**, all writes via SECURITY DEFINER RPCs
   (`send/respond/cancel_friend_request`, `remove_friend`, `block_user`, `unblock_user`).
   `is_accepted_friend(a,b)` is the shared RLS helper — reuse it.
4. **Feed chips are lenses, not walls** (My Circle / Just Mine / Everyone, default My Circle).

## Working conventions (hard-won this release — don't relearn them)

- **`workspace/workspace-data.json` is main-only** (also in project instructions). Never edit it on a
  feature branch. Its `releaseNotes` field must be the **structured shape**
  `{generatedAt, releaseDate, sections:[{heading, notes:[{itemId,title,note}]}]}` — a plain string
  crashes the dev-workspace releases board (that outage happened 2026-07-13). `nextItemId` is 111.
- **Claude's sandbox git cannot unlink files**: no branch switching from the sandbox (checkout/merge/
  cherry-pick corrupt the index); commits usually work; a failed op leaves `.git/index.lock` that only
  Peter can `rm`. Pushes always come from Peter's terminal. Peter's git editor is now `cursor --wait`.
- **Migrations are applied by hand in the SQL editor and misses are silent** — 0019 was skipped for a
  while. Always verify after applying (e.g. `pg_publication_tables`, `to_regclass`). Candidate 0.5.0
  tooling upgrade: Supabase CLI `db push`.
- **Test pattern that works:** each migration ships with a self-cleaning SQL-editor acceptance test in
  `supabase/snippets/` (impersonation via `request.jwt.claim.sub`, temp `_results` table, fixtures on
  `*.invalid` emails; bookkeeping only after `RESET ROLE`). Pre-verify in the sandbox via
  `/tmp/node_modules/@embedded-postgres/linux-arm64` + `pg` (npm), with a Supabase-faithful stub
  (real `auth.uid()` impl + 0001 signup trigger).
- Claude can run browser QA via the Chrome extension (SQL editor + deployed app at
  https://devpetechan.github.io/InnerTable/). Native `confirm()` dialogs freeze automation — Peter clicks those.
  Monaco insert: click into editor first, then `execCommand('insertText')`; verify before running.
- Explicit refresh after own writes; realtime is for other users' changes (IT-107 lesson). All 7 app
  tables are in the `supabase_realtime` publication.

## REL-12 — v0.5.0 Explicit Taste Preferences (next up)

Backlog: IT-045 (categories reference table + seed), IT-046 (`friend_taste_overrides` table),
IT-047 (casual 5-dot "rate my friends' taste" grid), IT-048 (quant slider view), IT-049 (global
"show advanced details" toggle), IT-050 (taste tunings on friend profile) + carried IT-110.

Notes for planning:
- This is the first Taste Model piece — **Pandora-not-Spotify / Barra-not-PCA** (interpretable,
  per-category factors) and the **two-mode UI** (casual vs quant) from the vision doc's Trust
  Transparency pillar apply directly. IT-047/048 are the two modes of the same data.
- The vision doc references a companion **Trust-Model Rationale doc that does not exist yet**
  (Pearson, Empirical Bayes shrinkage, decay). v0.5.0's explicit overrides don't need the math, but
  the schema should anticipate v0.6 blending — worth drafting at least the schema-relevant part.
- Friend profile page (`friends-service.js`) is where IT-050 lands; categories likely also relate to
  place tags / cuisine fields — decide the relationship in the plan.
- Start with an implementation plan doc (pattern: `workspace/v0.4.0-implementation-plan.md`), phased
  for one-session chunks, sandbox-tested migrations, acceptance checks per phase, no commits without
  Peter's approval.

## Key file map

`supabase/migrations/0017–0020` (graph, privacy, tags, realtime) · `supabase/snippets/test_*.sql`
(acceptance tests) · `src/js/friends-service.js` (graph + profile + settings) · `src/js/places-service.js`
(data layer, tags, notes split) · `src/js/ui-render.js` / `map.js` (lenses) · `workspace/dev-workspace.html`
(PM board, reads workspace-data.json from `main` via GitHub API).
