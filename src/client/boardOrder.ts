// Pure board-reordering math for the kanban (PROG-43), factored out of Home so
// it can be unit-tested without a browser. Given the current per-column card
// order and a drop (active card released over a target), it returns the new
// order. The subtlety this isolates: a within-column move must use arrayMove,
// which adjusts for the index shift when moving DOWN — a naive
// remove-then-insert-at-the-target-index lands one slot short going down (it was
// the off-by-one that snapped a one-slot drop back and made a two-slot drop look
// like one).

import { arrayMove } from "@dnd-kit/sortable";
import { ISSUE_STATUSES, type IssueStatus } from "../shared/constants";

export type ColumnMap = Record<IssueStatus, string[]>;

export type ReorderResult = { columns: ColumnMap; to: IssueStatus };

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
  const from = ISSUE_STATUSES.find((s) => source[s].includes(activeId));
  const to: IssueStatus | undefined =
    overId in source
      ? (overId as IssueStatus)
      : ISSUE_STATUSES.find((s) => source[s].includes(overId));
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
