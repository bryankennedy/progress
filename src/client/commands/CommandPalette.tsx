// The command palette (SPEC §4): ⌘K jumps to anything (issues by key —
// including retired alias keys — or title, containers by name) and exposes
// commands. The single-key actions (s/p/e/m) open the same palette directly
// in a picker mode scoped to the current issue, so there's exactly one
// keyboard-driven surface to learn.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ISSUE_ESTIMATES, ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { addDays, formatDueDate, relativeDue, todayISO } from "../dates";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import {
  findIssueByKey,
  issueKeyOf,
  moveIssue,
  tagIssue,
  untagIssue,
  updateIssue,
} from "../store";
import { copyBundleAsPrompt, copyWorkCommand, workCommand } from "../workOn";
import {
  onOpenPalette,
  openCreateContainer,
  openCreateIssue,
  type PaletteMode,
} from "./controller";

// run() returning "keep" leaves the palette open (used by commands that
// switch it into a picker mode, and by the tag toggles).
type Item = { id: string; label: string; hint?: string; run: () => void | "keep" };

const MODE_TITLES: Record<Exclude<PaletteMode["kind"], "root">, string> = {
  status: "Change status",
  priority: "Set priority",
  estimate: "Set estimate",
  move: "Move to",
  tag: "Tags",
  arc: "Set arc",
  due: "Set due date",
  workon: "Work on this",
};

