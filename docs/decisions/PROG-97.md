### PROG-97 — Tomorrow is carved from the front of the rolling week, and never hides

**Date:** 2026-07-29 · **Status:** decided

The Agenda gains a **Tomorrow** bucket between Today and This week (the owner
wants to "see and add new things for tomorrow" without fishing them out of the
7-day pile). Two decisions inside:

1. **Tomorrow = today+1, carved out of the front of the rolling week.** The
   D38 rolling window is untouched at its far edge: This week becomes days
   2–6 and still ends at today+6, so nothing moves between Week and Later and
   the This-week quick-add still mints today+6. *Rejected:* making Tomorrow an
   overlay/highlight inside This week (you can see tomorrow, but a quick-add
   can't target it) and shifting the week window to start after tomorrow but
   end at today+7 (moves the Week/Later boundary, resorting every dated
   action for a cosmetic gain).

2. **The Tomorrow section always renders, even empty** — its quick-add is the
   whole point, and a hidden section can't be typed into. This narrowly
   supersedes PROG-89 (4) ("empty groups keep hiding", the owner's explicit
   pick) for this one bucket only: PROG-97's ask — "see **and add** new things
   for tomorrow" — is unmeetable under hide-when-empty, since the only other
   path to a tomorrow capture is minting it elsewhere and bumping the date.
   Every other bucket keeps hiding when empty. An empty Tomorrow shows the
   bare heading (no `· 0` count) plus the quick-add row — no empty bordered
   list box.

The quick-add for Tomorrow mints `today+1` (`quickAddDueDate`), which provably
lands back in its own bucket (unit-tested round trip, as with the other
buckets). Covered by `e2e/agenda-quickadd.spec.ts` (renders-when-empty +
creates-due-tomorrow) and `src/client/agendaQuickAdd.test.ts` (boundaries:
today+1 → tomorrow, today+2 and today+6 → week, today+7 → later).
