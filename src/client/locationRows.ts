// The location tree (PROG-123b): the Workspace → Focus → Arc rows a location
// picker lists, in outline rank order (sortContainers / byRankThenName —
// supersedes PROG-83's alphabetical rule here), with tree-aware filtering — a
// query matches a row or any ancestor, an ancestor match keeps its whole
// subtree, and ancestors of a match stay visible as context. Archived
// containers aren't destinations (D26). Shared by the palette's L picker and
// the create-action dialog's Location field (PROG-117), so both surfaces list
// one tree; the caller renders rows and decides what picking one does.

import { byRankThenName, sortContainers } from "./containerReorder";

type Container = { id: string; name: string; rank: string; archivedAt: string | null };

export type LocationSource = {
  workspaces: Container[];
  focuses: (Container & { workspaceId: string })[];
  arcs: (Container & { focusId: string })[];
};

export type LocationRow =
  | { kind: "workspace"; id: string; name: string }
  | { kind: "focus"; id: string; name: string }
  | { kind: "arc"; id: string; name: string; focusId: string };

export function locationRows(source: LocationSource, query: string): LocationRow[] {
  const q = query.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(q);

  const rows: LocationRow[] = [];
  for (const workspace of sortContainers(source.workspaces)) {
    const wsMatch = matches(workspace.name);
    const group: LocationRow[] = [];
    for (const focus of source.focuses
      .filter((p) => p.workspaceId === workspace.id && !p.archivedAt)
      .sort(byRankThenName)) {
      const focusMatch = wsMatch || matches(focus.name);
      const visibleArcs = source.arcs
        .filter((a) => a.focusId === focus.id && !a.archivedAt)
        .sort(byRankThenName)
        .filter((a) => focusMatch || matches(a.name));
      if (!focusMatch && visibleArcs.length === 0) continue;
      group.push({ kind: "focus", id: focus.id, name: focus.name });
      group.push(
        ...visibleArcs.map((a): LocationRow => ({
          kind: "arc",
          id: a.id,
          name: a.name,
          focusId: focus.id,
        })),
      );
    }
    // A workspace with nothing visible under it drops entirely — a header
    // with no picks beneath is noise.
    if (group.length > 0)
      rows.push({ kind: "workspace", id: workspace.id, name: workspace.name }, ...group);
  }
  return rows;
}
