# PROG-140 — Outline & Structure merge

### PROG-140 — The Outline absorbs the Structure view: an "all workspaces" scope, inline structure creation, and container pages as outline subsets

**Context.** v2 shipped two overlapping tree surfaces: `/outline` (the
Workflowy-style capture view, scoped to ONE workspace or focus at a time,
PROG-124/126) and `/structure` (a static Workspace → Focus → Arc directory with
"+ add" buttons, D40). The v5.1 arc merges them: the outline becomes the one
tree surface, structure retires (PROG-143).

**Decision.**

1. **New top scope: `{ kind: "all" }`.** `OutlineViewScope` gains an `all`
   variant that renders every active workspace as a sortable section (drag to
   reorder via the existing shared `rank`), each containing its focus sections
   exactly as workspace scope renders them today. The `/outline` scope picker
   gains an "All workspaces" option at the top; the URL form is
   `/outline?all=1` (params still win over the sticky scope); the sticky scope
   (`outlinePrefs`) learns the `all` kind, and **`all` is the default** when
   nothing is saved — the top of the zoom stack is the whole tree.
2. **Structure parity inside the outline.** The outline keeps the capture
   idiom rather than Structure's dialog buttons: per-workspace inline focus
   capture (the existing `FocusCaptureRow`), a new inline "+ new arc" capture
   at the end of each focus section, and a new-workspace capture at the foot of
   the all scope. A focus's `keyPrefix` and git link stay visible in its
   section header (as Structure showed them).
3. **Zooming = the existing container pages.** Clicking a workspace / focus /
   arc bullet keeps navigating to `/workspace/:id` etc., whose pages already
   embed the SAME `OutlineView` (via `ActionListView`, PROG-126) plus header
   chrome (description, archive, key prefix, board/copy-as-prompt links).
   Breadcrumbs gain a root "Outline" crumb pointing at `/outline?all=1`, so
   every level can climb back to the top of the stack.
4. **Focus → workspace drag.** At all scope a focus section dragged into
   another workspace re-parents it: the server's `PATCH /api/focuses/:id`
   accepts `workspaceId` (validated to exist). Safe because action keys derive
   from the focus prefix, not the workspace (D18). **Arc → other-focus drag is
   deliberately NOT supported**: an arc's actions belong to its focus, so the
   move would re-key every action in the arc (the PROG-102/124 move semantics,
   multiplied); dragging arcs reorders within their focus only, unchanged.
5. **Retirement (PROG-143).** `/structure` and the legacy `/repo/:id` redirect
   to `/outline?all=1`; the nav item is dropped (mobile "More" sheet keeps
   Archive/Diary); `Structure.tsx` is deleted. Archived containers stay
   out of the outline (as today) — the Archive page remains their home, so
   `structureArchive.ts`'s inline-cap goes away with the page if nothing else
   uses it.

**Why.** One tree surface instead of two lookalikes; the outline was already
the richer one (capture, drag-move, live actions) and container pages already
embed it — Structure's only unique powers were "see everything" and "add
containers anywhere", which the all scope + inline captures absorb.
