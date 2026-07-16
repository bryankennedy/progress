// The command palette (SPEC §4): ⌘K jumps to anything (actions by key —
// including retired alias keys — or title, containers by name) and exposes
// commands. The single-key actions (s/p/e/l) open the same palette directly
// in a picker mode scoped to the current action, so there's exactly one
// keyboard-driven surface to learn.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ACTION_ESTIMATES, ACTION_PRIORITIES, ACTION_STATUSES } from "../../shared/constants";
import type { WireAction, SnapshotPayload } from "../../shared/types";
import { sortByName } from "../boardFilters";
import { byRankThenName, sortContainers } from "../containerReorder";
import { addDays, formatDueDate, relativeDue, todayISO } from "../dates";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import {
  findActionByKey,
  actionKeyOf,
  moveAction,
  tagAction,
  untagAction,
  updateAction,
} from "../store";
import { copyBundleAsPrompt, copyWorkCommand, workCommand } from "../workOn";
import {
  onOpenPalette,
  openCreateContainer,
  openCreateAction,
  type PaletteMode,
} from "./controller";

// run() returning "keep" leaves the palette open (used by commands that
// switch it into a picker mode, and by the tag toggles). `header` rows are
// inert group labels (the workspace level of the location tree, PROG-123b):
// greyed out, skipped by keyboard selection, no run. `indent` nests tree
// levels visually (1 = focus, 2 = arc).
type Item = {
  id: string;
  label: string;
  hint?: string;
  indent?: 1 | 2;
} & ({ header: true; run?: undefined } | { header?: undefined; run: () => void | "keep" });

const MODE_TITLES: Record<Exclude<PaletteMode["kind"], "root">, string> = {
  status: "Change status",
  priority: "Set priority",
  estimate: "Set estimate",
  location: "Set location",
  tag: "Tags",
  due: "Set due date",
  workon: "Work on this",
};

