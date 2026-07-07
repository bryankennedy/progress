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

import { arrayMove } from "@dnd-kit/sortable";
import { rankBetween } from "../shared/rank";

/**
 * New rank for `activeId` after it is dropped over `overId` within one sibling
 * group. `siblingIds` is the group in rendered (rank-sorted) order; `rankOf`
 * returns a sibling's current rank. Returns `null` for a no-op or an invalid
 * drop (either id not in the group, or dropped on itself) so the caller can
 * skip the write.
 */
export function rankForReorder(
  siblingIds: string[],
  rankOf: (id: string) => string,
  activeId: string,
  overId: string,
): string | null {
  const from = siblingIds.indexOf(activeId);
  const to = siblingIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;

  // arrayMove on the array that still contains the active id adjusts for the
  // index shift when moving down (the boardOrder within-column subtlety).
  const next = arrayMove(siblingIds, from, to);
  const pos = next.indexOf(activeId);
  const prevId = pos > 0 ? next[pos - 1]! : null;
  const nextId = pos < next.length - 1 ? next[pos + 1]! : null;

  // The other siblings keep their sorted order, so prev.rank < next.rank holds
  // and rankBetween never throws.
  return rankBetween(prevId ? rankOf(prevId) : null, nextId ? rankOf(nextId) : null);
}
