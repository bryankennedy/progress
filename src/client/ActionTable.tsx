// The shared sortable action table (PROG-126), extracted from the search
// page's results table (PROG-78) so every tabular list of actions — search,
// container pages, the Agenda's table mode — renders identically: the same
// columns, the same click-to-cycle header sort (asc → desc → back to the
// caller's default order), the same whole-row navigation with a real title
// link for middle-click. Purely presentational: the caller owns the row
// order (relevance, recency, or rank), applies `sortActionHits`, and slices
// for pagination; this renders what it's given.

import { Link, useLocation } from "wouter";
import type { WireAction, SnapshotPayload } from "../shared/types";
import { closedTitleClass } from "./actionDone";
import { localDayOfInstant, relativeDue, todayISO } from "./dates";
import { PRIORITY_LABELS, STATUS_LABELS } from "./labels";
import PriorityIndicator from "./PriorityIndicator";
import { highlight, type ActionSort, type ActionSortKey, type Segment } from "./search";
import { actionKeyOf } from "./store";

// One row: the action plus search-hit context. `inTitle: false` (a
// description-only search hit) renders the matched description snippet under
// the title; plain lists pass `inTitle: true` (or omit terms) and get no
// snippet.
export type ActionTableRow = { action: WireAction; inTitle: boolean };

const COLUMN_LABELS: Record<ActionSortKey, string> = {
  key: "Key",
  title: "Title",
  focus: "Focus",
  status: "Status",
  priority: "Priority",
  due: "Due",
  updated: "Updated",
};

// The search page's column set — the default everywhere a caller doesn't
// trim (container pages drop `focus`, the Agenda adds `due`).
export const DEFAULT_COLUMNS: readonly ActionSortKey[] = [
  "key",
  "title",
  "focus",
  "status",
  "priority",
  "updated",
];

// Full local timestamp for the Updated cell's tooltip (PROG-96) — the same
// format the action page's "Updated …" footer uses.
const fmtUpdated = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// Exported for the search page's container/comment sections, which highlight
// the same way outside the table.
export function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded bg-adobe-wash px-0.5 text-adobe-deep">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

// A ~140-char window of the description around the first matched term, so a
// description-only hit shows WHY it matched without dumping the whole field.
function descSnippet(description: string, terms: string[]): string {
  const lower = description.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (first === -1 || idx < first)) first = idx;
  }
  if (first === -1) return description.slice(0, 140);
  const start = Math.max(0, first - 50);
  const slice = description.slice(start, start + 140).trim();
  return `${start > 0 ? "… " : ""}${slice}${start + 140 < description.length ? " …" : ""}`;
}

export default function ActionTable({
  snapshot,
  rows,
  sort,
  onCycleSort,
  columns = DEFAULT_COLUMNS,
  terms = [],
  trailing,
}: {
  snapshot: SnapshotPayload;
  rows: ActionTableRow[];
  sort: ActionSort | null;
  onCycleSort: (key: ActionSortKey) => void;
  columns?: readonly ActionSortKey[];
  terms?: string[];
  // Optional extra cell at the row's end (the Agenda's bump-due + Done
  // controls). Interactive content must stopPropagation itself if it isn't a
  // button/input — clicks on the cell fall through to row navigation.
  trailing?: (action: WireAction) => React.ReactNode;
}) {
  const [, navigate] = useLocation();
  const focusById = new Map(snapshot.focuses.map((p) => [p.id, p]));
  // Local "today" for relative phrasing — one read per render (PROG-96).
  const today = todayISO();

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((key) => (
              <th
                key={key}
                aria-sort={
                  sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                }
                className="px-3 py-2 text-left"
              >
                <button
                  onClick={() => onCycleSort(key)}
                  className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide hover:text-ink-soft ${
                    sort?.key === key ? "text-ink-soft" : "text-ink-faint"
                  }`}
                >
                  {COLUMN_LABELS[key]}
                  {sort?.key === key && <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span>}
                </button>
              </th>
            ))}
            {trailing && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ action, inTitle }) => {
            const key = actionKeyOf(snapshot, action);
            return (
              // The whole row navigates (the click target the old card rows
              // offered); the title stays a real link for middle-click /
              // open-in-new-tab.
              <tr
                key={action.id}
                data-action-id={action.id}
                onClick={() => navigate(`/action/${key}`)}
                className="cursor-pointer border-t border-line first:border-t-0 hover:bg-line/40"
              >
                {columns.map((col) => {
                  switch (col) {
                    case "key":
                      return (
                        <td
                          key={col}
                          className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-faint"
                        >
                          {key}
                        </td>
                      );
                    case "title":
                      return (
                        <td key={col} className="w-full min-w-56 px-3 py-2">
                          <Link
                            href={`/action/${key}`}
                            onClick={(e) => e.stopPropagation()}
                            className={`hover:underline ${closedTitleClass(action.status)}`}
                          >
                            <Highlighted segments={highlight(action.title, terms)} />
                          </Link>
                          {!inTitle && action.description && (
                            <p className="mt-0.5 truncate text-xs text-ink-soft">
                              <Highlighted
                                segments={highlight(descSnippet(action.description, terms), terms)}
                              />
                            </p>
                          )}
                        </td>
                      );
                    case "focus":
                      return (
                        <td
                          key={col}
                          className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint"
                        >
                          {focusById.get(action.focusId)?.name}
                        </td>
                      );
                    case "status":
                      return (
                        <td
                          key={col}
                          className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint"
                        >
                          {STATUS_LABELS[action.status]}
                        </td>
                      );
                    case "priority":
                      return (
                        <td
                          key={col}
                          className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint"
                        >
                          {action.priority !== "none" ? (
                            <span className="flex items-center gap-1.5">
                              <PriorityIndicator priority={action.priority} />
                              {PRIORITY_LABELS[action.priority]}
                            </span>
                          ) : (
                            <span aria-label={PRIORITY_LABELS.none}>—</span>
                          )}
                        </td>
                      );
                    case "due":
                      return (
                        <td
                          key={col}
                          title={action.dueDate ?? undefined}
                          className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint"
                        >
                          {action.dueDate ? relativeDue(action.dueDate, today) : "—"}
                        </td>
                      );
                    case "updated":
                      return (
                        // Relative phrase ("today", "3 days ago") answers
                        // "what moved recently?" at a glance (PROG-96); the
                        // exact timestamp rides in the tooltip.
                        <td
                          key={col}
                          title={fmtUpdated(action.updatedAt)}
                          className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint"
                        >
                          {relativeDue(localDayOfInstant(action.updatedAt), today)}
                        </td>
                      );
                  }
                })}
                {trailing && (
                  <td
                    onClick={(e) => e.stopPropagation()}
                    className="whitespace-nowrap px-3 py-2 text-xs"
                  >
                    {trailing(action)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
