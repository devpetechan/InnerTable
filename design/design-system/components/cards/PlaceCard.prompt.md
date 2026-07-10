The repeating unit of The List. Leads with the friend signal — never the metadata — and degrades gracefully across three states: strong recommend (top take shown), want-to-try-only (no take yet, "I've been" CTA), and mixed/hard-pass (surfaces the pass honestly rather than hiding it).

```jsx
<PlaceCard
  name="Casa Enrique" metaLine="Restaurant · Mexican · $$ · LIC"
  status="recommends" people={[{initials:'SM'},{initials:'AR'},{initials:'PT'}]}
  signalText="Sam, Ana +3 recommend" rating={4.7}
  topTake={{ author:'Sam', initials:'SM', rating:5.0, note:'Best mole in the city.' }}
  comments={4}
/>
```

Composes AvatarStack, StatusChip, RatingStars and Button — don't reimplement those inline. When `rating` is omitted and the place is `try`-only, pass `googleRating` instead so the card falls back to the muted Google signal rather than showing nothing.
