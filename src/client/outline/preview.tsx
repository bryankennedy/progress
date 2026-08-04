// The outline's drag-overlay previews (PROG-87/118/140), extracted from
// Outline.tsx (PROG-141). Purely presentational: what the DragOverlay carries
// while a container section or an action subtree is in hand — a floating card
// capped to a handful of rows, plus the two flatteners that turn a forest or an
// action's step subtree into those rows. No hooks, no memo, no drag state, so
// living in its own module changes neither behavior nor identity stability.

import type { ReactNode } from "react";
import type { WireAction } from "../../shared/types";
import { isOpenStatus } from "../../shared/constants";
import { CLOSED_TITLE_CLASS } from "../actionDone";
import { byRankThenNumber, type OutlineNode as Node } from "../outlineTree";
import { LevelIcon } from "./LevelIcon";

// One flattened row inside a preview card: a bullet, its text, and enough depth
// to indent it under the header.
export type PreviewRow = {
  key: string;
  depth: number;
  icon: ReactNode;
  text: string;
  done?: boolean;
};

// What the DragOverlay carries while a container section is dragged: a floating
// card that reads as "the whole grouping", capped to a handful of rows so a
// long section doesn't become a screen-tall cursor. Static text only — nothing
// in the overlay is interactive.
export const PREVIEW_ROWS = 6;

export function SectionPreviewCard({
  header,
  rows,
  more,
}: {
  header: ReactNode;
  rows: PreviewRow[];
  more: number;
}) {
  return (
    <div
      data-drag-overlay
      className="cursor-grabbing rounded-lg border border-line bg-card p-2 shadow-xl ring-1 ring-black/5"
    >
      <div className="flex items-center gap-1.5">{header}</div>
      {rows.slice(0, PREVIEW_ROWS).map((r) => (
        <div
          key={r.key}
          className="flex items-center gap-1.5 py-0.5"
          style={{ paddingLeft: 8 + r.depth * 22 }}
        >
          {r.icon}
          <span className={`truncate text-sm ${r.done ? CLOSED_TITLE_CLASS : "text-ink"}`}>
            {r.text}
          </span>
        </div>
      ))}
      {more > 0 && <div className="py-0.5 pl-2 text-xs text-ink-faint">… {more} more</div>}
    </div>
  );
}

// Flatten a forest into preview rows (depth-first, matching rendered order).
export function forestPreviewRows(forest: Node[]): PreviewRow[] {
  const rows: PreviewRow[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      rows.push({
        key: n.action.id,
        depth: n.depth,
        icon: <LevelIcon kind={n.depth === 0 ? "action" : "sub"} />,
        text: n.action.title,
        done: !isOpenStatus(n.action.status),
      });
      walk(n.children);
    }
  };
  walk(forest);
  return rows;
}

// A held action row's overlay rows: its visible step subtree (depth-first,
// rank order), so dragging a parent reads as carrying its block — matching
// what a same-focus drop actually moves (PROG-118).
export function actionSubtreeRows(actions: WireAction[], rootId: string): PreviewRow[] {
  const byParent = new Map<string, WireAction[]>();
  for (const a of actions) {
    if (a.parentActionId === null) continue;
    const sibs = byParent.get(a.parentActionId);
    if (sibs) sibs.push(a);
    else byParent.set(a.parentActionId, [a]);
  }
  const rows: PreviewRow[] = [];
  const walk = (id: string, depth: number) => {
    for (const c of (byParent.get(id) ?? []).sort(byRankThenNumber)) {
      rows.push({
        key: c.id,
        depth,
        icon: <LevelIcon kind="sub" />,
        text: c.title,
        done: !isOpenStatus(c.status),
      });
      walk(c.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return rows;
}
