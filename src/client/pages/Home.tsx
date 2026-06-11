import { useMemo } from "react";
import { Link } from "wouter";
import { ISSUE_STATUSES, type IssueStatus } from "../../shared/constants";
import type { WireIssue, WorkspacePayload } from "../../shared/types";
import { loadStats, issueKeyOf } from "../store";

const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

// Interim home: status-grouped issue list. Replaced by the global "My Work"
// board later in milestone 3.
export default function Home({ workspace }: { workspace: WorkspacePayload }) {
  const tagsByIssue = useMemo(() => {
    const tagById = new Map(workspace.tags.map((t) => [t.id, t]));
    const map = new Map<string, { id: string; name: string; color: string }[]>();
    for (const link of workspace.issueTags) {
      const tag = tagById.get(link.tagId);
      if (!tag) continue;
      const list = map.get(link.issueId) ?? [];
      list.push(tag);
      map.set(link.issueId, list);
    }
    return map;
  }, [workspace.tags, workspace.issueTags]);

  const byStatus = useMemo(() => {
    const groups = new Map<IssueStatus, WireIssue[]>(ISSUE_STATUSES.map((s) => [s, []]));
    for (const issue of workspace.issues) groups.get(issue.status)!.push(issue);
    for (const group of groups.values()) group.sort((a, b) => a.number - b.number);
    return groups;
  }, [workspace.issues]);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
      <p className="mt-4 text-sm text-stone-400">
        {workspace.initiatives.length} initiatives · {workspace.products.length} products ·{" "}
        {workspace.repos.length} repos · {workspace.arcs.length} arcs ·{" "}
        {workspace.issues.length} issues · {workspace.tags.length} tags — loaded in{" "}
        {Math.round(loadStats.fetchMs)} ms
      </p>

      {ISSUE_STATUSES.map((status) => {
        const group = byStatus.get(status)!;
        if (group.length === 0) return null;
        return (
          <section
            key={status}
            className="mt-8 rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">
              {STATUS_LABELS[status]} · {group.length}
            </h2>
            <ul className="mt-3 space-y-1">
              {group.map((issue) => {
                const issueKey = issueKeyOf(workspace, issue);
                return (
                  <li key={issue.id} data-issue-id={issue.id}>
                    <Link
                      href={`/issue/${issueKey}`}
                      className="flex items-baseline gap-3 rounded px-1 py-0.5 hover:bg-stone-50"
                    >
                      <span className="w-20 shrink-0 font-mono text-sm text-stone-400">
                        {issueKey}
                      </span>
                      <span className="font-medium">{issue.title}</span>
                      {(tagsByIssue.get(issue.id) ?? []).map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full px-2 py-0.5 text-xs text-white"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
