### PROG-124 — Outline capture view + sub-issues (one issue type, depth ladder)

A Workflowy-style outliner (`/outline`) for fast keyboard capture, confirmed via
`/interview-me` (see `docs/intent/outline-capture.md`). The model decisions:

- **Sub-issues are issues, not a new entity.** Issues gain a nullable
  self-referencing `parentIssueId` (migration `0008_issue_parent`); a sub-issue
  is simply an issue with a parent issue, nestable to unbounded depth. We
  explicitly rejected a "simple vs complex issue" split or a lightweight
  checklist-item table — the owner wants one data type with simplified *views*,
  not two models. Sub-issues keep their own key, status, priority, comments.
- **Same-product + acyclic invariants, API-enforced** (SQLite can't express
  them, like the existing repo/arc rules, D17): a parent must be in the same
  product as the child, and the parent chain must not cycle. Checked in
  `POST /api/issues` and `PATCH /api/issues/:id`.
- **Depth ladder; the root sets the ceiling.** The outline view scopes to a
  chosen Initiative *or* Product. Product root → `[Arc] → Issue → Sub-issue`;
  Initiative root → `Product → [Arc] → Issue → Sub-issue`. A fresh bullet is
  always an **Issue**; Arc and Product are never typed — they're reached by an
  explicit promote/assign command (pick existing or create new). Outdenting
  above the ceiling is disallowed. This keeps everyday capture (product scope)
  fast while letting structure be built when needed.
- **Reparent in place, no delete/archive here.** Indent/outdent rewrites
  `parentIssueId` (Tab/Shift-Tab between issue depths) and the explicit command
  rewrites `arcId`; both preserve issue identity, mirroring `moveIssue`. The
  outline view never deletes or archives an issue — that stays on the issue page
  (Backspace on an empty *unsaved* row just discards it).
- **Board "show sub-issues" toggle** (persisted, default off). Off: child issues
  are filtered out of the columns so the board stays one-card-per-deliverable.
  On: sub-issues render nested under their parent card with a distinct indented
  style. Reuses the existing `rank` for ordering; `parentIssueId` is orthogonal
  to `rank`.

### PROG-124b — Outline rows carry the shared status + priority glyphs, right-aligned

(The key was reused by the tracker: the entry above is the original outline
capture view; this one is the v04.3 "Experience consistency" action of the same
number.)

Outline action rows now end in the same `StatusIndicator` + `PriorityIndicator`
every other view uses — no outline-specific glyphs. Layout decisions:

- **Status holds the outermost column.** Every action has a status, so pinning
  it at the far right keeps the edge flush and scannable down a long list;
  priority sits just inside it.
- **Priority `none` renders nothing** — the board card's convention (PROG-61),
  not Agenda's always-render — because most fresh captures are priority-none
  and a faint zero-bar glyph on every row would be pure noise in a capture
  view. No placeholder slot is needed: with status always rendered outermost,
  columns align whether or not priority shows.
- **Read-only glyphs.** Editing status/priority stays on the action page,
  board, and palette; the outline's row affordances remain the bullet handle
  and the title input.
