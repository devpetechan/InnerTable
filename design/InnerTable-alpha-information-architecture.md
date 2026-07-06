# InnerTable — Alpha Information Architecture

The current app has two competing navigation systems: a Home hero with four CTA buttons (View All / View Restaurants / View Bars / Add Place), and — below it — a List section with its own status tabs, a List/Map toggle, and three inline filter bars. They overlap and confuse. This replaces both with **one model**.

---

## The one rule

**There is a single primary surface: The List.** It's the shared Inner Table. Everything else is either a lens onto that list, a detail view of one item in it, or the action of adding to it. No separate "home" screen.

---

## Objects (the nouns, in user language)

- **Place** — a restaurant or bar. Has a name, type, tags (cuisine, price, neighborhood), and an aggregate friend signal. Contains Takes and a Comment thread.
- **Take** — one friend's position on a place. Exactly one of three states: **Want to Try**, **Recommends**, or **Hard Pass**. A "Recommends" or "Hard Pass" take can carry a rating and a note.
- **Comment** — a message on a place's thread.
- **You** — your identity + avatar. Minimal for alpha (just needed to attribute takes and sign out).

---

## Screen hierarchy (the sitemap)

```
Sign in (Google)
│
└── THE LIST  ← default landing, the home of the app
    │   ├─ Primary lens: status segments  [ All | Want to Try | Recommended ]
    │   ├─ Secondary controls: one "Filter & sort" button → opens a sheet
    │   │     • Type: Restaurant / Bar
    │   │     • Author: Everyone / Just mine
    │   │     • Sort: Recent / Rating
    │   ├─ (Optional) List ↔ Map toggle — low priority, can defer
    │   ├─ Place cards (the scannable list)
    │   └─ [+ Add] — persistent action
    │
    ├── PLACE DETAIL   ← tap a card
    │     • Full friend signal + all takes + comment thread
    │     • "Add your take" (opens Add flow, place pre-filled & locked)
    │
    └── ADD FLOW   ← from [+ Add] or "Add your take"
          ├─ Mode: Want to Try   (fast path: name, optional note, optional link)
          └─ Mode: I've Been     (rating, recommend/hard-pass, optional details)
```

---

## The key decisions this settles

**1. Status is the ONE primary axis; everything else is secondary.**
The current app treats status (tabs), type (filter bar), author (filter bar), and sort (filter bar) as four equal, always-visible controls. They're not equal. **Status** — "have we been, or do we just want to go?" — is the decision-relevant split: "where should we eat tonight" (Recommended) vs. "what's on our someday list" (Want to Try). It gets top billing as segments. Type, author, and sort are refinements — they live behind a single "Filter & sort" control, not three inline bars.

**2. Kill the Home hero. Fold its buttons into the List.**
"View All / View Restaurants / View Bars" are just the Type filter in disguise, and "Add Place" is the persistent action. The hero duplicates controls that already exist below it. Removing it means the user lands directly on content — the single biggest clarity win.

**3. One "Add" concept, two entry points, two modes.**
- Entry point A: the global **[+ Add]** (a new place from scratch).
- Entry point B: **"Add your take"** on an existing card (place is pre-filled and locked; you only add your position).

Both open the *same* flow. Inside, the user picks a mode: **Want to Try** (near-instant) or **I've Been** (fuller review). This removes the current confusion where adding a place and adding a take feel like different, half-overlapping things.

**4. Cards are summaries; the detail view is where depth lives.**
The card shows the at-a-glance friend signal and maybe the top take. Full take stack + comments open in **Place Detail** on tap. Today everything is inline, which is why cards are enormous. Push depth one level down.

**5. Map is a toggle, not a destination.**
For alpha, if the map stays at all, it's a view toggle on the List — not a separate section with its own detail panel. That panel (currently a separate side-panel render of the card) goes away; there's one detail view, reached from either list or map.

---

## What this deliberately leaves out (not alpha IA)

Profile pages, settings beyond sign-out, notifications, invitations/friend management UI, and any trust-math / "show the math" surface. They're real eventually — they're not part of the alpha's navigational skeleton, so they don't belong in this diagram yet.

---

## How to hand this to Claude Design

Give it this hierarchy as the fixed structure, then run the screen prompts against it: "The List" = Prompt 1 (browse screen), "Place card" = Prompt 2, "Add flow" = Prompt 3. Tell the tool the nav model is settled and not up for redesign — you want visual options *within* this structure, not alternative structures.
