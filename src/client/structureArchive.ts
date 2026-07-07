// PROG-45: completed (archived) arcs accumulate on the Structure page and bury
// the live structure it exists to curate. Show only the first few archived arcs
// per focus inline; the rest collapse behind a "more" link to /archive. Active
// nodes never count against the limit — only archived ones pile up.

export const ARCHIVED_INLINE_LIMIT = 5;

// Split an active-first, archived-last list (as produced by Structure's
// `byActive` sort) into the nodes to show inline and the count hidden behind the
// "more" link. All active nodes plus the first `limit` archived nodes are shown;
// any archived beyond that are counted in `hiddenCount`. Never mutates the input.
export function capArchived<T extends { archivedAt: string | null }>(
  nodes: readonly T[],
  limit: number = ARCHIVED_INLINE_LIMIT,
): { shown: T[]; hiddenCount: number } {
  const archivedCount = nodes.reduce((n, x) => n + (x.archivedAt ? 1 : 0), 0);
  if (archivedCount <= limit) return { shown: [...nodes], hiddenCount: 0 };
  const hiddenCount = archivedCount - limit;
  return { shown: nodes.slice(0, nodes.length - hiddenCount), hiddenCount };
}
