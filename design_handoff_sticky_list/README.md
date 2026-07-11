# Handoff: The List — static top controls, scrolling cards

## Overview
This changes the InnerTable "The List" screen so the top control area is **static/pinned** and only the cards below it **scroll vertically**. Today the entire screen scrolls as one page — the status tabs, List/Map toggle, count, and Filter button scroll away with the cards. After this change they stay fixed while the card list scrolls underneath.

This is a **layout-only** change. No colors, type, spacing, radii, shadows, or component styling change. Follow the existing "Quiet Utility" tokens and component styles already in the codebase.

## About the design files
`List Sticky Header.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing the intended layout and behavior, not production code to copy directly. It uses the InnerTable design-system components/tokens to mock the screen. The task is to reproduce this layout behavior in the real product's existing environment (the vanilla JS + `main.css` app), using its established markup and CSS patterns.

Target repo: **devpetechan/InnerTable**
- `src/js/ui-render.js` — the List markup generation
- `src/styles/main.css` — the shipped stylesheet (ground truth for all values)
- `src/js/ui-events.js` — tab / toggle / filter wiring (behavior must be preserved)

## Fidelity
**High-fidelity for layout/structure.** The visual styling of every element is already correct in the shipped app and must not change — only the scroll/pin structure changes. Do not restyle; reuse existing classes and tokens.

## The screen: The List

### Purpose
The one home screen. Users scan their group's saved places, switch between status filters and List/Map, and add a place.

### Layout — target structure
Make the List screen a **fixed-height flex column** so the page itself does not scroll:

- Screen root: `height: 100%` (use `100dvh` at the app shell if the screen is the top-level view), `display: flex; flex-direction: column; overflow: hidden;`
- **Static top region** (`flex-shrink: 0`) containing, top to bottom:
  1. Header row — "Inner Table" wordmark (left) + user avatar (right)
  2. Status tabs segmented control — All / Want to Try / Recommended (full width)
  3. Controls row — List/Map segmented toggle (left, auto width) · "PLACES · N" count (center, mono micro-label) · "≡ Filter" button (right)
  - Keep the existing `1px solid var(--color-divider)` bottom border on this region.
  - Add a subtle separation shadow beneath it: `box-shadow: 0 6px 14px -10px rgba(0,0,0,.25);`
- **Scroll region** (`flex: 1; overflow-y: auto;`) containing the cards grid:
  - Grid: `display: grid; grid-template-columns: minmax(0,1fr); gap: 12px;`
  - Padding: `16px 20px 120px` — the bottom padding keeps the FAB from covering the last card.
- **FAB** — pinned bottom-right relative to the **screen**, not inside the scroll region (so it doesn't scroll). Existing FAB styling/position is unchanged; just make sure its containing block is the screen root (e.g. root `position: relative`, FAB `position: absolute; right; bottom`), not the scroll container.

The Filter panel, when opened, can appear either inside the static region (pushing the scroll area down) or as the existing inline panel — keep current behavior; just ensure it doesn't break the flex column.

### Components (all already styled — reuse as-is)
- Header wordmark: Hanken Grotesk 800, `-0.02em`, `var(--color-text)`.
- Avatar: existing `.avatar` (colored initials circle).
- Segmented controls: existing `.seg-*` / `.view-tab` track variant.
- Count micro-label: `var(--font-mono)`, uppercase, `.14em` tracking, `var(--color-text-muted)`, with the pill number on `var(--color-canvas)`.
- Filter button: `1px solid var(--color-border-tag)`, `var(--color-card)` bg, `var(--color-text-secondary)`, radius 9px, min-height 34px; hover tints toward the clay accent per the existing hover rule.
- PlaceCard: existing `.place-card` — unchanged.
- FAB: existing `.fab` with `--shadow-fab` — unchanged.

## Interactions & behavior (preserve exactly)
- Status tabs filter the list: **All** = everything; **Want to Try** = `status` of `try` or `mixed`; **Recommended** = `status` of `rec` or `mixed`.
- The **"PLACES · N" count must update** to the filtered count as tabs change.
- List/Map toggle switches the scroll-region content between the card grid and the map view.
- Filter button opens/closes the existing filter panel.
- Scrolling the card region must leave the entire top region **completely stationary** (no reflow, no jump).
- Keep all existing transitions (short `.1–.3s` ease on color/bg/border/transform). No new animation.

## State
No new state required. Reuse existing `view` (active status tab), `mode` (list/map), and filter-panel open state. Count derives from the filtered list length.

## Design tokens (do not introduce new values)
Use the existing tokens only: `--color-bg`, `--color-canvas`, `--color-card`, `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-divider`, `--color-border-tag`, `--color-primary`, `--color-primary-tint`, `--font-ui`, `--font-mono`, `--shadow-fab`. Radii/spacing per the shipped scale. The only new declaration this change introduces is the separation `box-shadow` on the static top region noted above (a soft, warm, outer shadow consistent with the system).

## Assets
None. No new icons or images — the "≡" filter glyph and "+" FAB glyph are existing CSS/Unicode per the design system's iconography rules.

## Files in this bundle
- `List Sticky Header.dc.html` — the layout prototype (open in a browser to see the pinned-top / scrolling-cards behavior). Reference only.

## Acceptance
- Top region (header + tabs + controls row) never moves while cards scroll.
- Card list scrolls independently within its region; page/body does not scroll.
- FAB stays fixed bottom-right and never overlaps the last card.
- Tabs filter correctly and the count matches the visible cards.
- No visual regression to any component's styling.
