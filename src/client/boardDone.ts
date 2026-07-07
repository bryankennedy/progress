// PROG-40: the Done column grows without bound and dominates the board. Show
// only the most recently completed actions there; older ones stay reachable via
// search, the Agenda, and container pages. "Recent" is by `completedAt` — the
// instant the action was marked done — newest kept.

export const DONE_VISIBLE_LIMIT = 10;

// The `limit` most-recently-completed actions, returned in the SAME order they
// came in (the board's rank order) so the display and drag-reorder stay
// consistent with every other column. Selection is purely by `completedAt`:
// newest kept; a null completedAt (shouldn't happen for done, but be safe) sorts
// oldest and is dropped first. Returns a copy; never mutates the input.
export function recentlyCompleted<T extends { completedAt: string | null }>(
  done: readonly T[],
  limit: number = DONE_VISIBLE_LIMIT,
): T[] {
  if (done.length <= limit) return [...done];
  const keep = new Set(
    [...done]
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
      .slice(0, limit),
  );
  return done.filter((action) => keep.has(action));
}
