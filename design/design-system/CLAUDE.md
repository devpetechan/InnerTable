# InnerTable — Locked Design System (Direction 1a "Quiet Utility")

Mobile-first, single column. Warm, appetizing, trusted-network (calm, not a social feed). Clean & minimal.

## Fonts
- All UI: **Hanken Grotesk** (400/500/600/700/800). Google Fonts.
- Micro-labels/meta only: `ui-monospace, Menlo, monospace`, uppercase, letter-spacing .14em.

## Color
- Paper (card bg): `#FCFBF9` / pure `#FFFFFF` for raised cards
- App canvas / neutral ground: `#F1EDE6` fill, page bg can be `#FCFBFA`
- Ink (text): `#292420`
- Muted text: `#8A817A`  · secondary body `#5F574F`
- Accent (Clay): `#C1552E`
- Hairline / border: `#E7E1D9` (cards), `#E0DAD2` (tag outline), `#EFEAE2` (dividers)

## Status chips (tinted fill, radius 7, 5/11 pad, 12.5px/600, 6px leading dot)
- Want to Try — bg `#EDF1F5`, text `#3D5A78`, dot `#4B6B8A`
- Recommends  — bg `#EAF1EA`, text `#3F6A44`, dot `#5C7A4F`
- Hard Pass   — bg `#F5EBE8`, text `#9E4234`, dot `#B14A3C`

## Avatars (colored initials)
Circle, white 700 text. Palette: `#C1552E #4B6B8A #5C7A4F #9A6B3F #7A5C8A`. List size 34px, stacked-on-card 26px w/ 2px paper border + -8px overlap.

## Rating
Stars `★` in clay `#C1552E`, empty `#D8D2CA`, bold number in ink. Compact form `★ 4.2` uses clay.

## Category tags (metadata)
Outline pill: 12px, text `#6B635C`, border `#E0DAD2`, radius 7, pad 4/10. Used for Restaurant/Bar/cuisine/price/neighborhood.

## Shape & spacing
Cards radius 12–18, subtle shadow `0 1px 2px rgba(40,30,20,.04), 0 10px 30px rgba(40,30,20,.05)`. Section dividers = 1px `#EFEAE2` with 20–22px padding. No gradients, no emoji, no left-border-accent cliché.

## Rejected: 1b (warm modern), 1c (editorial). Reference file: Design System Directions.dc.html

## The List — chosen layout: 2a base + Map toggle (file: The List.dc.html)
Header = wordmark + you-avatar → full-width segmented status control [All | Want to Try | Recommended] (active = white raised on #F1EDE6 track) → controls row: [List | Map] segmented toggle (left) + "Filter & sort" outline pill (right). Roomy white cards (radius 14): name + status chip top row, muted dot-string meta (Restaurant · cuisine · price · neighborhood), avatar stack + signal + `★ rating`, optional top-take note under a hairline. Persistent clay pill FAB "Add a place" centered bottom. Filter & sort opens a sheet (not yet designed).
- Product is also a **discovery tool**: Map is NOT deferred — it's a first-class view for "what's good near me now." Design the Map view properly when we get to it.
- 2c's search field was NOT carried over; 2a wins on overall style.

## Place card — chosen: 4b "Richer / top take" (file: Place Card.dc.html; folded into The List)
Card = white `#FFFFFF`, 1px `#E7E1D9`, radius 16, pad 16. Rows, top→bottom:
1. Name 17/700 + meta dot-string; status chip top-right (Recommended / Want to Try / Hard Pass, or neutral outline "Mixed").
2. Signal row (the 1-second read): recommender avatar stack + summary text on left ("Sam, Ana +3 recommend" / "N friends want to try" / "N passed"), friend-group `★ rating` (clay) on right. When nobody's been, degrade the rating to muted "Google ★ x.x".
3. Hairline, then ONE top take: 28px author avatar + name + their `★ rating` (or Hard Pass mini-chip) + one-line note. Want-to-try (no takes) shows "Nobody's been yet — be the first to try it."
4. Footer: "+ Add your take" (outline clay) — or filled "I've been — add a take" when nobody's been — + comments affordance (bubble icon + count + ›).
Everything below the signal expands to Place Detail. Rejected: 4a compact, 4c verdict-meter.

## Add flow — chosen: 6b "Guided multi-step" (file: Add Flow.dc.html)
Triggered from the FAB (new place) or "Add your take" (place pre-filled → skip step 1). Header = Cancel/back-‹ + progress dots + spacer; sticky bottom primary button. Field style: label 12.5/600 `#5F574F`; input border `#E7E1D9` radius 11 pad ~13/14, focus = 1.5px clay + `0 0 0 3px rgba(193,85,46,.12)` ring; placeholder `#A79E93`; optional fields tagged "(optional)". Steps:
1. **Place** — big prompt "What's the place?" + autocomplete input (clay focus ring) with a dropdown of name + address suggestions. Next.
2. **Intent** — confirmed place mini-card (Edit) + "Have you been?" + two big intent cards: "Want to try" (blue pin icon) and "I've been" (clay ★ icon). Selecting Want-to-try expands an inline optional note and the primary becomes "Save to Want to Try" → DONE in 2 steps. Selecting I've been → step 3.
3. **Review** (I've-been only) — 5 big clay stars, Recommend/Hard-pass verdict (green/red segmented), optional note, and a dashed "Add cuisine, price & detailed ratings (optional)" disclosure → expands to cuisine input, price $/$$/$$$/$$$$ segmented, and 4 sub-ratings (Food quality/Service/Value/Ambiance) as label + 5 small stars. Primary "Share take".
Rejected: 6a adaptive sheet, 6c intent-first split.
