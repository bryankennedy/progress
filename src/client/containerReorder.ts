// Container ordering on the Outline (PROG-87): arcs within a product and
// products within an initiative sort by a fractional-index `rank` — the same
// key space the issue board uses (PROG-43) — with the NAME as tiebreak. Every
// container starts at the shared DEFAULT_RANK, so a group nobody has reordered
// ties everywhere and reads alphabetically; ranks only diverge once someone
// drags.
//
// That tie is also why this can't always be outlineReorder's one-write
// rankForReorder: rankBetween needs strictly ordered neighbours, and in a tied
// group the neighbours are equal. So the first drag in a tied group renumbers
// the WHOLE group in its new visual order — N small writes, once — after which
// ranks are pairwise distinct and every later drag is the one-write fast path.

import { arrayMove } from "@dnd-kit/sortable";
import { rankAfter } from "../shared/rank";
import { rankForReorder } from "./outlineReorder";

/** What ordering needs to know about a container. */
export type Ranked = { id: string; rank: string; name: string };

/**
 * Sort comparator for reorderable containers: manual rank first, name as the
 * tiebreak. Rank comparison is plain code-unit order — the rank alphabet is
 * ASCII-ordered by design — while names compare with localeCompare.
 */
export function byRankThenName(
  a: Pick<Ranked, "rank" | "name">,
  b: Pick<Ranked, "rank" | "name">,
): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Rank updates that realize dropping `activeId` over `overId` within one
 * group. `group` is the group in rendered (byRankThenName-sorted) order.
 * Returns `null` for a no-op or invalid drop. When the group's ranks are
 * pairwise distinct this is a single update (a key between the new
 * neighbours); when any ranks tie, the whole group is renumbered in its new
 * order — updates for rows whose rank is already right are omitted.
 */
export function containerReorderRanks(
  group: Ranked[],
  activeId: string,
  overId: string,
): Array<{ id: string; rank: string }> | null {
  const from = group.findIndex((g) => g.id === activeId);
  const to = group.findIndex((g) => g.id === overId);
  if (from < 0 || to < 0 || from === to) return null;

  const distinct = new Set(group.map((g) => g.rank)).size === group.length;
  if (distinct) {
    const rank = rankForReorder(
      group.map((g) => g.id),
      (id) => group.find((g) => g.id === id)!.rank,
      activeId,
      overId,
    );
    return rank ? [{ id: activeId, rank }] : null;
  }

  // Tied group: freeze the current visual order with the move applied, minting
  // a fresh strictly-increasing chain from the top.
  const next = arrayMove(group, from, to);
  let last: string | null = null;
  const updates: Array<{ id: string; rank: string }> = [];
  for (const g of next) {
    last = rankAfter(last);
    if (g.rank !== last) updates.push({ id: g.id, rank: last });
  }
  return updates;
}
