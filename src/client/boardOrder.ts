// Pure board-reordering math for the kanban (PROG-43), factored out of Home so
// it can be unit-tested without a browser. Given the *current* per-column card
// order (the live, preview-updated order — see PROG-59) and a drop (active card
// released over a target), it returns the new order. Two subtleties it isolates:
//
//  - A within-column move must use arrayMove, which adjusts for the index shift
//    when moving DOWN — a naive remove-then-insert-at-the-target-index lands one
//    slot short going down (PROG-43: snapped a one-slot drop back, made a
//    two-slot drop look like one).
//  - For a cross-column drag, the caller passes the LIVE columns in which
//    onDragOver has already placed the active card in the target column. So at
//    drop the active card is found in the target, and `overId` may even be the
//    active card itself — both handled by the from===to branch (PROG-59).

import { arrayMove } from "@dnd-kit/sortable";
import { ACTION_STATUSES, type ActionStatus } from "../shared/constants";

export type ColumnMap = Record<ActionStatus, string[]>;

export type ReorderResult = { columns: ColumnMap; to: ActionStatus };

/**
 * New column order after dropping `activeId` over `overId`.
 *
 * `overId` is either a column id (a status — dropped on the column itself, i.e.
 * the end) or a card id. `below` is whether the pointer was past the hovered
 * card's vertical middle; it only matters for cross-column drops (within a
 * column, arrayMove derives the side from the indices). Returns `null` when the
 * drop is invalid (unknown ids).
 */
export function reorder(
  source: ColumnMap,
  activeId: string,
  overId: string,
  below: boolean,
): ReorderResult | null {
  const from = ACTION_STATUSES.find((s) => source[s].includes(activeId));
  const to: ActionStatus | undefined =
    overId in source
      ? (overId as ActionStatus)
      : ACTION_STATUSES.find((s) => source[s].includes(overId));
  if (!from || !to) return null;

  let targetItems: string[];
  if (from === to) {
    // Reorder within a column: arrayMove on the array that STILL contains the
    // active card adjusts for the shift when moving down.
    const items = source[to];
    const activeIndex = items.indexOf(activeId);
    const overIndex = overId in source ? items.length - 1 : items.indexOf(overId);
    if (activeIndex < 0 || overIndex < 0) return null;
    targetItems = arrayMove(items, activeIndex, overIndex);
  } else {
    // Across columns: the active card isn't in the target, so insert directly —
    // below the hovered card when the pointer is past its middle.
    const base = source[to];
    if (overId in source) {
      targetItems = [...base, activeId];
    } else {
      const overIndex = base.indexOf(overId);
      const insertAt = overIndex < 0 ? base.length : overIndex + (below ? 1 : 0);
      targetItems = [...base.slice(0, insertAt), activeId, ...base.slice(insertAt)];
    }
  }

  const columns: ColumnMap = { ...source };
  if (from !== to) columns[from] = source[from].filter((x) => x !== activeId);
  columns[to] = targetItems;
  return { columns, to };
}
