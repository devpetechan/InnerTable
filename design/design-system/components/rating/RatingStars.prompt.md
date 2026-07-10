Star rating in brand clay. The friend-group rating is always the headline signal; when nobody in the group has been yet, render `muted` to fall back to a quiet "Google 4.5"-style secondary signal rather than showing nothing.

```jsx
<RatingStars value={4.2} />
<RatingStars value={4.5} muted />
```
