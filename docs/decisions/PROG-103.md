### PROG-103 — structural breadcrumbs replace the "Snapshot /" trail

The action page's breadcrumb now walks the structure tree — **Workspace /
Focus / Arc / KEY** — ancestors linked, the key as the plain terminal crumb.
"Snapshot" is gone: it named the load-everything payload (the pre-PROG-98
"workspace" payload), not a place, and its link to the board answered no
navigation question. Interpretation choices, flagged on the action:

- **The repo isn't in the trail.** The owner's stated path is
  Workspace / Focus / Arc / Action; the repo remains visible (and reachable)
  in the sidebar's Container field. The old trail showed focus/repo and no
  workspace or arc.
- **The key is the terminal crumb, and the standalone key line above the
  title is removed** — it would have repeated the same text one line apart.
  The key keeps its mono face inside the trail.
- **An unset arc just shortens the trail** (Workspace / Focus / KEY), as does
  any dangling ancestor.
- **Container pages get the same treatment** — they carried the identical
  "Snapshot /" link, and this arc is explicitly about cross-view consistency.
  Their trail is linked ancestors + the page's kind as the terminal crumb
  ("Personal Tooling / Progress / Arc"); the container's own name is the H1
  directly below, so repeating it in the trail would be noise.
- One shared `Breadcrumb` component (`src/client/Breadcrumb.tsx`) renders
  both, single-line with truncation so long names can't wrap the header on a
  phone.
