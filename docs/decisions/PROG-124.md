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
