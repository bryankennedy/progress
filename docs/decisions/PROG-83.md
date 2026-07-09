### PROG-83 — deterministic order for every container/tag list

The action asked for alphabetical ordering "until we establish some sort of
ranking mechanism". By the time it was picked up, that mechanism existed:
containers carry a fractional-index `rank` (PROG-87/D43) that reads
alphabetically until first reordered. So "alphabetize everything" resolves
into two rules, not one:

- **Browsing lists show the global manual order.** Container-page child lists
  (focuses on a workspace page, repos/arcs on a focus page) now use the same
  order as Structure and the Outline: active first, archived last (dimmed),
  rank-then-name within each half. Pure alpha here would have fought the drag
  order the owner sets on the Outline. The comparator is the promoted
  `sortContainers` (`src/client/containerReorder.ts`) — previously a local
  helper inside Structure — so the three surfaces can't drift.
- **Pickers list alphabetically.** Selects and palette pickers are scanned by
  name, and PROG-66 already settled that filter dropdowns sort alpha; the
  same now holds for the create-action dialog (focus optgroups, repos, arcs),
  the create-container parent selects, the palette arc/move/tag pickers, and
  the palette container quick-jump results (per kind, kinds in hierarchy
  order). All via the existing `sortByName` (`src/client/boardFilters.ts`).

Also settled here:

- **Tag chips sort alphabetically everywhere** — action page, board cards,
  Agenda rows. Tags have no rank and link insertion order is meaningless.
  Home and Agenda had byte-identical `tagsByAction` builders; they're now one
  shared, tested helper (`src/client/tags.ts`) so chip order can't regress
  per-view (the arc's "component-ize" ask).
- **Archive groups sort by name** (workspace and focus group headers followed
  Map-insertion order — whichever arc happened to be scanned first).
- **Board actions stay pure `rank` order**, per the owner's comment on the
  action ("Do not alpha sort issues on the board view"). The Outline was
  already rank-ordered — the comment's "especially important on the Outline"
  concern is satisfied by rank's alpha-until-reordered degradation.
