import { useEffect, useState } from "react";

// JSON-wire shapes of the workspace payload (timestamps arrive as ISO
// strings). Milestone 2's client store replaces these with shared types.
type User = { id: string; name: string; email: string };
type Initiative = { id: string; name: string };
type Product = { id: string; name: string; keyPrefix: string };
type Repo = { id: string; productId: string; name: string };
type Arc = { id: string; productId: string; name: string };
type Issue = {
  id: string;
  productId: string;
  repoId: string | null;
  arcId: string | null;
  number: number;
  title: string;
  status: string;
  priority: string;
  estimate: number | null;
};
type Tag = { id: string; name: string; color: string };
type IssueTag = { issueId: string; tagId: string };

type Workspace = {
  users: User[];
  initiatives: Initiative[];
  products: Product[];
  repos: Repo[];
  arcs: Arc[];
  issues: Issue[];
  tags: Tag[];
  issueTags: IssueTag[];
};

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; workspace: Workspace; ms: number };

const STATUS_ORDER = ["in_progress", "in_review", "todo", "backlog", "done", "canceled"];
const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export default function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    const start = performance.now();
    fetch("/api/workspace")
      .then((res) => {
        if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
        return res.json() as Promise<Workspace>;
      })
      .then((workspace) =>
        setState({
          phase: "ready",
          workspace,
          ms: Math.round(performance.now() - start),
        }),
      )
      .catch((err: unknown) =>
        setState({ phase: "error", message: String(err) }),
      );
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-2 text-stone-500">
          Full workspace load — every entity in one payload, rendered from memory.
        </p>

        {state.phase === "loading" && (
          <p className="mt-10 text-stone-400">Loading workspace…</p>
        )}

        {state.phase === "error" && (
          <p className="mt-10 text-red-600">{state.message}</p>
        )}

        {state.phase === "ready" && <WorkspaceView {...state} />}
      </main>
    </div>
  );
}

function WorkspaceView({ workspace, ms }: { workspace: Workspace; ms: number }) {
  const tagsByIssue = new Map<string, Tag[]>();
  for (const it of workspace.issueTags) {
    const tag = workspace.tags.find((t) => t.id === it.tagId);
    if (!tag) continue;
    const list = tagsByIssue.get(it.issueId) ?? [];
    list.push(tag);
    tagsByIssue.set(it.issueId, list);
  }
  const keyOf = (issue: Issue) => {
    const product = workspace.products.find((p) => p.id === issue.productId);
    return `${product?.keyPrefix ?? "?"}-${issue.number}`;
  };

  return (
    <>
      <p className="mt-4 text-sm text-stone-400">
        {workspace.initiatives.length} initiative · {workspace.products.length}{" "}
        product · {workspace.repos.length} repo · {workspace.arcs.length} arcs ·{" "}
        {workspace.issues.length} issues · {workspace.tags.length} tags — loaded
        from D1 in {ms} ms
      </p>

      {STATUS_ORDER.map((status) => {
        const group = workspace.issues
          .filter((i) => i.status === status)
          .sort((a, b) => a.number - b.number);
        if (group.length === 0) return null;
        return (
          <section
            key={status}
            className="mt-8 rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-medium uppercase tracking-wide text-stone-400">
              {STATUS_LABELS[status] ?? status} · {group.length}
            </h2>
            <ul className="mt-3 space-y-2">
              {group.map((issue) => (
                <li key={issue.id} className="flex items-baseline gap-3">
                  <span className="w-20 shrink-0 font-mono text-sm text-stone-400">
                    {keyOf(issue)}
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