export default function CommandPalette({ snapshot }: { snapshot: SnapshotPayload }) {
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [, navigate] = useLocation();
  const listRef = useRef<HTMLUListElement>(null);

  const switchMode = (m: PaletteMode) => {
    setMode(m);
    setQuery("");
    setSelected(0);
  };

  useEffect(() => onOpenPalette(switchMode), []);

  const items = useMemo(
    () => (mode ? buildItems(snapshot, mode, query, navigate, switchMode) : []),
    // eslint-style exhaustiveness doesn't apply: navigate/switchMode are stable enough here.
    [snapshot, mode, query, navigate],
  );

  // Keyboard selection walks only the actionable rows — inert group headers
  // (PROG-123b) render in place but can't be landed on.
  const selectables = useMemo(() => items.filter((it) => !it.header), [items]);
  const sel = Math.min(selected, Math.max(selectables.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, [sel, items]);

  if (!mode) return null;

  const close = () => setMode(null);
  const execute = (item: Item) => {
    if (item.run && item.run() !== "keep") close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(sel + 1, selectables.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(sel - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = selectables[sel];
      if (item) execute(item);
    } else if (e.key === "Backspace" && query === "" && mode.kind !== "root") {
      e.preventDefault();
      switchMode({ kind: "root", actionId: mode.actionId });
    }
  };

  const ctxAction =
    mode.kind !== "root" ? snapshot.actions.find((i) => i.id === mode.actionId) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 p-4" onMouseDown={close}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto mt-[12vh] max-w-lg overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
      >
        {ctxAction && (
          <p className="border-b border-line px-4 pb-2 pt-3 text-xs text-ink-faint">
            {MODE_TITLES[mode.kind as keyof typeof MODE_TITLES]} ·{" "}
            <span className="font-mono">{actionKeyOf(snapshot, ctxAction)}</span>{" "}
            <span className="text-ink-soft">{ctxAction.title}</span>
          </p>
        )}
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder={mode.kind === "root" ? "Type a command or search…" : "Filter…"}
          className="w-full border-b border-line px-4 py-3 text-sm focus:outline-none"
        />
        <ul ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {items.map((item) =>
            item.header ? (
              <li key={item.id}>
                <div className="truncate py-1.5 pl-3 pr-3 text-sm text-ink-faint">{item.label}</div>
              </li>
            ) : (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => execute(item)}
                  onMouseMove={() => setSelected(selectables.indexOf(item))}
                  data-selected={item === selectables[sel] || undefined}
                  className={`flex w-full items-center justify-between gap-3 rounded-md py-2 pr-3 text-left text-sm data-selected:bg-line ${
                    item.indent === 2 ? "pl-11" : item.indent === 1 ? "pl-7" : "pl-3"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.hint && (
                    <span className="shrink-0 text-xs text-ink-faint">{item.hint}</span>
                  )}
                </button>
              </li>
            ),
          )}
          {selectables.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-faint">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function buildItems(
  ws: SnapshotPayload,
  mode: PaletteMode,
  query: string,
  navigate: (to: string) => void,
  switchMode: (m: PaletteMode) => void,
): Item[] {
  const q = query.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(q);

  if (mode.kind === "root") return rootItems(ws, mode.actionId, q, navigate, switchMode);

  const action = ws.actions.find((i) => i.id === mode.actionId);
  if (!action) return [];

  switch (mode.kind) {
    case "status":
      return ACTION_STATUSES.filter((s) => matches(STATUS_LABELS[s])).map((s) => ({
        id: s,
        label: STATUS_LABELS[s],
        hint: s === action.status ? "current" : undefined,
        run: () => void updateAction(action.id, { status: s }),
      }));
    case "priority":
      return ACTION_PRIORITIES.filter((p) => matches(PRIORITY_LABELS[p])).map((p) => ({
        id: p,
        label: PRIORITY_LABELS[p],
        hint: p === action.priority ? "current" : undefined,
        run: () => void updateAction(action.id, { priority: p }),
      }));
    case "estimate":
      return [null, ...ACTION_ESTIMATES]
        .map((e) => ({ value: e, label: e === null ? "No estimate" : String(e) }))
        .filter((e) => matches(e.label))
        .map((e) => ({
          id: String(e.value),
          label: e.label,
          hint: e.value === action.estimate ? "current" : undefined,
          run: () => void updateAction(action.id, { estimate: e.value }),
        }));
    case "tag": {
      const assigned = new Set(
        ws.actionTags.filter((l) => l.actionId === action.id).map((l) => l.tagId),
      );
      const items: Item[] = sortByName(ws.tags.filter((t) => matches(t.name))).map((t) => ({
        id: t.id,
        label: t.name,
        hint: assigned.has(t.id) ? "✓ added" : undefined,
        run: () => {
          if (assigned.has(t.id)) untagAction(action.id, t.id);
          else tagAction(action.id, { tagId: t.id });
          return "keep";
        },
      }));
      const name = query.trim();
      if (name !== "" && !ws.tags.some((t) => t.name.toLowerCase() === q)) {
        items.push({
          id: "tag:create",
          label: `Create tag "${name}"`,
          hint: "new",
          run: () => {
            tagAction(action.id, { name });
            return "keep";
          },
        });
      }
      return items;
    }
    case "location": {
      // One picker owns the whole outline position (PROG-123b, replacing the
      // separate move + arc modes): the tree renders Workspace (inert, greyed
      // header) → Focus → Arc in the manual rank order set on the
      // outline/structure pages (supersedes PROG-83's alphabetical rule
      // here). Picking a focus row means "this focus, no arc" — there's no
      // separate "No arc" row — and picking an arc lands focus + arc in one
      // step (moveAction already carries an arcId, PROG-118). Same-focus
      // picks are a plain field update; the current location hints "current".
      // Archived containers aren't destinations (D26). A query matches a row
      // or any ancestor (an ancestor match keeps its whole subtree), and
      // ancestors of a match stay visible as context.
      const items: Item[] = [];
      for (const workspace of sortContainers(ws.workspaces)) {
        const wsMatch = matches(workspace.name);
        const group: Item[] = [];
        for (const focus of ws.focuses
          .filter((p) => p.workspaceId === workspace.id && !p.archivedAt)
          .sort(byRankThenName)) {
          const focusMatch = wsMatch || matches(focus.name);
          const visibleArcs = ws.arcs
            .filter((a) => a.focusId === focus.id && !a.archivedAt)
            .sort(byRankThenName)
            .filter((a) => focusMatch || matches(a.name));
          if (!focusMatch && visibleArcs.length === 0) continue;
          group.push({
            id: focus.id,
            label: focus.name,
            indent: 1,
            hint: focus.id === action.focusId && action.arcId === null ? "current" : undefined,
            run: () =>
              focus.id === action.focusId
                ? void updateAction(action.id, { arcId: null })
                : moveAction(action.id, { focusId: focus.id }),
          });
          group.push(
            ...visibleArcs.map((a): Item => ({
              id: a.id,
              label: a.name,
              indent: 2,
              hint: a.id === action.arcId ? "current" : undefined,
              run: () =>
                focus.id === action.focusId
                  ? void updateAction(action.id, { arcId: a.id })
                  : moveAction(action.id, { focusId: focus.id, arcId: a.id }),
            })),
          );
        }
        if (group.length > 0)
          items.push({ id: workspace.id, label: workspace.name, header: true }, ...group);
      }
      return items;
    }
    case "due": {
      const today = todayISO();
      // Relative quick-picks plus a "Clear" when one is set; a typed YYYY-MM-DD
      // in the query becomes a "Set to …" item (the §5 picker accepts an exact
      // calendar day too).
      const options: { id: string; label: string; value: string | null }[] = [
        { id: "due:today", label: `Today (${formatDueDate(today)})`, value: today },
        {
          id: "due:tomorrow",
          label: `Tomorrow (${formatDueDate(addDays(today, 1))})`,
          value: addDays(today, 1),
        },
        {
          id: "due:3d",
          label: `In 3 days (${formatDueDate(addDays(today, 3))})`,
          value: addDays(today, 3),
        },
        {
          id: "due:1w",
          label: `In a week (${formatDueDate(addDays(today, 7))})`,
          value: addDays(today, 7),
        },
        {
          id: "due:2w",
          label: `In 2 weeks (${formatDueDate(addDays(today, 14))})`,
          value: addDays(today, 14),
        },
      ];
      if (action.dueDate) options.push({ id: "due:clear", label: "Clear due date", value: null });
      const items: Item[] = options
        .filter((o) => matches(o.label))
        .map((o) => ({
          id: o.id,
          label: o.label,
          hint:
            o.value === action.dueDate
              ? "current"
              : o.value === null
                ? undefined
                : relativeDue(o.value, today),
          run: () => void updateAction(action.id, { dueDate: o.value }),
        }));
      const typed = query.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(typed) && typed !== action.dueDate) {
        items.unshift({
          id: "due:typed",
          label: `Set to ${typed}`,
          hint: relativeDue(typed, today),
          run: () => void updateAction(action.id, { dueDate: typed }),
        });
      }
      return items;
    }
    case "workon": {
      const key = actionKeyOf(ws, action);
      return (
        [
          {
            id: "workon:prompt",
            label: "Copy as prompt",
            hint: "bundle",
            run: () => void copyBundleAsPrompt(key),
          },
          {
            id: "workon:cli",
            label: `Copy ${workCommand(key)}`,
            hint: "CLI",
            run: () => copyWorkCommand(key),
          },
        ] satisfies Item[]
      ).filter((i) => matches(i.label));
    }
  }
}

function rootItems(
  ws: SnapshotPayload,
  actionId: string | null,
  q: string,
  navigate: (to: string) => void,
  switchMode: (m: PaletteMode) => void,
): Item[] {
  const matches = (label: string) => label.toLowerCase().includes(q);
  const items: Item[] = [];

  const action = actionId ? ws.actions.find((i) => i.id === actionId) : undefined;
  const commands: Item[] = [
    { id: "cmd:create", label: "Create action…", hint: "C", run: () => openCreateAction() },
  ];
  if (action) {
    const key = actionKeyOf(ws, action);
    const picker = (kind: Exclude<PaletteMode["kind"], "root">, hint: string): Item => ({
      id: `cmd:${kind}`,
      label: `${MODE_TITLES[kind]}… · ${key}`,
      hint,
      run: () => {
        switchMode({ kind, actionId: action.id });
        return "keep";
      },
    });
    commands.push(
      picker("status", "S"),
      picker("priority", "P"),
      picker("estimate", "E"),
      picker("location", "L"),
      picker("tag", "T"),
      picker("due", "D"),
      picker("workon", "W"),
    );
  }
  for (const kind of ["workspace", "focus", "arc"] as const) {
    commands.push({
      id: `cmd:new-${kind}`,
      label: `Create ${kind}…`,
      run: () => openCreateContainer({ kind }),
    });
  }
  items.push(...commands.filter((c) => q === "" || matches(c.label)));

  if (q === "") return items;

  const focusById = new Map(ws.focuses.map((p) => [p.id, p]));
  const keyOf = (i: WireAction) => `${focusById.get(i.focusId)?.keyPrefix ?? "?"}-${i.number}`;
  const actionItem = (i: WireAction): Item => ({
    id: i.id,
    label: `${keyOf(i)} — ${i.title}`,
    hint: STATUS_LABELS[i.status],
    run: () => navigate(`/action/${keyOf(i)}`),
  });

  // Exact key lookup first — it also catches retired alias keys (SPEC §3),
  // which a substring scan over current keys would miss.
  const byKey = findActionByKey(ws, q);
  if (byKey) items.push(actionItem(byKey.action));
  const ranked = ws.actions
    .filter((i) => i.id !== byKey?.action.id)
    .map((i) => {
      const key = keyOf(i).toLowerCase();
      const score = key.startsWith(q) ? 0 : matches(i.title) ? 1 : key.includes(q) ? 2 : -1;
      return { action: i, key, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, byKey ? 7 : 8);
  items.push(...ranked.map((r) => actionItem(r.action)));

  // Archived containers stay out of search (reachable from their parent's
  // page, which lists them dimmed — D26). Each kind lists alphabetically
  // (PROG-83), kinds in hierarchy order, so the cap trims deterministically.
  const containers = [
    ...sortByName(ws.workspaces).map((x) => ({
      ...x,
      hint: "Workspace",
      href: `/workspace/${x.id}`,
    })),
    ...sortByName(ws.focuses).map((x) => ({ ...x, hint: "Focus", href: `/focus/${x.id}` })),
    ...sortByName(ws.arcs).map((x) => ({ ...x, hint: "Arc", href: `/arc/${x.id}` })),
  ]
    .filter((c) => !c.archivedAt && matches(c.name))
    .slice(0, 6);
  items.push(
    ...containers.map((c) => ({
      id: c.id,
      label: c.name,
      hint: c.hint,
      run: () => navigate(c.href),
    })),
  );

  return items;
}
