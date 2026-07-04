# IT-035 Phases 2–4 — Acceptance Test Plan

Run top to bottom. Each step says what to do and what you should see. If a step
fails, stop and note the step number — later steps assume earlier ones passed.

## Setup (one-time)

1. **Start a local server** in the repo root. Easiest: VS Code → right-click
   `index.html` → "Open with Live Server", or in a terminal:
   `python3 -m http.server 8080`. Open `http://localhost:8080`.
2. **Allow localhost in Supabase** (or sign-in will bounce): Supabase dashboard
   → Authentication → URL Configuration → Redirect URLs → add
   `http://localhost:8080`. Without this, Google sign-in redirects you back to
   the deployed site instead of localhost.
3. Keep the browser DevTools console open (F12) for the whole session.

## Known limitations — do NOT count these as failures

- **Comments don't render anywhere yet.** That's Phase 5. Missing comments = expected.
- **Don't click reaction emojis** if any appear — `toggleReaction` still
  references the old data model (dangling ref, cleaned up in Phase 5).

---

## Phase 2 — data adapter (console checks)

| # | Do | Expect |
|---|---|---|
| 2.1 | Sign in, wait for load, type `allPlaces` in console | An object with ~13 entries keyed by uuid |
| 2.2 | Expand any place | Has `name`, `takes` (array), `comments` (array), `aggregate` with `avgRating`/`recommends`/`wantsToGo` |
| 2.3 | In console: `Object.values(allPlaces).reduce((n,p)=>n+p.takes.length,0)` | `13` (total entries) |
| 2.4 | In console: `Object.values(allPlaces).reduce((n,p)=>n+p.comments.length,0)` | `7` (total comments — in data even though not rendered) |
| 2.5 | Check console for red errors during load | None (warnings OK) |

## Phase 3 — renderer (one card per place)

| # | Do | Expect |
|---|---|---|
| 3.1 | View All → count cards | ~13 cards, **no duplicate restaurants** |
| 3.2 | Find a place with takes from 2+ people | One card, takes stacked inside with avatar/status/stars each |
| 3.3 | Same card | Aggregate row: "★ x.x (n ratings) · Recommended by …" |
| 3.4 | Click "Just mine" filter | Only places where **you** have a take |
| 3.5 | Status tabs (Want to Try / Recommended) | Filters by takes, not whole places |
| 3.6 | Map view | One pin per place (no stacked/duplicate pins); clicking a pin opens the detail panel with all takes |
| 3.7 | Your own take shows Edit/Delete buttons; others' takes don't | Correct per take |

## Phase 4 — write path

| # | Do | Expect |
|---|---|---|
| 4.1 | Add a brand-new place via Google autocomplete (a real spot you know) | Toast success, one new card appears with your take |
| 4.2 | Supabase → Table Editor → `places` and `entries` | Exactly **one new row in each**; entry has your user_id + the new place_id |
| 4.3 | Add a place that **already exists** on the list (one someone else added) | **No duplicate-prompt modal.** Your take appears stacked on the existing card |
| 4.4 | Table Editor again | **No new `places` row**, one new `entries` row |
| 4.5 | Edit your take (change rating) | Card updates; `entries` row updated; `places` row untouched |
| 4.6 | Delete your take on the shared place (4.3) | Your take gone; **card still there** with the other person's take |
| 4.7 | Delete your take on the new place (4.1) — you're the only take | Your take gone. Card behavior is a design question: place may remain with zero takes or disappear — note which happens |
| 4.8 | Reload the page after all of the above | Everything persists; no console errors; sign-in survives reload (deadlock fix regression check) |

## Cleanup

Delete the test place you created in 4.1 from the Supabase Table Editor
(`places` row + any orphaned `entries` rows), unless it's a real spot you
want to keep.

## Multi-user test (optional, needs a second Google account)

In an incognito window, sign in as the second account and repeat 4.3–4.4
against a place the first account added. This is the real proof of "one place,
many takes". If you don't have a second account handy, steps 4.3–4.4 with the
DB checks cover most of the same risk.

---

**Report back:** which steps passed/failed, plus what happened in 4.7.
