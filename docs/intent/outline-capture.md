# Intent — Outline capture view (Workflowy-style)

Confirmed via `/interview-me` on 2026-06-26. This is the pre-spec statement of
intent; the as-built behaviour belongs in `REFERENCE.md` once shipped, and the
model decisions are logged in `DECISIONS.md` (PROG-124).

- **Outcome:** A Workflowy-style outliner view for *fast keyboard capture* of
  issues as nested bullets — type → Enter → Tab → Enter — showing just titles
  with a per-level icon and a `…` to open the full issue.
- **User:** The owner — for rapidly dumping and shaping a chunk of work without
  the heavier board / new-issue dialog.
- **Why now:** Capture is high-friction today, and sub-issues (issue → issue
  nesting) don't exist yet but are now needed.
- **Success:** Rattle out a structured Arc / Issue / Sub-issue list in seconds,
  and reparent existing issues by indent/outdent without losing their identity.
- **Constraint:** Rigid simplicity + instant/optimistic UI (no spinners), and
  **one** Issue data type (no "simple vs complex issue" split).
- **Out of scope:** Deleting or archiving issues from this view; editing
  anything but the title inline (the `…` is just a link to the full issue);
  changing the board/agenda; touching Repo, status, priority, or due-date
  semantics.

## The model (confirmed)

- **One Issue type.** A sub-issue is just an issue with a new self-referencing
  `parentIssueId` (unbounded depth). No second entity, no checklist-item table.
- **Depth ladder, root sets the ceiling.** A root picker selects an Initiative
  **or** a Product (switchable, one scope at a time):
  - Product root → `[Arc] → Issue → Sub-issue → …`
  - Initiative root → `Product → [Arc] → Issue → Sub-issue → …`
- **Default new bullet = Issue.** Arc and Product are never *typed* as bullets;
  they're reached by an explicit **promote / assign** command (pick existing or
  create new). You can't outdent above the ceiling.
- **Reparent in place.** Indent/outdent rewrites `parentIssueId` (or `arcId`)
  and preserves the issue's key, status, priority, and comments — mirroring how
  `moveIssue` preserves identity within a product. No delete/archive here.
- **Board toggle.** A persisted "show sub-issues" switch on the board: off hides
  child issues; on renders them nested under their parent card with a distinct
  style.
