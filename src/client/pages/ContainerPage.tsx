// Container pages (SPEC §4): every workspace, focus, and arc gets a page —
// description on top (open-page feel), action list below with inline
// status/priority edits. One component covers all three types; they differ
// only in how their action scope and child links derive from the snapshot.
// A focus additionally edits its key prefix and optional git repo (PROG-102).

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  type ActionPriority,
  type ActionStatus,
} from "../../shared/constants";
import type { WireAction, SnapshotPayload } from "../../shared/types";
import { openCreateContainer } from "../commands/controller";
import { closedTitleClass } from "../actionDone";
import Breadcrumb from "../Breadcrumb";
import { sortContainers } from "../containerReorder";
import EditableMarkdown from "../EditableMarkdown";
import InlineEdit from "../InlineEdit";
import { PRIORITY_LABELS as SHARED_PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { actionKeyOf, updateContainer, updateAction } from "../store";
import { copyArcBundleAsPrompt, prefetchArcBundle } from "../workOn";

export type ContainerType = "workspace" | "focus" | "arc";

const TYPE_LABELS: Record<ContainerType, string> = {
  workspace: "Workspace",
  focus: "Focus",
  arc: "Arc",
};
// Compact "none" for the narrow inline row selects.
const PRIORITY_LABELS: Record<ActionPriority, string> = {
  ...SHARED_PRIORITY_LABELS,
  none: "—",
};

type ChildGroup = {
  label: string;
  items: { href: string; name: string; archived: boolean }[];
  onNew?: () => void;
};

type Resolved = {
  name: string;
  description: string;
  archivedAt: string | null;
  keyPrefix?: string;
  gitUrl?: string | null;
  actions: WireAction[];
  children: ChildGroup[];
  boardParam: string;
};

function resolve(ws: SnapshotPayload, type: ContainerType, id: string): Resolved | undefined {
  switch (type) {
    case "workspace": {
      const workspace = ws.workspaces.find((i) => i.id === id);
      if (!workspace) return undefined;
      // Child lists share the container display order (sortContainers,
      // PROG-83): active first, rank-then-name — alpha until first reordered.
      const focuses = sortContainers(ws.focuses.filter((p) => p.workspaceId === id));
      const focusIds = new Set(focuses.map((p) => p.id));
      return {
        ...workspace,
        actions: ws.actions.filter((i) => focusIds.has(i.focusId)),
        children: [
          {
            label: "Focuses",
            items: focuses.map((p) => ({
              href: `/focus/${p.id}`,
              name: p.name,
              archived: p.archivedAt !== null,
            })),
            onNew: () => openCreateContainer({ kind: "focus", workspaceId: id }),
          },
        ],
        boardParam: `workspace=${id}`,
      };
    }
    case "focus": {
      const focus = ws.focuses.find((p) => p.id === id);
      if (!focus) return undefined;
      return {
        ...focus,
        actions: ws.actions.filter((i) => i.focusId === id),
        children: [
          {
            label: "Arcs",
            items: sortContainers(ws.arcs.filter((a) => a.focusId === id)).map((a) => ({
              href: `/arc/${a.id}`,
              name: a.name,
              archived: a.archivedAt !== null,
            })),
            onNew: () => openCreateContainer({ kind: "arc", focusId: id }),
          },
        ],
        boardParam: `focus=${id}`,
      };
    }
    case "arc": {
      const arc = ws.arcs.find((a) => a.id === id);
      if (!arc) return undefined;
      return {
        ...arc,
        actions: ws.actions.filter((i) => i.arcId === id),
        children: [],
        boardParam: `focus=${arc.focusId}&arc=${id}`,
      };
    }
  }
}

// The linked ancestor crumbs for a container page (PROG-103): a focus sits
// under its workspace; an arc under its focus (and that focus's workspace); a
// workspace is a root. Dangling parents just shorten the trail.
function ancestorCrumbs(
  ws: SnapshotPayload,
  type: ContainerType,
  id: string,
): { label: string; href: string }[] {
  const focusId =
    type === "focus" ? id : type === "arc" ? ws.arcs.find((a) => a.id === id)?.focusId : undefined;
  const focus = focusId ? ws.focuses.find((p) => p.id === focusId) : undefined;
  const workspace = focus ? ws.workspaces.find((w) => w.id === focus.workspaceId) : undefined;
  return [
    ...(workspace ? [{ label: workspace.name, href: `/workspace/${workspace.id}` }] : []),
    ...(focus && type !== "focus" ? [{ label: focus.name, href: `/focus/${focus.id}` }] : []),
  ];
}

type SortMode = "status" | "number" | "updated";
const STATUS_ORDER = new Map(ACTION_STATUSES.map((s, i) => [s, i]));

export default function ContainerPage({
  snapshot,
  type,
  id,
}: {
  snapshot: SnapshotPayload;
  type: ContainerType;
  id: string;
}) {
  const [sort, setSort] = useState<SortMode>("status");
  const [statusFilter, setStatusFilter] = useState<ActionStatus | "">("");

  const resolved = useMemo(() => resolve(snapshot, type, id), [snapshot, type, id]);

  const actions = useMemo(() => {
    if (!resolved) return [];
    const list = resolved.actions.filter((i) => !statusFilter || i.status === statusFilter);
    return list.sort((a, b) => {
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "status")
        return STATUS_ORDER.get(a.status)! - STATUS_ORDER.get(b.status)! || a.number - b.number;
      return a.number - b.number;
    });
  }, [resolved, sort, statusFilter]);

  // Warm the arc work-order cache on mount and whenever this arc's actions
  // change, so "Copy arc as prompt" copies instantly with the latest state.
  useEffect(() => {
    if (type === "arc") prefetchArcBundle(id);
  }, [type, id, resolved?.actions]);

  if (!resolved) {
    return (
      <p className="text-ink-soft">
        No {TYPE_LABELS[type].toLowerCase()} with id <span className="font-mono">{id}</span>.{" "}
        <Link href="/" className="text-adobe hover:underline">
          Back to the board
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Ancestors in the structure tree, then the page's own kind (PROG-103)
          — the name itself is the H1 right below. Replaces the old
          "Snapshot /" trail (same rationale as the action page). */}
      <Breadcrumb crumbs={[...ancestorCrumbs(snapshot, type, id), { label: TYPE_LABELS[type] }]} />

      <header className="mt-4">
        <div className="flex items-start gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">
            <InlineEdit
              value={resolved.name}
              onSave={(name) => updateContainer(type, id, { name })}
              validate={(v) => v !== ""}
              className="w-full"
              inputClassName="text-2xl font-semibold tracking-tight"
            />
          </h1>
          {resolved.archivedAt && (
            <span className="mt-2 text-xs uppercase tracking-wide font-mono text-ink-faint">
              archived
            </span>
          )}
          <button
            onClick={() => updateContainer(type, id, { archived: !resolved.archivedAt })}
            className="mt-1.5 shrink-0 rounded border border-line bg-card px-2 py-0.5 text-xs text-ink-soft hover:border-ink-faint"
          >
            {resolved.archivedAt ? "Unarchive" : "Archive"}
          </button>
        </div>
        {type === "focus" && (
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
            Key prefix
            <InlineEdit
              value={resolved.keyPrefix ?? ""}
              onSave={(keyPrefix) => updateContainer(type, id, { keyPrefix })}
              validate={(v) => /^[A-Za-z]{2,8}$/.test(v)}
              className="font-mono text-ink-soft"
              inputClassName="w-24 font-mono text-xs uppercase"
            />
          </p>
        )}
        {type === "focus" && (
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
            Git URL
            <InlineEdit
              value={resolved.gitUrl ?? ""}
              onSave={(gitUrl) => updateContainer(type, id, { gitUrl: gitUrl || null })}
              placeholder="none — the repo this focus mirrors"
              className="font-mono text-ink-soft"
              inputClassName="w-80 max-w-full font-mono text-xs"
            />
          </p>
        )}
        <div className="mt-3 max-w-2xl text-ink-soft">
          <EditableMarkdown
            value={resolved.description}
            placeholder="Add a description…"
            draftScope={{ meId: snapshot.me?.id ?? "anon", targetId: id }}
            onSave={(description) =>
              updateContainer(type, id, { description }, { toastOnError: false })
            }
          />
        </div>
      </header>

      {resolved.children.map(
        (group) =>
          (group.items.length > 0 || group.onNew) && (
            <p key={group.label} className="mt-4 flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-xs uppercase tracking-wide font-mono text-ink-faint">
                {group.label}
              </span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded border border-line bg-card px-2 py-0.5 hover:border-ink-faint ${
                    item.archived ? "text-ink-faint opacity-60" : ""
                  }`}
                >
                  {item.name}
                  {item.archived && <span className="ml-1 text-[10px] uppercase">archived</span>}
                </Link>
              ))}
              {group.onNew && (
                <button
                  onClick={group.onNew}
                  className="rounded border border-dashed border-line px-2 py-0.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink-soft"
                >
                  + New {group.label.toLowerCase().replace(/s$/, "")}
                </button>
              )}
            </p>
          ),
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
        <h2 className="mr-auto text-sm font-medium uppercase tracking-wide font-mono text-ink-faint">
          Actions · {actions.length}
        </h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ActionStatus | "")}
          className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
        >
          <option value="">Status: all</option>
          {ACTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
        >
          <option value="status">Sort: status</option>
          <option value="number">Sort: number</option>
          <option value="updated">Sort: recently updated</option>
        </select>
        {type === "arc" && (
          <button
            onClick={() => void copyArcBundleAsPrompt(id, resolved.name)}
            title="Copy a single prompt covering every open action in this arc, for handing to an agent"
            className="text-xs text-adobe hover:underline"
          >
            Copy arc as prompt →
          </button>
        )}
        <Link
          href={`/?${resolved.boardParam}&backlog=1`}
          className="text-xs text-adobe hover:underline"
        >
          Open on board →
        </Link>
      </div>

      <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-card">
        {actions.map((action) => (
          <ActionRow key={action.id} action={action} snapshot={snapshot} />
        ))}
        {actions.length === 0 && <li className="p-4 text-sm text-ink-faint">No actions here.</li>}
      </ul>
    </div>
  );
}

// On phones the row keeps only what matters most (PROG-99): the title gets the
// width; the key, estimate, and priority select wait for `sm:` — the tiny
// priority indicator and the status select (the core inline edit) stay.
function ActionRow({ action, snapshot }: { action: WireAction; snapshot: SnapshotPayload }) {
  return (
    <li data-action-id={action.id} className="flex items-center gap-3 px-3 py-2 text-sm">
      <Link
        href={`/action/${actionKeyOf(snapshot, action)}`}
        className="hidden w-20 shrink-0 font-mono text-xs text-ink-faint hover:text-ink-soft sm:block"
      >
        {actionKeyOf(snapshot, action)}
      </Link>
      <Link
        href={`/action/${actionKeyOf(snapshot, action)}`}
        className={`min-w-0 flex-1 truncate font-medium hover:text-adobe-deep ${closedTitleClass(
          action.status,
        )}`}
      >
        {action.title}
      </Link>
      {action.estimate !== null && (
        <span className="hidden rounded bg-line px-1 text-xs text-ink-soft sm:block">
          {action.estimate}
        </span>
      )}
      {/* Inline edits go through the same optimistic template as everywhere. */}
      <PriorityIndicator priority={action.priority} />
      <select
        value={action.priority}
        onChange={(e) => updateAction(action.id, { priority: e.target.value as ActionPriority })}
        className="hidden rounded border border-line bg-card px-1.5 py-0.5 text-xs text-ink-soft sm:block"
      >
        {ACTION_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <select
        value={action.status}
        onChange={(e) => updateAction(action.id, { status: e.target.value as ActionStatus })}
        className="rounded border border-line bg-card px-1.5 py-0.5 text-xs text-ink-soft"
      >
        {ACTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </li>
  );
}
