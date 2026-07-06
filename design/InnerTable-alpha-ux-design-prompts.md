# InnerTable — Alpha UX Design Prompts

Prompts to paste into Claude Design. Each is self-contained. Do them in order — Prompt 0 sets shared context you can reference in the others.

**Product in one line:** InnerTable is a private restaurant/bar list for a friend group. You save places you want to try and share takes on places you've been. The whole promise is "recommendations from people who know you," not strangers or algorithms.

**Design principles (from the vision doc — hold Claude Design to these):**
- **LinkedIn, not Instagram.** Trusted network, not performative/public. No leaderboards, no influencer vibe. Feels like a shared group doc, not a social feed.
- **Pandora, not Spotify.** When we show *why* a place is recommended, it's interpretable (which friends, what they said) — never an opaque score. For alpha, keep this light: just make the friend signal legible.
- Warm, appetizing, food-first. Visual presentation IS the product for a food app.

---

## Prompt 0 — Establish the design system

> I'm designing the alpha of "InnerTable," a private mobile-first web app where a small friend group shares restaurant and bar recommendations. It's a trusted-network product (think LinkedIn's trust, not Instagram's performance) — it should feel like a warm, well-designed shared group list, not a social feed.
>
> Before we design screens, propose a lightweight design system I can reuse across the app: a color palette (warm and appetizing, works for a food app, good contrast), type scale, spacing, and the visual treatment for the core repeating elements — friend avatars (colored initials), status chips ("Want to Try," "Recommends," "Hard Pass"), rating stars, and category tags (Restaurant / Bar / cuisine / price). Give me 2–3 distinct directions ranging from clean-and-minimal to warm-and-editorial. Mobile-first, single column. Show the components on a neutral background so I can compare.

---

## Prompt 1 — The browse screen (highest priority)

> Design the main browse screen for InnerTable, a mobile-first web app. This is what a user sees right after sign-in and it's the heart of the product: a scrollable list of restaurants and bars their friend group has saved or reviewed.
>
> **Problem with the current version:** it has two competing navigation systems and a wall of controls before any content — a hero with four big buttons, PLUS view tabs (All / Want to Try / Recommended), PLUS a List/Map toggle, PLUS three separate filter rows (filter by person, filter by type, sort order). It's overwhelming and clunky.
>
> **Goal:** one clean, scannable screen. Consolidate navigation into a single intuitive system. The user should understand where they are and see actual content within a few seconds. Filtering and sorting should be available but tucked away, not shouting.
>
> Each list item represents a place and needs to show, at a glance: name, type (restaurant/bar), a friend-trust signal (e.g. "✅ Recommended by Sarah & 2 others" or "📌 3 friends want to try"), and a rating. Assume 8–15 places in the list.
>
> Give me 2–3 layout directions for how to organize the top-of-screen navigation/filtering and the list itself. Include one empty-state design for a brand-new user with nothing saved yet. Mobile-first. Use the design system from before.

---

## Prompt 2 — The place card (the "trust it" moment)

> Design the place card for InnerTable — the repeating unit in a list of restaurant/bar recommendations from a friend group. This is where a user decides whether to trust a place, so the friend signal has to be instantly legible.
>
> **What a card needs to convey, in priority order:**
> 1. Place name + type (restaurant/bar) + quick tags (cuisine, price, neighborhood).
> 2. The friend signal — the most important part. Who among the user's friends recommends it, wants to try it, or gave it a hard pass, plus the group's average rating. Optionally a secondary/muted Google rating as a fallback signal.
> 3. Individual "takes" — short reviews from specific friends (avatar, name, their rating, a one-line note like "get the branzino").
> 4. A way to add your own take, and a comments affordance.
>
> **Problem with the current version:** everything is crammed into one tall, noisy card — the friend signal is a run-on line of dot-separated fragments, and full comment threads with reactions live inline, making cards enormous and hard to scan.
>
> **Goal:** a card that's scannable at a glance but expandable for detail. The friend-trust signal should read in one second. Individual takes and comments should be available without dominating the card — consider progressive disclosure (collapsed by default, tap to expand).
>
> Give me 2–3 directions: at least one compact/scannable and one richer/expanded, and show how a card looks in three states — a place several friends recommend, a place nobody's been to yet (only "want to try"), and a place with a mixed/hard-pass signal. Mobile-first.

---

## Prompt 3 — Add / share a take (the "contribute" moment)

> Design the "add a place / share your take" flow for InnerTable, a mobile-first web app for sharing restaurant recommendations with friends. Low friction here is critical — if contributing feels like a chore, the shared list stays empty and the product dies.
>
> **The flow has two modes the user picks between:**
> - **"Want to try"** — saving a place for later. Should be nearly instant: place name (with autocomplete), an optional note, an optional link. Two taps and done.
> - **"I've been"** — sharing a review. Needs: overall star rating, a recommend / hard-pass call, and optionally cuisine, price, a short note, and four detailed sub-ratings (quality, service, value, ambiance).
>
> **Problem with the current version:** it's one long single-scroll form that shows all fields at once, including the optional detailed ratings, so even a quick "want to try" save feels heavy.
>
> **Goal:** progressive disclosure. Make the fast path fast and let the detailed review reveal itself only when the user chooses "I've been" and wants to add depth. The optional detailed ratings should be clearly optional and collapsed by default.
>
> Give me 2–3 directions for structuring this — e.g. a single smart form that adapts, versus a short multi-step flow. Show the "want to try" path and the "I've been" path. Mobile-first, and it should feel quick and rewarding, not like a data-entry form.

