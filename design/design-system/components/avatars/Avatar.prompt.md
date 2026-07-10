A circle filled with a friend's initials in one of the five brand avatar colors. The base unit for the friend-trust signal throughout InnerTable.

```jsx
<Avatar initials="JD" size={34} />
<Avatar initials="AR" size={26} ring={2} />
```

Color auto-picks from the 5-color avatar palette by initial unless `color` is passed explicitly. Set `ring` + `ringColor="var(--color-paper-raised)"` whenever avatars overlap in a stack (see AvatarStack).
