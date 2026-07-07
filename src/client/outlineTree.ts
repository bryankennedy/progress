// Pure tree math for the Outline view (PROG-124), factored out of the page the
// same way outlineReorder/containerReorder are — so the forest/sibling rules
// are unit-testable without a browser, and so the view has exactly one copy of
// the "sibling group" definition instead of four hand-rolled filter+sorts.

import type { WireAction } from "../shared/types";

export type OutlineNode = { action: WireAction; children: OutlineNode[]; depth: number };

// Sibling order everywhere in the outline: the shared fractional-index `rank`
// (PROG-43/PROG-86 — the same key the board sorts columns by), action number
// as the tiebreak so pre-rank rows keep a stable order.
export function byRankThenNumber(
  a: Pick<WireAction, "rank" | "number">,
  b: Pick<WireAction, "rank" | "number">,
): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.number - b.number;
}

// The sibling group of (focusId, parentActionId, arcId) in rendered order.
// `arcId` scopes only the top level: null means the focus's loose (no-arc)
// actions. Deeper levels follow parentActionId regardless of arc — a step
// inherits its parent's arc (PROG-124).
export function siblingsOf(
  actions: WireAction[],
  focusId: string,
  parentActionId: string | null,
  arcId: string | null,
): WireAction[] {
  return actions
    .filter(
      (i) =>
        i.focusId === focusId &&
        i.parentActionId === parentActionId &&
        (parentActionId === null ? i.arcId === arcId : true),
    )
    .sort(byRankThenNumber);
}

// Build the rendered forest for one (focus, arc) scope; `depth` is the depth
// tag for the top level (0 for loose actions, 1 inside an arc section, matching
// the view's indent math). One pass groups actions by parent, then the tree is
// assembled from the index — O(n log n) overall, where the previous
// filter-per-node shape re-scanned the full action list at every node and made
// this the page's hot loop at the 5k seeded scale.
//
// Passing a pre-filtered list (e.g. "hide done") keeps the old semantics for
// free: an excluded parent is never traversed, so its whole subtree drops out.
export function buildForest(
  actions: WireAction[],
  focusId: string,
  arcId: string | null,
  depth: number,
): OutlineNode[] {
  const roots: WireAction[] = [];
  const byParent = new Map<string, WireAction[]>();
  for (const a of actions) {
    if (a.focusId !== focusId) continue;
    if (a.parentActionId === null) {
      if (a.arcId === arcId) roots.push(a);
    } else {
      const sibs = byParent.get(a.parentActionId);
      if (sibs) sibs.push(a);
      else byParent.set(a.parentActionId, [a]);
    }
  }
  const assemble = (group: WireAction[], d: number): OutlineNode[] => {
    group.sort(byRankThenNumber);
    return group.map((action) => ({
      action,
      depth: d,
      children: assemble(byParent.get(action.id) ?? [], d + 1),
    }));
  };
  return assemble(roots, depth);
}
