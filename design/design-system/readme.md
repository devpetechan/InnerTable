# InnerTable Design System

InnerTable is a private, mobile-first web app for a small friend group to share restaurant and bar recommendations — trusted-network product (think professional trust, not social-feed performance). This project is the **alpha's design system**: the visual language and reusable pieces established across a run of screen design turns, now organized for reuse.

**Sources.** Everything here was authored directly in this project across a sequence of design turns — no external Figma file, codebase, or brand deck was attached. The original exploration files are kept at the project root for reference and provenance:
- `Design System Directions.dc.html` — the 3 palette/component directions (1a/1b/1c); **1a "Quiet Utility"** was chosen.
- `The List.dc.html` — browse-screen layout options; **2a layout + Map toggle** was chosen.
- `Place Card.dc.html` — the repeating card, 3 signal-state studies; **4b "Richer / top take"** was chosen.
- `Add Flow.dc.html` — the add-a-place / share-a-take flow; **6b "Guided multi-step"** was chosen.

## Index
- `styles.css` — global entry point (imports everything under `tokens/`).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `shadows.css`.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Signal groups).
- `components/` — reusable primitives: `avatars/` (Avatar, AvatarStack), `chips/` (StatusChip), `rating/` (RatingStars), `tags/` (CategoryTag), `buttons/` (Button), `cards/` (PlaceCard, composed from the above).
- `ui_kits/InnerTable/` — click-through recreation of The List → Add flow.

## Fonts
All UI text is **Hanken Grotesk** (weights 400/500/600/700/800), loaded via Google Fonts CDN link rather than self-hosted — it's a freely licensed Google font, not brand-proprietary, so no binaries were copied:
```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
Micro-labels (section eyebrows, timestamps) use `ui-monospace, Menlo, monospace` — uppercase, `.14em` letter-spacing — never body text.

## Content fundamentals
- **Vocabulary is fixed and load-bearing:** every take is exactly one of **Want to Try**, **Recommends**, or **Hard Pass** — copy never paraphrases these (no "loved it", "so-so", etc). A place with a split signal is labeled **Mixed**, not hidden.
- **Friend-first phrasing.** The signal line always names people before numbers: "Sam, Ana +3 recommend", not "5 recommendations". First names only.
- **Sentence case everywhere**, no title case in copy, no exclamation points.
- **Direct, short prompts** in flows: "What's the place?", "Have you been?" — second person, one question at a time.
- **No emoji, ever.** No social-feed language (no "likes", "posts", "followers").
- **Optional fields are always labeled "(optional)"** inline next to the field label — never left ambiguous.

## Visual foundations
- **Warm, quiet, single accent.** One clay accent (`#C1552E`) is reserved for primary actions, focus rings, the FAB, and star fills — everything else (surfaces, borders, secondary text) is neutral warm-gray. No gradients anywhere.
- **Two backgrounds only:** a warm off-white paper (`--color-paper` / `--color-paper-raised`) for cards and sheets, and a slightly deeper warm neutral canvas (`--color-canvas`) as the app ground beneath them. Never more than these two per screen.
- **Cards:** radius 12–18px, 1px hairline border, soft two-layer shadow (`--shadow-card`) — never a colored left-border accent.
- **Dividers** are 1px `--color-divider` hairlines, not visible section backgrounds.
- **Avatars** are the recurring proof-of-trust motif: circles filled with colored initials (5-color palette, cycled), overlapping with a 2px paper-colored ring when stacked, with a "+N" tail circle for overflow.
- **Status chips** are tinted-fill pills with a small leading dot (not colored borders or colored text-only) — this is the only place saturated color appears outside the accent and avatars.
- **Segmented controls** (status tabs, List/Map toggle) sit on a tinted track (`--color-canvas`) with the active segment raised in white with a soft shadow — never an underline-only or color-fill active state.
- **Inputs** have a 1px neutral border; focus state is a 1.5px clay border plus a soft clay glow ring (`0 0 0 3px var(--color-accent-ring)`) — the only glow effect in the system.
- **The FAB** is a pill (not a circle) with a label, floating bottom-center on List screens, in clay with a soft warm shadow.
- **No animation direction has been explored yet** — nothing here should be assumed about transitions/easing; ask before inventing motion.
- **Corner radii scale:** 7 (chips/tags) · 11 (inputs) · 14 (compact cards) · 16 (roomy cards/sheets) · pill (segmented controls, FAB).

## Iconography
InnerTable currently has **no icon library or icon font** — every glyph in the explored screens is hand-built from CSS primitives (a rotated square = map pin, stacked bars = filter, plain typographic characters like `‹ › + ✓ ★ ✕`). This keeps the visual weight consistent with the type-led, minimal aesthetic, but it means every new icon has to be hand-drawn the same way, which won't scale well.
- **No emoji, no photographic imagery yet** (no place photos have been designed into any screen).
- **Suggested addition (not yet adopted):** if/when a real icon set is needed, a 1.6–1.8px stroke-weight line-icon set (e.g. Lucide/Feather) would match the current hand-drawn glyph weight most closely. Flagging rather than adopting, since no source confirmed this direction.

## Open items / not yet designed
- **Place Detail** (full take stack + comment thread) — referenced throughout but no screen has been designed yet.
- **Map view** — flagged as a first-class discovery surface ("what's good near me now"), not a deferred toggle, but the actual map UI hasn't been designed. The List's Map toggle currently shows a placeholder note rather than an invented design.
- **Filter & sort sheet** — the panel behind the "Filter & sort" control hasn't been designed.
