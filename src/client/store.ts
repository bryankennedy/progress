// The client store (D21): the whole workspace lives in one TanStack Query
// cache entry, loaded once and rendered from memory (SPEC §8.2). Components
// subscribe to slices via `useWorkspaceSlice`; structural sharing keeps
// unchanged slices reference-stable so re-renders stay scoped. Per-issue
// timelines (comments + activity) are separate queries (D20).

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { IssuePriority, IssueStatus } from "../shared/constants";
import type {
  WireActivity,
  WireComment,
  WireIssue,
  WorkspacePayload,
} from "../shared/types";
import { toast } from "./toast";

export const queryClient = new QueryClient({
  defaultOptions: {
    // Nothing goes stale on its own: this client is the only writer
    // (single-user v1), so background refetching is pure churn. Mutations
    // invalidate exactly what they touched.
    queries: { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
  },
});

const WS_KEY = ["workspace"] as const;
const timelineKey = (issueId: string) => ["issue", issueId, "timeline"] as const;

// Initial app load is the one permitted loading state; surface its cost.
export const loadStats = { fetchMs: 0 };

async function fetchWorkspace(): Promise<WorkspacePayload> {
  const t0 = performance.now();
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
  const ws = (await res.json()) as WorkspacePayload;
  loadStats.fetchMs = performance.now() - t0;
  return ws;
}

export function useWorkspace() {
  return useQuery({ queryKey: WS_KEY, queryFn: fetchWorkspace });
}

export function useWorkspaceSlice<T>(select: (ws: WorkspacePayload) => T): T | undefined {
  return useQuery({ queryKey: WS_KEY, queryFn: fetchWorkspace, select }).data;
}

// ---------- issue keys ----------

export function issueKeyOf(ws: WorkspacePayload, issue: WireIssue): string {
  const prefix = ws.products.find((p) => p.id === issue.productId)?.keyPrefix ?? "?";
  return `${prefix}-${issue.number}`;
}

// Resolves "PROG-123" to an issue: current keys first, then the permanent
// aliases left behind by cross-product moves (SPEC §3). Returns the issue and
// whether it was reached via an alias (callers redirect to the canonical key).
export function findIssueByKey(
  ws: WorkspacePayload,
  key: string,
): { issue: WireIssue; viaAlias: boolean } | undefined {
  const match = /^([A-Za-z]+)-(\d+)$/.exec(key.trim());
  if (match) {
    const prefix = match[1]!.toUpperCase();
    const number = Number(match[2]!);
    const product = ws.products.find((p) => p.keyPrefix.toUpperCase() === prefix);
    const issue =
      product && ws.issues.find((i) => i.productId === product.id && i.number === number);
    if (issue) return { issue, viaAlias: false };
  }
  const alias = ws.issueKeyAliases.find((a) => a.key.toUpperCase() === key.trim().toUpperCase());
  const aliased = alias && ws.issues.find((i) => i.id === alias.issueId);
  return aliased ? { issue: aliased, viaAlias: true } : undefined;
}

// ---------- issue mutations ----------

function getIssue(id: string): WireIssue | undefined {
  return queryClient.getQueryData<WorkspacePayload>(WS_KEY)?.issues.find((i) => i.id === id);
}

function writeIssue(id: string, write: (issue: WireIssue) => WireIssue) {
  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (ws) =>
    ws ? { ...ws, issues: ws.issues.map((i) => (i.id === id ? write(i) : i)) } : ws,
  );
}

// The optimistic-mutation template (SPEC §8.2): write the store
// synchronously, sync to the server in the background, and on failure restore
// the issue's pre-mutation snapshot and raise a toast. Rollback is per-issue
// (a failure never clobbers other issues' optimistic writes); overlapping
// mutations to the SAME issue can over-rollback, acceptable at single-user
// rates.
async function optimisticIssueMutation(
  id: string,
  patch: Partial<WireIssue>,
  send: () => Promise<Response>,
) {
  const before = getIssue(id);
  if (!before) return;
  writeIssue(id, (issue) => ({ ...issue, ...patch }));
  let ok = false;
  try {
    ok = (await send()).ok;
  } catch {
    ok = false;
  }
  if (!ok) {
    writeIssue(id, () => before);
    toast("Couldn't save that change — reverted.");
  } else if (patch.status !== undefined) {
    // The server appended a status_changed activity event; refresh the
    // timeline if this issue's page has loaded it.
    void queryClient.invalidateQueries({ queryKey: timelineKey(id) });
  }
}

export type IssuePatch = Partial<{
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
}>;

export function updateIssue(id: string, patch: IssuePatch) {
  const now = new Date().toISOString();
  // Mirrors the server's PATCH semantics so the optimistic state matches
  // what a reload would fetch.
  const optimistic: Partial<WireIssue> = { ...patch, updatedAt: now };
  if (patch.status !== undefined) {
    optimistic.completedAt = patch.status === "done" ? now : null;
  }
  void optimisticIssueMutation(id, optimistic, () =>
    fetch(`/api/issues/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export function setIssueStatus(id: string, status: IssueStatus) {
  updateIssue(id, { status });
}

// ---------- per-issue timeline ----------

export type Timeline = { comments: WireComment[]; activity: WireActivity[] };

export function useTimeline(issueId: string) {
  return useQuery({
    queryKey: timelineKey(issueId),
    queryFn: async (): Promise<Timeline> => {
      const res = await fetch(`/api/issues/${issueId}/timeline`);
      if (!res.ok) throw new Error(`timeline load failed: HTTP ${res.status}`);
      return res.json() as Promise<Timeline>;
    },
  });
}

export function addComment(issueId: string, body: string) {
  // Same optimistic shape as issue mutations: a temp comment appears
  // instantly and is replaced by the server row (or removed + toast).
  const temp: WireComment = {
    id: `cmt_optimistic_${Date.now()}`,
    issueId,
    authorId: "usr_owner",
    body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  queryClient.setQueryData<Timeline>(timelineKey(issueId), (t) =>
    t ? { ...t, comments: [...t.comments, temp] } : t,
  );
  void (async () => {
    let ok = false;
    try {
      ok = (
        await fetch(`/api/issues/${issueId}/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        })
      ).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      void queryClient.invalidateQueries({ queryKey: timelineKey(issueId) });
    } else {
      queryClient.setQueryData<Timeline>(timelineKey(issueId), (t) =>
        t ? { ...t, comments: t.comments.filter((cm) => cm.id !== temp.id) } : t,
      );
      toast("Couldn't post that comment — removed.");
    }
  })();
}
