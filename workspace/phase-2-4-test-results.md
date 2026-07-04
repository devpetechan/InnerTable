# IT-035 Phases 2–4 — Test Results (2026-07-03)

Executed by Claude against the live DB, running your local (uncommitted-to-main) build
inside the deployed site's origin, signed in as dev.pete.chan@gmail.com.

## Passed

| Test | Result |
|---|---|
| 2.1 allPlaces shape | ✅ 13 places keyed by uuid |
| 2.2 place fields | ✅ name/cuisine/price/takes/comments/aggregate all present |
| 2.3 total takes = 13 | ✅ |
| 2.4 total comments = 7 | ✅ incl. quotedCommentId/quotedText/mentions fields |
| 2.5 no console errors | ✅ |
| 3.1 one card per place, no duplicates | ✅ 13 cards, 0 duplicate names |
| 3.2 stacked takes | ✅ two takes stacked on Eataly card after test write |
| 3.4 author filter | ✅ "Just mine"=0 (correct — dev account has no takes), Everyone=13 |
| 3.5 status tabs | ✅ Want to Try=1, Recommended=12, All=13 — matches data exactly |
| 3.7 edit/delete only on own takes | ✅ |
| 4.1/4.2 new place (manual, non-Google) | ✅ exactly 1 places row + 1 entries row |
| 4.3 add take on existing place | ✅ NO duplicate modal; silent attach |
| 4.4 rows | ✅ entries row only, no new places row, other user's row untouched |
| 4.5 edit own take | ✅ rating 5 + notes saved, places table untouched |
| 4.6 delete own take (shared place) | ✅ card survives with other user's take |
| dup-overlay / attach-step removed | ✅ absent from DOM |

## Findings (action needed)

1. **Realtime doesn't push updates.** The channel connects ("joined") but no
   postgres_changes events arrive — UI only updates after reload. Almost
   certainly the new tables aren't in the realtime publication (the restore
   and/or migrations never added them). Fix in SQL editor:
   `ALTER PUBLICATION supabase_realtime ADD TABLE public.places, public.entries, public.comments, public.comment_reactions;`
   (Check Database → Replication first; some may already be listed.)

2. **4.7 orphaned places:** deleting the last take leaves the place row in the
   DB and renders an empty card with zero takes. Product decision needed:
   hide zero-take places, delete the place, or show a "nobody's rated this
   yet" state. Good candidate to fold into IT-037.

3. **display_name falls back to email.** Google-auth accounts show as raw
   emails (dev.pete.chan@gmail.com, crazypete04@gmail.com) in takes and
   filters. Also: the author filter matches by display-name string — two
   users named "Peter" would collide. Recommend matching by user_id and
   adding a set-your-name step (fits IT-039/onboarding).

4. **Leftover test row:** one orphaned place "ZZZ IT-035 Test Bistro" remains
   (client-side delete was silently blocked by RLS — places has no DELETE
   policy). Remove via SQL editor:
   `DELETE FROM public.places WHERE name = 'ZZZ IT-035 Test Bistro';`
   All other test data was cleaned up (entries back to baseline 13/13).

## Not tested — needs you

- 3.6 Map view pin dedup (Maps rendering not exercised in the harness)
- 4.1 via Google Places autocomplete (needs the real autocomplete dropdown)
- Multi-user flow with your two accounts side by side (incognito test)
- 4.8 reload persistence in your normal browser
- Comments UI — correctly absent; that's Phase 5