export default function CommandPalette({ workspace }: { workspace: WorkspacePayload }) {
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
    () => (mode ? buildItems(workspace, mode, query, navigate, switchMode) : []),
    // eslint-style exhaustiveness doesn't apply: navigate/switchMode are stable enough here.
    [workspace, mode, query, navigate],
  );

  const sel = Math.min(selected, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, [sel, items]);

  if (!mode) return null;

  const close = () => setMode(null);
  const execute = (item: Item) => {
    if (item.run() !== "keep") close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(sel + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(sel - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[sel];
      if (item) execute(item);
    } else if (e.key === "Backspace" && query === "" && mode.kind !== "root") {
      e.preventDefault();
      switchMode({ kind: "root", issueId: mode.issueId });
    }
  };

  const ctxIssue =
    mode.kind !== "root" ? workspace.issues.find((i) => i.id === mode.issueId) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/20 p-4" onMouseDown={close}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto mt-[12vh] max-w-lg overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl"
      >
        {ctxIssue && (
          <p className="border-b border-stone-100 px-4 pb-2 pt-3 text-xs text-stone-400">
            {MODE_TITLES[mode.kind as keyof typeof MODE_TITLES]} ·{" "}
            <span className="font-mono">{issueKeyOf(workspace, ctxIssue)}</span>{" "}
            <span className="text-stone-500">{ctxIssue.title}</span>
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
          className="w-full border-b border-stone-100 px-4 py-3 text-sm focus:outline-none"
        />
        <ul ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => execute(item)}
                onMouseMove={() => setSelected(i)}
                data-selected={i === sel || undefined}
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm data-selected:bg-stone-100"
              >
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-stone-400">{item.hint}</span>}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-stone-400">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function buildItems(
  ws: WorkspacePayload,
  mode: PaletteMode,
  query: string,
  navigate: (to: string) => void,
  switchMode: (m: PaletteMode) => void,
): Item[] {
  const q = query.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(q);

  if (mode.kind === "root") return rootItems(ws, mode.issueId, q, navigate, switchMode);

  const issue = ws.issues.find((i) => i.id === mode.issueId);
  if (!issue) return [];

  switch (mode.kind) {
    case "status":
      return ISSUE_STATUSES.filter((s) => matches(STATUS_LABELS[s])).map((s) => ({
        id: s,
        label: STATUS_LABELS[s],
        hint: s === issue.status ? "current" : undefined,
        run: () => updateIssue(issue.id, { status: s }),
      }));
    case "priority":
      return ISSUE_PRIORITIES.filter((p) => matches(PRIORITY_LABELS[p])).map((p) => ({
        id: p,
        label: PRIORITY_LABELS[p],
        hint: p === issue.priority ? "current" : undefined,
        run: () => updateIssue(issue.id, { priority: p }),
      }));
    case "estimate":
      return [null, ...ISSUE_ESTIMATES]
        .map((e) => ({ value: e, label: e === null ? "No estimate" : String(e) }))
        .filter((e) => matches(e.label))
        .map((e) => ({
          id: String(e.value),
          label: e.label,
          hint: e.value === issue.estimate ? "current" : undefined,
          run: () => updateIssue(issue.id, { estimate: e.value }),
        }));
    case "tag": {
      const assigned = new Set(
        ws.issueTags.filter((l) => l.issueId === issue.id).map((l) => l.tagId),
      );
      const items: Item[] = ws.tags
        .filter((t) => matches(t.name))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({
          id: t.id,
          label: t.name,
          hint: assigned.has(t.id) ? "✓ added" : undefined,
          run: () => {
            if (assigned.has(t.id)) untagIssue(issue.id, t.id);
            else tagIssue(issue.id, { tagId: t.id });
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
            tagIssue(issue.id, { name });
            return "keep";
          },
        });
      }
      return items;
    }
    case "arc": {
      const productArcs = ws.arcs.filter((a) => a.productId === issue.productId && !a.archivedAt);
      // "No arc" filters like any option, so a typed query can't leave it
      // sitting first and steal the Enter.
      return [
        {
          id: "arc:none",
          label: "No arc",
          hint: issue.arcId === null ? "current" : undefined,
          run: () => updateIssue(issue.id, { arcId: null }),
        },
        ...productArcs.map((a) => ({
          id: a.id,
          label: a.name,
          hint: a.id === issue.arcId ? "current" : undefined,
          run: () => updateIssue(issue.id, { arcId: a.id }),
        })),
      ].filter((item) => matches(item.label));
    }
    case "move": {
      const targets: { productId: string; repoId: string | null; label: string; hint: string }[] =
        [];
      // Archived containers aren't valid destinations (D26).
      for (const product of ws.products.filter((p) => !p.archivedAt)) {
        targets.push({ productId: product.id, repoId: null, label: product.name, hint: "Product" });
        for (const repo of ws.repos.filter((r) => r.productId === product.id && !r.archivedAt)) {
          targets.push({
            productId: product.id,
            repoId: repo.id,
            label: `${product.name} / ${repo.name}`,
            hint: "Repo",
          });
        }
      }
      return targets
        .filter((t) => !(t.productId === issue.productId && t.repoId === issue.repoId))
        .filter((t) => matches(t.label))
        .map((t) => ({
          id: `${t.productId}:${t.repoId ?? ""}`,
          label: t.label,
          hint: t.hint,
          run: () => moveIssue(issue.id, { productId: t.productId, repoId: t.repoId }),
        }));
    }
    case "due": {
      const today = todayISO();
      // Relative quick-picks plus a "Clear" when one is set; a typed YYYY-MM-DD
      // in the query becomes a "Set to …" item (the §5 picker accepts an exact
      // calendar day too).
      const options: { id: string; label: string; value: string | null }[] = [
        { id: "due:today", label: `Today (${formatDueDate(today)})`, value: today },
        { id: "due:tomorrow", label: `Tomorrow (${formatDueDate(addDays(today, 1))})`, value: addDays(today, 1) },
        { id: "due:3d", label: `In 3 days (${formatDueDate(addDays(today, 3))})`, value: addDays(today, 3) },
        { id: "due:1w", label: `In a week (${formatDueDate(addDays(today, 7))})`, value: addDays(today, 7) },
        { id: "due:2w", label: `In 2 weeks (${formatDueDate(addDays(today, 14))})`, value: addDays(today, 14) },
      ];
      if (issue.dueDate) options.push({ id: "due:clear", label: "Clear due date", value: null });
      const items: Item[] = options
        .filter((o) => matches(o.label))
        .map((o) => ({
          id: o.id,
          label: o.label,
          hint: o.value === issue.dueDate ? "current" : o.value === null ? undefined : relativeDue(o.value, today),
          run: () => updateIssue(issue.id, { dueDate: o.value }),
        }));
      const typed = query.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(typed) && typed !== issue.dueDate) {
        items.unshift({
          id: "due:typed",
          label: `Set to ${typed}`,
          hint: relativeDue(typed, today),
          run: () => updateIssue(issue.id, { dueDate: typed }),
        });
      }
      return items;
    }
    case "workon": {
      const key = issueKeyOf(ws, issue);
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
  ws: WorkspacePayload,
  issueId: string | null,
  q: string,
  navigate: (to: string) => void,
  switchMode: (m: PaletteMode) => void,
): Item[] {
  const matches = (label: string) => label.toLowerCase().includes(q);
  const items: Item[] = [];

  const issue = issueId ? ws.issues.find((i) => i.id === issueId) : undefined;
  const commands: Item[] = [
    { id: "cmd:create", label: "Create issue…", hint: "C", run: () => openCreateIssue() },
  ];
  if (issue) {
    const key = issueKeyOf(ws, issue);
    const picker = (kind: Exclude<PaletteMode["kind"], "root">, hint: string): Item => ({
      id: `cmd:${kind}`,
      label: `${MODE_TITLES[kind]}… · ${key}`,
      hint,
      run: () => {
        switchMode({ kind, issueId: issue.id });
        return "keep";
      },
    });
    commands.push(
      picker("status", "S"),
      picker("priority", "P"),
      picker("estimate", "E"),
      picker("move", "M"),
      picker("tag", "T"),
      picker("arc", "A"),
      picker("due", "D"),
      picker("workon", "W"),
    );
  }
  for (const kind of ["initiative", "product", "repo", "arc"] as const) {
    commands.push({
      id: `cmd:new-${kind}`,
      label: `Create ${kind}…`,
      run: () => openCreateContainer({ kind }),
    });
  }
  items.push(...commands.filter((c) => q === "" || matches(c.label)));

  if (q === "") return items;

  const productById = new Map(ws.products.map((p) => [p.id, p]));
  const keyOf = (i: WireIssue) => `${productById.get(i.productId)?.keyPrefix ?? "?"}-${i.number}`;
  const issueItem = (i: WireIssue): Item => ({
    id: i.id,
    label: `${keyOf(i)} — ${i.title}`,
    hint: STATUS_LABELS[i.status],
    run: () => navigate(`/issue/${keyOf(i)}`),
  });

  // Exact key lookup first — it also catches retired alias keys (SPEC §3),
  // which a substring scan over current keys would miss.
  const byKey = findIssueByKey(ws, q);
  if (byKey) items.push(issueItem(byKey.issue));
  const ranked = ws.issues
    .filter((i) => i.id !== byKey?.issue.id)
    .map((i) => {
      const key = keyOf(i).toLowerCase();
      const score = key.startsWith(q) ? 0 : matches(i.title) ? 1 : key.includes(q) ? 2 : -1;
      return { issue: i, key, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))
    .slice(0, byKey ? 7 : 8);
  items.push(...ranked.map((r) => issueItem(r.issue)));

  // Archived containers stay out of search (reachable from their parent's
  // page, which lists them dimmed — D26).
  const containers = [
    ...ws.initiatives.map((x) => ({ ...x, hint: "Initiative", href: `/initiative/${x.id}` })),
    ...ws.products.map((x) => ({ ...x, hint: "Product", href: `/product/${x.id}` })),
    ...ws.repos.map((x) => ({ ...x, hint: "Repo", href: `/repo/${x.id}` })),
    ...ws.arcs.map((x) => ({ ...x, hint: "Arc", href: `/arc/${x.id}` })),
  ]
    .filter((c) => !c.archivedAt && matches(c.name))
    .slice(0, 6);
  items.push(
    ...containers.map((c) => ({ id: c.id, label: c.name, hint: c.hint, run: () => navigate(c.href) })),
  );

  return items;
}