---

## Prompt 4 — Place Detail (the depth view) — DO THIS

> Design the Place Detail view for InnerTable, a mobile-first web app for sharing restaurant/bar recommendations with a friend group. This opens when a user taps a place card in the list. Keep the design system and information architecture we've been using.
>
> **Its job:** the list card is a scannable summary; this view is where the depth lives. Everything that would make a card too tall belongs here instead.
>
> **What it needs to show, top to bottom:**
> 1. Place header — name, type (restaurant/bar), tags (cuisine, price, neighborhood), and a link out to maps.
> 2. The friend signal, expanded — the group's average rating, who recommends it, who wants to try it, who gave it a hard pass. Optionally a muted Google rating as a fallback signal.
> 3. The take stack — each friend's individual take: avatar (colored initials), name, date, a status chip (Recommends / Hard Pass / Want to Try), their star rating, an optional one-line note, and optionally four small sub-ratings (quality, service, value, ambiance). There can be several takes; they should be readable and scannable, not a wall.
> 4. A clear "Add your take" action if the current user hasn't weighed in yet.
> 5. A comment thread at the bottom — short messages from friends with avatars and dates, and a box to add one. Keep this simple for alpha; reactions and replies can be minimal or deferred.
>
> **Goal:** a focused, readable detail view. The friend signal reads first, individual takes are easy to scan, comments are present but don't dominate. Should feel like reading a well-organized shared note about one place.
>
> Give me 2–3 directions. Show the view in two states: a popular place with several takes and a few comments, and a sparse place with only one "want to try" take and no comments yet. Mobile-first. Should this be a full screen or a bottom sheet that slides up? Show me your recommendation and why.

---

## Prompt 5 — Filter & sort sheet — DO THIS

> Design the "Filter & sort" sheet for InnerTable, a mobile-first web app for sharing restaurant/bar recommendations. In our information architecture, the main list has ONE primary lens shown as top-level segments (All / Want to Try / Recommended). This sheet holds the *secondary* controls, tucked behind a single button so they don't clutter the list.
>
> **The sheet contains exactly three controls:**
> - **Type** — All / Restaurants / Bars
> - **Author** — Everyone / Just mine
> - **Sort** — Most recent / Highest rated
>
> **Problem with the old version:** these three were three separate always-visible filter bars stacked above the list, creating a wall of controls before any content. We're consolidating them into one sheet opened from a single "Filter & sort" button.
>
> **Goal:** fast and obvious. A user opens it, taps a couple of options, and gets back to the list. It should be clear at a glance which options are active, and there should be an easy way to reset to defaults. When filters are active, the button that opens this sheet should signal that (e.g. a count or a dot).
>
> Give me 2–3 directions for the sheet (bottom sheet vs. inline dropdown vs. full overlay). Show it in a default state and an active state (e.g. Bars + Just mine + Highest rated selected), and show what the trigger button looks like in both the "no filters" and "filters active" states. Mobile-first.

---

## Prompt 6 — Map view (OPTIONAL — lower priority)

> Design an optional Map view for InnerTable, a mobile-first web app for sharing restaurant/bar recommendations with a friend group. In our information architecture the map is NOT a separate destination — it's a toggle on the main list (List ↔ Map), showing the same places as pins on a map instead of as a list.
>
> **What it needs:**
> - A map filling most of the screen with a pin per place. Pins should hint at the friend signal — e.g. a recommended place looks different from a "want to try" place.
> - The same List/Map toggle and "Filter & sort" control available here as on the list, so filters carry across both views.
> - Tapping a pin surfaces a compact preview (name, type, friend signal) with a way to open the full Place Detail — the SAME detail view used from the list, not a separate one.
>
> **Goal:** keep it lightweight. This is a secondary way to browse, useful for "what's near me / near where we're meeting." Don't over-build it.
>
> Give me 1–2 directions. Show the map with a handful of pins, and the pin-tap preview state. Mobile-first. Note: this is lower priority than the list and detail views, so keep it simple.

---

## How to use these

1. Run Prompt 0 first, pick a direction, and tell Claude Design "use this system going forward."
2. Do Prompts 1–3 in order — browse screen is the biggest win.
3. Then Prompts 4 and 5 (Place Detail, Filter & sort) — both are part of the alpha IA.
4. Prompt 6 (Map) is optional — skip it if you're time-boxing the alpha.
5. For each, ask follow-ups: "tighten option 2," "show the loading state," "how does this scale to 50 places."
6. Ignore comments-depth (reactions, threads, mentions) and trust-math UI for now — those aren't alpha-blocking.
