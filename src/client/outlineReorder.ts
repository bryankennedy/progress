// Pure outline-reordering math (PROG-86), factored out of the Outline view so it
// can be unit-tested without a browser — the sibling analogue of boardOrder.ts.
//
// The Outline sorts each sibling group (actions sharing a focus + parent + arc)
// by the SAME fractional-index `rank` the board uses to order a status column
// (PROG-43). So reordering a row here is just: figure out where it lands among
// its siblings, then mint a rank strictly between its new neighbours — one
// optimistic PATCH, no renumbering, and because the key is shared a drag here
// moves the card on the board too (and vice-versa), which is the whole point of
// the action.
//
// "Strictly between" needs strictly ordered neighbours, and real data has ties
// (racing creates mint duplicate keys — PROG-129). placementRanks handles
// them: a drop into a tied run also returns `heal` ranks re-spacing the run's
// existing rows, so the caller writes a few extra one-row PATCHes and the
// degenerate keys repair themselves.

import { arrayMove } from "@dnd-kit/sortable";
import { placementRanks } from "./rankPlacement";

/** A drop's outcome: the active row's rank + heal writes for tied neighbours. */
export type ReorderPlacement = { rank: string; heal: Array<{ id: string; rank: string }> };

/**
 * Placement for `activeId` after it is dropped over `overId` within one sibling
 * group: the active row's new rank, plus heal ranks for its neighbours when the
 * drop hit a tied run (see placementRanks). `siblingIds` is the group in
 * rendered (rank-sorted) order; `rankOf` returns a sibling's current rank.
 * Returns `null` for a no-op or an invalid drop (either id not in the group, or
 * dropped on itself) so the caller can skip the write.
 */
export function rankForReorder(
  siblingIds: string[],
  rankOf: (id: string) => string,
  activeId: string,
  overId: string,
): ReorderPlacement | null {
  const from = siblingIds.indexOf(activeId);
  const to = siblingIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;

  // arrayMove on the array that still contains the active id adjusts for the
  // index shift when moving down (the boardOrder within-column subtlety).
  const next = arrayMove(siblingIds, from, to);
  const pos = next.indexOf(activeId);
  const others = next.filter((id) => id !== activeId);
  const placed = placementRanks(others.map(rankOf), pos);
  return {
    rank: placed.rank,
    heal: placed.heal.map((h) => ({ id: others[h.index]!, rank: h.rank })),
  };
}

/**
 * Placement for `active` landing in a sibling group it is NOT currently part
 * of — a cross-group drop (PROG-118: into another arc, the loose level, or
 * another focus). `groupIds` is the target group in rendered order, without the
 * active id. Dropped over a member, the action slots before it — or after when
 * `below` (pointer past the member's vertical middle, the board's cross-column
 * rule). Dropped over the group itself (its section header / empty body,
 * `overId` not in the group), it appends to the end.
 */
export function rankForInsert(
  groupIds: string[],
  rankOf: (id: string) => string,
  overId: string,
  below: boolean,
): ReorderPlacement {
  const overIndex = groupIds.indexOf(overId);
  const insertAt = overIndex < 0 ? groupIds.length : overIndex + (below ? 1 : 0);
  const placed = placementRanks(groupIds.map(rankOf), insertAt);
  return {
    rank: placed.rank,
    heal: placed.heal.map((h) => ({ id: groupIds[h.index]!, rank: h.rank })),
  };
}
