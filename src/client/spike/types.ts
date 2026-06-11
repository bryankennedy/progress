// Shared wire types + helpers for the client-store latency spike (open
// question #4). Spike-only code: the losing prototype and this scaffolding
// get deleted once D21 is recorded.

export const SPIKE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export type SpikeStatus = (typeof SPIKE_STATUSES)[number];

export type WireIssue = {
  id: string;
  productId: string;
  number: number;
  title: string;
  status: SpikeStatus;
  priority: string;
  estimate: number | null;
};

export type WireProduct = { id: string; name: string; keyPrefix: string };

export type WireWorkspace = {
  issues: WireIssue[];
  products: WireProduct[];
};

export function nextStatus(s: SpikeStatus): SpikeStatus {
  return SPIKE_STATUSES[(SPIKE_STATUSES.indexOf(s) + 1) % SPIKE_STATUSES.length]!;
}

export async function fetchWorkspace(): Promise<WireWorkspace> {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
  return res.json() as Promise<WireWorkspace>;
}

export async function patchStatus(id: string, status: SpikeStatus): Promise<boolean> {
  try {
    const res = await fetch(`/api/issues/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
