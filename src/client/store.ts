// The client store (D21): the whole workspace lives in one TanStack Query
// cache entry, loaded once and rendered from memory (SPEC §8.2). Components
// subscribe to slices via `useWorkspaceSlice`; structural sharing keeps
// unchanged slices reference-stable so re-renders stay scoped. Per-issue
// timelines (comments + activity) are separate queries (D20).

import { QueryClient, useQuery } from "@tanstack/react-query";
import { tagColor, type IssuePriority, type IssueStatus } from "../shared/constants";
import type {
  WireActivity,
  WireArc,
  WireComment,
  WireCommitLink,
  WireInitiative,
  WireIssue,
  WirePrLink,
  WireProduct,
  WireRepo,
  WireTag,
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
  arcId: string | null;
  dueDate: string | null;
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

// ---------- issue creation ----------

export type IssueCreateInput = {
  title: string;
  productId: string;
  repoId: string | null;
  arcId: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
  dueDate: string | null;
};

// Optimistic create: the issue number is allocated locally from the
// product's nextIssueNumber mirror — safe because this client is the only
// writer (single-user v1) — so the new key is correct immediately and
// callers can navigate to it without waiting. The temp row is replaced by
// the server row on success (same key, real id) or removed with a toast on
// failure. Returns the new issue's key, or undefined if the product is gone.
export function createIssue(input: IssueCreateInput): string | undefined {
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  const product = ws?.products.find((p) => p.id === input.productId);
  if (!ws || !product) return undefined;

  const tempId = `iss_optimistic_${Date.now()}`;
  const now = new Date().toISOString();
  const temp: WireIssue = {
    id: tempId,
    productId: input.productId,
    repoId: input.repoId,
    arcId: input.arcId,
    number: product.nextIssueNumber,
    title: input.title,
    description: "",
    status: input.status,
    priority: input.priority,
    estimate: input.estimate,
    dueDate: input.dueDate,
    creatorId: "usr_owner",
    assigneeId: "usr_owner",
    createdAt: now,
    updatedAt: now,
    completedAt: input.status === "done" ? now : null,
  };
  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
    w
      ? {
          ...w,
          issues: [...w.issues, temp],
          products: w.products.map((p) =>
            p.id === product.id ? { ...p, nextIssueNumber: p.nextIssueNumber + 1 } : p,
          ),
        }
      : w,
  );

  void (async () => {
    let serverIssue: WireIssue | undefined;
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) serverIssue = ((await res.json()) as { issue: WireIssue }).issue;
    } catch {
      // handled below
    }
    queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) => {
      if (!w) return w;
      if (serverIssue) {
        const real = serverIssue;
        return { ...w, issues: w.issues.map((i) => (i.id === tempId ? real : i)) };
      }
      // Failure: remove the temp issue and put the allocated number back.
      return {
        ...w,
        issues: w.issues.filter((i) => i.id !== tempId),
        products: w.products.map((p) =>
          p.id === product.id ? { ...p, nextIssueNumber: p.nextIssueNumber - 1 } : p,
        ),
      };
    });
    if (!serverIssue) toast("Couldn't create that issue — removed.");
  })();

  return `${product.keyPrefix}-${temp.number}`;
}

// ---------- issue movement ----------

export type MoveTarget = { productId: string; repoId: string | null };

