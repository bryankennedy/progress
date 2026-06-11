// The client store (D21): the whole workspace lives in one TanStack Query
// cache entry, loaded once and rendered from memory (SPEC §8.2). Components
// subscribe to slices via `useWorkspaceSlice`; structural sharing keeps
// unchanged slices reference-stable so re-renders stay scoped.

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { IssueStatus } from "../shared/constants";
import type { WireIssue, WorkspacePayload } from "../shared/types";
import { toast } from "./toast";

export const queryClient = new QueryClient({
  defaultOptions: {
    // The workspace never goes stale on its own: this client is the only
    // writer (single-user v1), so background refetching is pure churn.
    queries: { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
  },
});

const WS_KEY = ["workspace"] as const;

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
// rates. Every future mutation (priority, estimate, moves, …) follows this
// shape.
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
  }
}

export function setIssueStatus(id: string, status: IssueStatus) {
  const now = new Date().toISOString();
  // Mirrors the server's PATCH semantics so the optimistic state matches
  // what a reload would fetch.
  void optimisticIssueMutation(
    id,
    { status, updatedAt: now, completedAt: status === "done" ? now : null },
    () =>
      fetch(`/api/issues/${id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
  );
}
