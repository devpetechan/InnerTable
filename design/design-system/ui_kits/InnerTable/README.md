# InnerTable UI kit

Click-through recreation of the alpha's core loop: **The List** (with status segments, List/Map toggle, and the 4b place card) → **Add flow** (guided multi-step: place → intent → review), triggered either from the FAB (new place, starts at step 1) or a card's "Add your take" / "I've been" action (place pre-filled & locked, starts at step 2).

Composes the shared primitives in `components/` — `PlaceCard`, `Button`, `Avatar`. `TheList.jsx` and `AddFlow.jsx` are screen-level, not reusable primitives (no sibling `.d.ts`).

**Not yet designed, intentionally omitted:** Place Detail (full take stack + comment thread) and the real Map view (pins near the user). The List's Map toggle currently shows a placeholder note rather than an invented design — see readme.md → Open items.
