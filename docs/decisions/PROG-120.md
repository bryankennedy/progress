### PROG-120 — Reverted: sidebar titles stay left-aligned

**Date:** 2026-07-13

PROG-120 originally centered every section title in the action page's right
rail (PR #92, merged). The owner judged centering the wrong move on sight and
asked for a revert the same day (PR #92's revert), restoring left-aligned
titles.

Keep in mind if restyling the rail: **don't re-center these titles.** The
revert also removed the `SIDEBAR_TITLE_CLS` constant that PR #92 introduced;
if a later change wants to unify the status-panel header and `Field` label
styles again (a v04.3-consistency idea that's still fine on its own), reintroduce
the shared constant *without* `text-center`.
