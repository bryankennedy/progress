// Container pages (SPEC §4): every initiative, product, repo, and arc gets a
// page — description on top (open-page feel), issue list below with inline
// status/priority edits. One component covers all four types; they differ
// only in how their issue scope and child links derive from the workspace.

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { openCreateContainer } from "../commands/controller";
import EditableMarkdown from "../EditableMarkdown";
import InlineEdit from "../InlineEdit";
import { PRIORITY_LABELS as SHARED_PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import PriorityIndicator from "../PriorityIndicator";
import { issueKeyOf, updateContainer, updateIssue } from "../store";
import { copyArcBundleAsPrompt, prefetchArcBundle } from "../workOn";

export type ContainerType = "initiative" | "product" | "repo" | "arc";

const TYPE_LABELS: Record<ContainerType, string> = {
  initiative: "Initiative",
  product: "Product",
  repo: "Repo",
  arc: "Arc",
};
// Compact "none" for the narrow inline row selects.
const PRIORITY_LABELS: Record<IssuePriority, string> = {
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
  issues: WireIssue[];
  children: ChildGroup[];
  boardParam: string;
};

function resolve(ws: WorkspacePayload, type: ContainerType, id: string): Resolved | undefined {
  switch (type) {
    case "initiative": {
      const initiative = ws.initiatives.find((i) => i.id === id);
      if (!initiative) return undefined;
      const products = ws.products.filter((p) => p.initiativeId === id);
      const productIds = new Set(products.map((p) => p.id));
      return {
        ...initiative,
        issues: ws.issues.filter((i) => productIds.has(i.productId)),
        children: [
          {
            label: "Products",
            items: products.map((p) => ({
              href: `/product/${p.id}`,
              name: p.name,
              archived: p.archivedAt !== null,
            })),
            onNew: () => openCreateContainer({ kind: "product", initiativeId: id }),
          },
        ],
        boardParam: `initiative=${id}`,
      };
    }
    case "product": {
      const product = ws.products.find((p) => p.id === id);
      if (!product) return undefined;
      return {
        ...product,
        issues: ws.issues.filter((i) => i.productId === id),
        children: [
          {
            label: "Repos",
            items: ws.repos
              .filter((r) => r.productId === id)
              .map((r) => ({
                href: `/repo/${r.id}`,
                name: r.name,
                archived: r.archivedAt !== null,
              })),
            onNew: () => openCreateContainer({ kind: "repo", productId: id }),
          },
          {
            label: "Arcs",
            items: ws.arcs
              .filter((a) => a.productId === id)
              .map((a) => ({
                href: `/arc/${a.id}`,
                name: a.name,
                archived: a.archivedAt !== null,
              })),
            onNew: () => openCreateContainer({ kind: "arc", productId: id }),
          },
        ],
        boardParam: `product=${id}`,
      };
    }
    case "repo": {
      const repo = ws.repos.find((r) => r.id === id);
      if (!repo) return undefined;
      return {
        ...repo,
        issues: ws.issues.filter((i) => i.repoId === id),
        children: [],
        boardParam: `product=${repo.productId}&repo=${id}`,
      };
    }
    case "arc": {
      const arc = ws.arcs.find((a) => a.id === id);
      if (!arc) return undefined;
      return {
        ...arc,
        issues: ws.issues.filter((i) => i.arcId === id),
        children: [],
        boardParam: `product=${arc.productId}&arc=${id}`,
      };
    }
  }
}

type SortMode = "status" | "number" | "updated";
const STATUS_ORDER = new Map(ISSUE_STATUSES.map((s, i) => [s, i]));

export default function ContainerPage({
  workspace,
  type,
  id,
}: {
  workspace: WorkspacePayload;
  type: ContainerType;
  id: string;
}) {
  const [sort, setSort] = useState<SortMode>("status");
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "">("");

  const resolved = useMemo(() => resolve(workspace, type, id), [workspace, type, id]);

  const issues = useMemo(() => {
    if (!resolved) return [];
    const list = resolved.issues.filter((i) => !statusFilter || i.status === statusFilter);
    return list.sort((a, b) => {
      if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "status")
        return (
          STATUS_ORDER.get(a.status)! - STATUS_ORDER.get(b.status)! || a.number - b.number
        );
      return a.number - b.number;
    });
  }, [resolved, sort, statusFilter]);

  // Warm the arc work-order cache on mount and whenever this arc's issues
  // change, so "Copy arc as prompt" copies instantly with the latest state.
  useEffect(() => {
    if (type === "arc") prefetchArcBundle(id);
  }, [type, id, resolved?.issues]);

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
      <nav className="text-sm text-ink-faint">
        <Link href="/" className="hover:text-ink-soft">
          Workspace
        </Link>{" "}
        / {TYPE_LABELS[type]}
      </nav>

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
            <span className="mt-2 text-xs uppercase tracking-wide font-mono text-ink-faint">archived</span>
          )}
          <button
            onClick={() => updateContainer(type, id, { archived: !resolved.archivedAt })}
            className="mt-1.5 shrink-0 rounded border border-line bg-card px-2 py-0.5 text-xs text-ink-soft hover:border-ink-faint"
          >
            {resolved.archivedAt ? "Unarchive" : "Archive"}
          </button>
        </div>
        {type === "product" && (
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
        {type === "repo" && (
          <p className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
            Git URL
            <InlineEdit
              value={resolved.gitUrl ?? ""}
              onSave={(gitUrl) => updateContainer(type, id, { gitUrl: gitUrl || null })}
              placeholder="none — set it to enable PR/commit linking"
              className="font-mono text-ink-soft"
              inputClassName="w-80 max-w-full font-mono text-xs"
            />
          </p>
        )}
        <div className="mt-3 max-w-2xl text-ink-soft">
          <EditableMarkdown
            value={resolved.description}
            placeholder="Add a description…"
            draftScope={{ meId: workspace.me?.id ?? "anon", targetId: id }}
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
              <span className="text-xs uppercase tracking-wide font-mono text-ink-faint">{group.label}</span>
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
          Issues · {issues.length}
        </h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as IssueStatus | "")}
          className="rounded border border-line bg-card px-2 py-1 text-xs text-ink-soft"
        >
          <option value="">Status: all</option>
          {ISSUE_STATUSES.map((s) => (
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
            title="Copy a single prompt covering every open issue in this arc, for handing to an agent"
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
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} workspace={workspace} />
        ))}
        {issues.length === 0 && (
          <li className="p-4 text-sm text-ink-faint">No issues here.</li>
        )}
      </ul>
    </div>
  );
}

