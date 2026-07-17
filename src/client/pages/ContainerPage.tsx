// Container pages (SPEC §4): every workspace, focus, and arc gets a page —
// description on top (open-page feel), action list below with inline
// status/priority edits. One component covers all three types; they differ
// only in how their action scope and child links derive from the snapshot.
// A focus additionally edits its key prefix and optional git repo (PROG-102).

import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import type { WireAction, SnapshotPayload } from "../../shared/types";
import ActionListView from "../ActionListView";
import { openCreateContainer } from "../commands/controller";
import Breadcrumb from "../Breadcrumb";
import { sortContainers } from "../containerReorder";
import EditableMarkdown from "../EditableMarkdown";
import InlineEdit from "../InlineEdit";
import { updateContainer } from "../store";
import { copyArcBundleAsPrompt, prefetchArcBundle } from "../workOn";

export type ContainerType = "workspace" | "focus" | "arc";

const TYPE_LABELS: Record<ContainerType, string> = {
  workspace: "Workspace",
  focus: "Focus",
  arc: "Arc",
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

export default function ContainerPage({
  snapshot,
  type,
  id,
}: {
  snapshot: SnapshotPayload;
  type: ContainerType;
  id: string;
}) {
  const resolved = useMemo(() => resolve(snapshot, type, id), [snapshot, type, id]);

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

      {/* The shared outline/table action list (PROG-126): outline mode is the
          real OutlineView scoped to this container; table mode is the search
          page's sortable table (rank order by default) with a quick search.
          Hide-done and the mode itself are sticky preferences. */}
      <div className="mt-8">
        <ActionListView
          snapshot={snapshot}
          scope={{ kind: type, id }}
          actions={resolved.actions}
          surface="container"
          toolbarExtras={
            <>
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
            </>
          }
        />
      </div>
    </div>
  );
}
