### PROG-96 — "Updated" as a value on the search page

The ask ("search for issues by their recent updates") lands as a sixth
**Updated column** on the search page's action table — the table's columns are
already the searchable/sortable dimensions (PROG-78), so recency joins them
rather than growing a new filter widget. The decisions:

- **A sortable column, not a date-range filter.** The dominant question is
  "what moved recently?", which a click-sortable column answers in one gesture;
  a range picker would be a heavier control for a vaguer need. Browse mode
  already defaults to newest-first, so the column mostly makes that invisible
  ordering *visible* and reversible. A range filter can layer on later without
  undoing this.
- **Cell shows a relative day phrase, tooltip the exact timestamp.** The cell
  renders "today" / "yesterday" / "3 days ago" via the existing `relativeDue`
  phrasing (dates.ts) — at a glance, recency reads better as distance than as a
  date — with the full `toLocaleString` timestamp on `title` (same format as
  the action page's "Updated …" footer). Bridging helper `localDayOfInstant`
  converts the `updatedAt` instant to the viewer's local calendar day so the
  phrase flips at local midnight, consistent with every other day computation
  (D37).
- **Sort follows the existing header convention** (first click asc → desc →
  default), not a special "dates start descending" case: consistency across
  the six headers beats saving one click, and newest-first is already the
  browse default. `updated` compares the ISO strings (lexical =
  chronological), added to `ActionSortKey`/`sortActionHits` and unit-tested
  alongside the other keys.