// Optimistic move (SPEC §3): within a product it's a one-field container
// change; across products the issue is re-keyed from the target's sequence,
// its arc is cleared, and the old key is appended to the alias list — all
// locally first, so the board and any open issue page (which redirects via
// the alias) update instantly. Rollback restores exactly what this move
// touched.
export function moveIssue(id: string, target: MoveTarget) {
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  const before = ws?.issues.find((i) => i.id === id);
  const targetProduct = ws?.products.find((p) => p.id === target.productId);
  if (!ws || !before || !targetProduct) return;
  if (before.productId === target.productId && before.repoId === target.repoId) return;

  const crossProduct = before.productId !== target.productId;
  const now = new Date().toISOString();
  const oldKey = issueKeyOf(ws, before);

  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) => {
    if (!w) return w;
    if (!crossProduct) {
      return {
        ...w,
        issues: w.issues.map((i) =>
          i.id === id ? { ...i, repoId: target.repoId, updatedAt: now } : i,
        ),
      };
    }
    return {
      ...w,
      issues: w.issues.map((i) =>
        i.id === id
          ? {
              ...i,
              productId: target.productId,
              repoId: target.repoId,
              arcId: null,
              number: targetProduct.nextIssueNumber,
              updatedAt: now,
            }
          : i,
      ),
      products: w.products.map((p) =>
        p.id === target.productId ? { ...p, nextIssueNumber: p.nextIssueNumber + 1 } : p,
      ),
      issueKeyAliases: [...w.issueKeyAliases, { key: oldKey, issueId: id, createdAt: now }],
    };
  });

  void (async () => {
    let serverIssue: WireIssue | undefined;
    try {
      const res = await fetch(`/api/issues/${id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      if (res.ok) serverIssue = ((await res.json()) as { issue: WireIssue }).issue;
    } catch {
      // handled below
    }
    if (serverIssue) {
      const real = serverIssue;
      writeIssue(id, () => real);
      // The server appended a "moved" activity event.
      void queryClient.invalidateQueries({ queryKey: timelineKey(id) });
      return;
    }
    queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) => {
      if (!w) return w;
      const restored = { ...w, issues: w.issues.map((i) => (i.id === id ? before : i)) };
      if (!crossProduct) return restored;
      return {
        ...restored,
        products: restored.products.map((p) =>
          p.id === target.productId ? { ...p, nextIssueNumber: p.nextIssueNumber - 1 } : p,
        ),
        issueKeyAliases: restored.issueKeyAliases.filter(
          (a) => !(a.key === oldKey && a.issueId === id),
        ),
      };
    });
    toast("Couldn't move that issue — reverted.");
  })();
}

// ---------- containers (D26) ----------

export type ContainerKind = "initiative" | "product" | "repo" | "arc";

export const CONTAINER_COLLECTIONS = {
  initiative: "initiatives",
  product: "products",
  repo: "repos",
  arc: "arcs",
} as const;
type ContainerCollection = (typeof CONTAINER_COLLECTIONS)[ContainerKind];

const CONTAINER_ID_PREFIXES: Record<ContainerKind, string> = {
  initiative: "ini",
  product: "prd",
  repo: "rep",
  arc: "arc",
};

type WireContainer = WireInitiative | WireProduct | WireRepo | WireArc;

// The four container collections have distinct element types; TS can't relate
// a union-typed key to its value type on write, so this helper centralizes
// the (runtime-safe) casts.
function writeContainers(key: ContainerCollection, fn: (list: WireContainer[]) => WireContainer[]) {
  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (ws) =>
    ws ? ({ ...ws, [key]: fn(ws[key] as WireContainer[]) } as WorkspacePayload) : ws,
  );
}

export type ContainerCreateInput =
  | { kind: "initiative"; name: string }
  | { kind: "product"; name: string; initiativeId: string; keyPrefix: string }
  | { kind: "repo"; name: string; productId: string; gitUrl?: string | null }
  | { kind: "arc"; name: string; productId: string };

// Optimistic container create. The id is client-generated (container pages
// are id-addressed, so navigation must not depend on a server round trip);
// the server accepts it verbatim (D26). Returns the new container's id.
export function createContainer(input: ContainerCreateInput): string {
  const id = `${CONTAINER_ID_PREFIXES[input.kind]}_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  const base = {
    id,
    name: input.name.trim(),
    description: "",
    archivedAt: null,
    creatorId: "usr_owner",
    createdAt: now,
    updatedAt: now,
  };
  const temp: WireContainer =
    input.kind === "initiative"
      ? base
      : input.kind === "product"
        ? { ...base, initiativeId: input.initiativeId, keyPrefix: input.keyPrefix.toUpperCase(), nextIssueNumber: 1 }
        : input.kind === "repo"
          ? { ...base, productId: input.productId, gitUrl: input.gitUrl ?? null }
          : { ...base, productId: input.productId };
  const collection = CONTAINER_COLLECTIONS[input.kind];
  writeContainers(collection, (list) => [...list, temp]);

  void (async () => {
    let server: WireContainer | undefined;
    let message = "";
    try {
      const res = await fetch(`/api/${collection}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, id }),
      });
      if (res.ok) {
        server = ((await res.json()) as { container: WireContainer }).container;
      } else {
        message = ((await res.json()) as { error?: string }).error ?? "";
      }
    } catch {
      // handled below
    }
    if (server) {
      const real = server;
      writeContainers(collection, (list) => list.map((x) => (x.id === id ? real : x)));
    } else {
      writeContainers(collection, (list) => list.filter((x) => x.id !== id));
      toast(`Couldn't create that ${input.kind} — removed.${message ? ` (${message})` : ""}`);
    }
  })();

  return id;
}

export type ContainerPatch = Partial<{
  name: string;
  description: string;
  archived: boolean;
  keyPrefix: string;
  gitUrl: string | null;
}>;

export function updateContainer(kind: ContainerKind, id: string, patch: ContainerPatch) {
  const collection = CONTAINER_COLLECTIONS[kind];
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  const before = (ws?.[collection] as WireContainer[] | undefined)?.find((x) => x.id === id);
  if (!before) return;

  const now = new Date().toISOString();
  // Mirror the server's PATCH semantics (archived boolean → archivedAt).
  const optimistic: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) optimistic.name = patch.name.trim();
  if (patch.description !== undefined) optimistic.description = patch.description;
  if (patch.archived !== undefined) optimistic.archivedAt = patch.archived ? now : null;
  if (patch.keyPrefix !== undefined) optimistic.keyPrefix = patch.keyPrefix.toUpperCase();
  if (patch.gitUrl !== undefined) optimistic.gitUrl = patch.gitUrl;
  writeContainers(collection, (list) =>
    list.map((x) => (x.id === id ? ({ ...x, ...optimistic } as WireContainer) : x)),
  );

  void (async () => {
    let ok = false;
    let message = "";
    try {
      const res = await fetch(`/api/${collection}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      ok = res.ok;
      if (!ok) message = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // handled below
    }
    if (!ok) {
      writeContainers(collection, (list) => list.map((x) => (x.id === id ? before : x)));
      toast(`Couldn't save that change — reverted.${message ? ` (${message})` : ""}`);
    }
  })();
}

// ---------- tags (D27) ----------

// Assign a tag — an existing one by id, or by name (creating it on the fly
// with the shared auto-color, so the optimistic row matches the server's).
export function tagIssue(issueId: string, tag: { tagId: string } | { name: string }) {
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  if (!ws) return;

  let tagId: string;
  let createdTemp: WireTag | undefined;
  if ("tagId" in tag) {
    tagId = tag.tagId;
  } else {
    const name = tag.name.trim();
    if (name === "") return;
    const existing = ws.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      tagId = existing.id;
    } else {
      tagId = `tag_${crypto.randomUUID().replaceAll("-", "")}`;
      createdTemp = { id: tagId, name, color: tagColor(name), createdAt: new Date().toISOString() };
    }
  }
  if (ws.issueTags.some((l) => l.issueId === issueId && l.tagId === tagId)) return;

  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
    w
      ? {
          ...w,
          tags: createdTemp ? [...w.tags, createdTemp] : w.tags,
          issueTags: [...w.issueTags, { issueId, tagId }],
        }
      : w,
  );

  void (async () => {
    let serverTag: WireTag | undefined;
    try {
      const res = await fetch(`/api/issues/${issueId}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("tagId" in tag ? { tagId } : { name: tag.name.trim(), id: tagId }),
      });
      if (res.ok) serverTag = ((await res.json()) as { tag: WireTag }).tag;
    } catch {
      // handled below
    }
    if (serverTag) {
      const real = serverTag;
      // The server may resolve a created-by-name tag to a pre-existing row
      // (exact-name match); point the link at the authoritative id.
      queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
        w
          ? {
              ...w,
              tags: [...w.tags.filter((t) => t.id !== tagId && t.id !== real.id), real],
              issueTags: w.issueTags.map((l) =>
                l.issueId === issueId && l.tagId === tagId ? { ...l, tagId: real.id } : l,
              ),
            }
          : w,
      );
    } else {
      queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
        w
          ? {
              ...w,
              tags: createdTemp ? w.tags.filter((t) => t.id !== tagId) : w.tags,
              issueTags: w.issueTags.filter((l) => !(l.issueId === issueId && l.tagId === tagId)),
            }
          : w,
      );
      toast("Couldn't add that tag — removed.");
    }
  })();
}

export function untagIssue(issueId: string, tagId: string) {
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  if (!ws?.issueTags.some((l) => l.issueId === issueId && l.tagId === tagId)) return;

  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
    w
      ? { ...w, issueTags: w.issueTags.filter((l) => !(l.issueId === issueId && l.tagId === tagId)) }
      : w,
  );

  void (async () => {
    let ok = false;
    try {
      ok = (await fetch(`/api/issues/${issueId}/tags/${tagId}`, { method: "DELETE" })).ok;
    } catch {
      // handled below
    }
    if (!ok) {
      queryClient.setQueryData<WorkspacePayload>(WS_KEY, (w) =>
        w ? { ...w, issueTags: [...w.issueTags, { issueId, tagId }] } : w,
      );
      toast("Couldn't remove that tag — restored.");
    }
  })();
}

// ---------- per-issue timeline ----------

export type Timeline = {
  comments: WireComment[];
  activity: WireActivity[];
  pullRequests: WirePrLink[];
  commits: WireCommitLink[];
};

export function useTimeline(issueId: string) {
  return useQuery({
    queryKey: timelineKey(issueId),
    // A just-created issue carries its optimistic temp id for a beat; hold
    // the fetch until the server row (real id) replaces it.
    enabled: !issueId.startsWith("iss_optimistic_"),
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
