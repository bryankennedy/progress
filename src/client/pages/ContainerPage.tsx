// Container pages (SPEC §4): every initiative, product, repo, and arc gets a
// page — description on top (open-page feel), issue list below with inline
// status/priority edits. One component covers all four types; they differ
// only in how their issue scope and child links derive from the workspace.

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { Link } from "wouter";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { PRIORITY_LABELS as SHARED_PRIORITY_LABELS, STATUS_LABELS } from "../labels";
import { issueKeyOf, updateIssue } from "../store";

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

type Resolved = {
  name: string;
  description: string;
  archivedAt: string | null;
  issues: WireIssue[];
  children: { label: string; items: { href: string; name: string }[] }[];
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
            items: products.map((p) => ({ href: `/product/${p.id}`, name: p.name })),
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
              .map((r) => ({ href: `/repo/${r.id}`, name: r.name })),
          },
          {
            label: "Arcs",
            items: ws.arcs
              .filter((a) => a.productId === id)
              .map((a) => ({ href: `/arc/${a.id}`, name: a.name })),
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

  if (!resolved) {
    return (
      <p className="text-stone-500">
        No {TYPE_LABELS[type].toLowerCase()} with id <span className="font-mono">{id}</span>.{" "}
        <Link href="/" className="text-sky-600 hover:underline">
          Back to the board
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="text-sm text-stone-400">
        <Link href="/" className="hover:text-stone-600">
          Workspace
        </Link>{" "}
        / {TYPE_LABELS[type]}
      </nav>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {resolved.name}
          {resolved.archivedAt && (
            <span className="ml-3 align-middle text-xs uppercase tracking-wide text-stone-400">
              archived
            </span>
          )}
        </h1>
        {resolved.description !== "" && (
          <div className="prose-lite mt-3 max-w-2xl text-stone-600">
            <Markdown>{resolved.description}</Markdown>
          </div>
        )}
      </header>

      {resolved.children.map(
        (group) =>
          group.items.length > 0 && (
            <p key={group.label} className="mt-4 flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-xs uppercase tracking-wide text-stone-400">{group.label}</span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 hover:border-stone-400"
                >
                  {item.name}
                </Link>
              ))}
            </p>
          ),
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
        <h2 className="mr-auto text-sm font-medium uppercase tracking-wide text-stone-400">
          Issues · {issues.length}
        </h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as IssueStatus | "")}
          className="rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500"
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
          className="rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-500"
        >
          <option value="status">Sort: status</option>
          <option value="number">Sort: number</option>
          <option value="updated">Sort: recently updated</option>
        </select>
        <Link
          href={`/?${resolved.boardParam}&backlog=1`}
          className="text-xs text-sky-600 hover:underline"
        >
          Open on board →
        </Link>
      </div>

      <ul className="mt-3 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} workspace={workspace} />
        ))}
        {issues.length === 0 && (
          <li className="p-4 text-sm text-stone-400">No issues here.</li>
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
        className="w-20 shrink-0 font-mono text-xs text-stone-400 hover:text-stone-600"
      >
        {issueKeyOf(workspace, issue)}
      </Link>
      <Link
        href={`/issue/${issueKeyOf(workspace, issue)}`}
        className="min-w-0 flex-1 truncate font-medium hover:text-sky-700"
      >
        {issue.title}
      </Link>
      {issue.estimate !== null && (
        <span className="rounded bg-stone-100 px-1 text-xs text-stone-500">{issue.estimate}</span>
      )}
      {/* Inline edits go through the same optimistic template as everywhere. */}
      <select
        value={issue.priority}
        onChange={(e) => updateIssue(issue.id, { priority: e.target.value as IssuePriority })}
        className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-xs text-stone-500"
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
        className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-xs text-stone-500"
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