function IssueRow({ issue, workspace }: { issue: WireIssue; workspace: WorkspacePayload }) {
  return (
    <li data-issue-id={issue.id} className="flex items-center gap-3 px-3 py-2 text-sm">
      <Link
        href={`/issue/${issueKeyOf(workspace, issue)}`}
        className="w-20 shrink-0 font-mono text-xs text-ink-faint hover:text-ink-soft"
      >
        {issueKeyOf(workspace, issue)}
      </Link>
      <Link
        href={`/issue/${issueKeyOf(workspace, issue)}`}
        className="min-w-0 flex-1 truncate font-medium hover:text-adobe-deep"
      >
        {issue.title}
      </Link>
      {issue.estimate !== null && (
        <span className="rounded bg-line px-1 text-xs text-ink-soft">{issue.estimate}</span>
      )}
      {/* Inline edits go through the same optimistic template as everywhere. */}
      <PriorityIndicator priority={issue.priority} />
      <select
        value={issue.priority}
        onChange={(e) => updateIssue(issue.id, { priority: e.target.value as IssuePriority })}
        className="rounded border border-line bg-card px-1.5 py-0.5 text-xs text-ink-soft"
      >
        {ISSUE_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <select
        value={issue.status}
        onChange={(e) => updateIssue(issue.id, { status: e.target.value as IssueStatus })}
        className="rounded border border-line bg-card px-1.5 py-0.5 text-xs text-ink-soft"
      >
        {ISSUE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </li>
  );
}
