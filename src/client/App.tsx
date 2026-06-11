import { useMemo } from "react";
import { ISSUE_STATUSES, type IssueStatus } from "../shared/constants";
import type { WireIssue, WorkspacePayload } from "../shared/types";
import { loadStats, setIssueStatus, useWorkspace } from "./store";
import { Toasts } from "./toast";

const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

// Demo interaction until the real board lands (milestone 3): clicking an
// issue cycles its status through the optimistic-mutation template.
function nextStatus(s: IssueStatus): IssueStatus {
  return ISSUE_STATUSES[(ISSUE_STATUSES.indexOf(s) + 1) % ISSUE_STATUSES.length]!;
}

export default function App() {
  const { data: workspace, isPending, error } = useWorkspace();

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-2 text-stone-500">
          Workspace store — loaded once, rendered from memory, optimistic mutations.
        </p>

        {/* Initial app load: the only permitted loading state (SPEC §8.2). */}
        {isPending && <p className="mt-10 text-stone-400">Loading workspace…</p>}
        {error && <p className="mt-10 text-red-600">{String(error)}</p>}
        {workspace && <WorkspaceView workspace={workspace} />}
      </main>
      <Toasts />
    </div>
  );
}

function WorkspaceView({ workspace }: { workspace: WorkspacePayload }) {
  const prefixById = useMemo(
    () => new Map(workspace.products.map((p) => [p.id, p.keyPrefix])),
    [workspace.products],
  );
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
      <p className="mt-4 text-sm text-stone-400">
        {workspace.initiatives.length} initiatives · {workspace.products.length} products ·{" "}
        {workspace.repos.length} repos · {workspace.arcs.length} arcs ·{" "}
        {workspace.issues.length} issues · {workspace.tags.length} tags — loaded in{" "}
        {Math.round(loadStats.fetchMs)} ms · click an issue to cycle its status
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
            <ul className="mt-3 space-y-2">
              {group.map((issue) => (
                <li
                  key={issue.id}
                  data-issue-id={issue.id}
                  onClick={() => setIssueStatus(issue.id, nextStatus(issue.status))}
                  className="flex cursor-pointer items-baseline gap-3 rounded px-1 hover:bg-stone-50"
                >
                  <span className="w-20 shrink-0 font-mono text-sm text-stone-400">
                    {prefixById.get(issue.productId) ?? "?"}-{issue.number}
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
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
