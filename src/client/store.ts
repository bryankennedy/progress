// The client store (D21): the whole workspace lives in one TanStack Query
// cache entry, loaded once and rendered from memory (SPEC §8.2). Components
// subscribe to slices via `useWorkspaceSlice`; structural sharing keeps
// unchanged slices reference-stable so re-renders stay scoped. Per-issue
// timelines (comments + activity) are separate queries (D20).

import { QueryClient, useQuery } from "@tanstack/react-query";
import { tagColor, type IssuePriority, type IssueStatus } from "../shared/constants";
import { rankAfter } from "../shared/rank";
import type {
  WireActivity,
  WireAllowedEmail,
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
import { prefetchBundle } from "./workOn";

// Retry transient write failures (PROG-51). A D1 storage-reset timeout throws a
// 500 (or a network error) even though the operation sometimes committed — so
// retries must target idempotent requests only: PATCH/DELETE are naturally
// idempotent, and comment POST carries a client-supplied id so a re-send can't
// duplicate. A 4xx is a real client error that won't change on retry, so it's
// returned immediately. Returns the final Response, or null when every attempt
// failed transiently (network error or 5xx).
//
// Two backoff profiles. A failed comment post shows nothing wrong on screen
// (the optimistic row is correct or gets removed), so it can retry harder to
// recover transparently. A failed *field* mutation leaves the WRONG value
// visible until it reverts, so it retries once, quickly — capping that
// wrong-state window — and falls back to the revert + Retry toast.
const COMMENT_BACKOFF_MS = [400, 1200] as const;
const MUTATION_BACKOFF_MS = [300] as const;

async function sendWithRetry(
  send: () => Promise<Response>,
  backoffs: readonly number[] = COMMENT_BACKOFF_MS,
): Promise<Response | null> {
  const attempts = backoffs.length + 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await send();
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
    } catch {
      // Network/transport error — fall through to a retry.
    }
    const backoff = backoffs[i];
    if (backoff !== undefined) await new Promise((r) => setTimeout(r, backoff));
  }
  return null;
}

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

// Thrown when the workspace load returns 401 (PROG-34): no session cookie /
// bearer. App.tsx renders the SignIn landing page on this rather than the error
// banner; the retry guard below stops React Query from re-fetching it.
export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

async function fetchWorkspace(): Promise<WorkspacePayload> {
  const t0 = performance.now();
  const res = await fetch("/api/workspace");
  // Not signed in: surface as a distinct error so App can show the landing page
  // with a "Sign in with Google" CTA instead of silently redirecting.
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`workspace load failed: HTTP ${res.status}`);
  const ws = (await res.json()) as WorkspacePayload;
  loadStats.fetchMs = performance.now() - t0;
  return ws;
}

const workspaceQuery = {
  queryKey: WS_KEY,
  queryFn: fetchWorkspace,
  // No point retrying an unauthenticated load — the answer won't change until
  // the user signs in. Other failures keep the default retry behavior.
  retry: (failureCount: number, error: Error) =>
    !(error instanceof UnauthenticatedError) && failureCount < 3,
} as const;

export function useWorkspace() {
  return useQuery(workspaceQuery);
}

export function useWorkspaceSlice<T>(select: (ws: WorkspacePayload) => T): T | undefined {
  return useQuery({ ...workspaceQuery, select }).data;
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

// Re-warm the cached "Work on this" bundle after a server-confirmed change, so
// a later copy reflects the edit/comment/tag/move instead of a stale snapshot
// from page load. Keyed by the issue's current canonical key (a cross-product
// move re-keys, and the issue is already updated in the store by then).
function refreshBundle(id: string) {
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  const issue = ws?.issues.find((i) => i.id === id);
  if (ws && issue) prefetchBundle(issueKeyOf(ws, issue));
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
  opts?: { toastOnError?: boolean },
): Promise<boolean> {
  const before = getIssue(id);
  if (!before) return false;
  writeIssue(id, (issue) => ({ ...issue, ...patch }));
  // PATCH is idempotent, so transient D1 resets can be retried safely (PROG-51).
  // Fast backoff: the optimistic value is on screen, so revert quickly on a true
  // failure rather than holding a wrong value through a long retry.
  const res = await sendWithRetry(send, MUTATION_BACKOFF_MS);
  const ok = res?.ok ?? false;
  if (!ok) {
    writeIssue(id, () => before);
    // A caller managing its own draft/Retry affordance (the description editor)
    // suppresses this generic toast to avoid a double notification.
    if (opts?.toastOnError !== false) toast("Couldn't save that change — reverted.");
  } else {
    refreshBundle(id);
    if (patch.status !== undefined) {
      // The server appended a status_changed activity event; refresh the
      // timeline if this issue's page has loaded it.
      void queryClient.invalidateQueries({ queryKey: timelineKey(id) });
    }
  }
  return ok;
}

export type IssuePatch = Partial<{
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
  arcId: string | null;
  dueDate: string | null;
  // Fractional-index board position (PROG-43). The caller computes the key from
  // the drop site's neighbors via `rankBetween`; a reorder across columns sends
  // `status` alongside it in one patch.
  rank: string;
}>;

// Returns whether the server confirmed the change. Most callers fire-and-forget
// (the optimistic write + toast-on-failure is enough); the description editor
// awaits it to clear/keep its draft and offer Retry (PROG-51), passing
// `toastOnError: false` so it can show its own draft-aware message instead.
export function updateIssue(
  id: string,
  patch: IssuePatch,
  opts?: { toastOnError?: boolean },
): Promise<boolean> {
  const now = new Date().toISOString();
  // Mirrors the server's PATCH semantics so the optimistic state matches
  // what a reload would fetch.
  const optimistic: Partial<WireIssue> = { ...patch, updatedAt: now };
  if (patch.status !== undefined) {
    optimistic.completedAt = patch.status === "done" ? now : null;
  }
  return optimisticIssueMutation(
    id,
    optimistic,
    () =>
      fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    opts,
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
  // Optimistic board rank: append after the current last issue, mirroring the
  // server (PROG-43). The single writer means our max matches the DB's, so the
  // server returns the same key; the temp row is replaced on reconcile anyway.
  const ranks = ws.issues.map((i) => i.rank).filter(Boolean);
  const maxRank = ranks.length ? ranks.reduce((a, b) => (a > b ? a : b)) : null;
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
    rank: rankAfter(maxRank),
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
      refreshBundle(id);
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

// Returns whether the server confirmed the change. Like updateIssue, most
// callers fire-and-forget; the container-description editor awaits it (with
// `toastOnError: false`) to clear/keep its draft and show its own Retry message
// (PROG-51).
export function updateContainer(
  kind: ContainerKind,
  id: string,
  patch: ContainerPatch,
  opts?: { toastOnError?: boolean },
): Promise<boolean> {
  const collection = CONTAINER_COLLECTIONS[kind];
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  const before = (ws?.[collection] as WireContainer[] | undefined)?.find((x) => x.id === id);
  if (!before) return Promise.resolve(false);

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

  // PATCH is idempotent, so retry transient D1 resets (PROG-51). Fast backoff:
  // the optimistic value is visible, so revert quickly on a true failure.
  return (async () => {
    const res = await sendWithRetry(
      () =>
        fetch(`/api/${collection}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        }),
      MUTATION_BACKOFF_MS,
    );
    const ok = res?.ok ?? false;
    if (!ok) {
      writeContainers(collection, (list) => list.map((x) => (x.id === id ? before : x)));
      if (opts?.toastOnError !== false) {
        let message = "";
        try {
          message = res ? (((await res.json()) as { error?: string }).error ?? "") : "";
        } catch {
          // no JSON body (network failure / non-JSON error) — generic message
        }
        toast(`Couldn't save that change — reverted.${message ? ` (${message})` : ""}`);
      }
    }
    return ok;
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
      refreshBundle(issueId);
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
    } else {
      refreshBundle(issueId);
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

// Posts a comment optimistically and reports whether the server confirmed it.
// The `cmt_…` id is minted here and sent to the server as an idempotency key
// (PROG-51): a transient D1 timeout can return an error *after* the row
// committed, so `sendWithRetry` re-sends the same id and the server returns the
// existing row instead of duplicating it. The optimistic row uses that same id,
// so a successful refetch reconciles without a flicker. On exhausted failure
// the row is removed and `false` is returned — the caller keeps the draft and
// offers Retry (re-calling this with the same text is safe).
export async function addComment(issueId: string, body: string): Promise<boolean> {
  const id = `cmt_${crypto.randomUUID().replaceAll("-", "")}`;
  const authorId = queryClient.getQueryData<WorkspacePayload>(WS_KEY)?.me?.id ?? "usr_owner";
  const now = new Date().toISOString();
  const temp: WireComment = { id, issueId, authorId, body, createdAt: now, updatedAt: now };
  queryClient.setQueryData<Timeline>(timelineKey(issueId), (t) =>
    t ? { ...t, comments: [...t.comments, temp] } : t,
  );

  const res = await sendWithRetry(() =>
    fetch(`/api/issues/${issueId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, body }),
    }),
  );
  if (res?.ok) {
    void queryClient.invalidateQueries({ queryKey: timelineKey(issueId) });
    refreshBundle(issueId);
    return true;
  }
  queryClient.setQueryData<Timeline>(timelineKey(issueId), (t) =>
    t ? { ...t, comments: t.comments.filter((cm) => cm.id !== id) } : t,
  );
  return false;
}

// ---------- admin: sign-in allowlist (D44) ----------
//
// Same optimistic template as tags: write the cached `allowedEmails` slice
// synchronously, sync in the background, reconcile the server row (real id) on
// success, roll back + toast on failure. Only ever runs on the Admin page,
// which is super-admin-gated; the API enforces the boundary regardless.

const byEmail = (a: WireAllowedEmail, b: WireAllowedEmail) => a.email.localeCompare(b.email);

function writeAllowedEmails(write: (list: WireAllowedEmail[]) => WireAllowedEmail[]) {
  queryClient.setQueryData<WorkspacePayload>(WS_KEY, (ws) =>
    ws ? { ...ws, allowedEmails: write(ws.allowedEmails) } : ws,
  );
}

export function addAllowedEmail(email: string, note: string) {
  const normalized = email.trim().toLowerCase();
  const trimmedNote = note.trim();
  if (normalized === "") return;
  const ws = queryClient.getQueryData<WorkspacePayload>(WS_KEY);
  if (!ws) return;
  if (ws.allowedEmails.some((e) => e.email === normalized)) {
    toast("That email is already on the list.");
    return;
  }

  const tempId = `ael_${crypto.randomUUID().replaceAll("-", "")}`;
  const temp: WireAllowedEmail = {
    id: tempId,
    email: normalized,
    note: trimmedNote,
    addedByEmail: ws.me?.email ?? "",
    createdAt: new Date().toISOString(),
  };
  writeAllowedEmails((list) => [...list, temp].sort(byEmail));

  void (async () => {
    let saved: WireAllowedEmail | undefined;
    let conflict = false;
    try {
      const res = await fetch("/api/admin/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized, note: trimmedNote }),
      });
      if (res.ok) saved = ((await res.json()) as { allowedEmail: WireAllowedEmail }).allowedEmail;
      else if (res.status === 409) conflict = true;
    } catch {
      // handled below
    }
    if (saved) {
      const real = saved;
      writeAllowedEmails((list) => list.map((e) => (e.id === tempId ? real : e)).sort(byEmail));
    } else {
      writeAllowedEmails((list) => list.filter((e) => e.id !== tempId));
      toast(conflict ? "That email is already on the list." : "Couldn't add that email — removed.");
    }
  })();
}

export function updateAllowedEmailNote(id: string, note: string) {
  const before = queryClient
    .getQueryData<WorkspacePayload>(WS_KEY)
    ?.allowedEmails.find((e) => e.id === id);
  if (!before) return;
  const trimmed = note.trim();
  if (trimmed === before.note) return;
  writeAllowedEmails((list) => list.map((e) => (e.id === id ? { ...e, note: trimmed } : e)));

  void (async () => {
    let ok = false;
    try {
      ok = (
        await fetch(`/api/admin/allowlist/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: trimmed }),
        })
      ).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      writeAllowedEmails((list) => list.map((e) => (e.id === id ? before : e)));
      toast("Couldn't save that note — reverted.");
    }
  })();
}

export function removeAllowedEmail(id: string) {
  const before = queryClient
    .getQueryData<WorkspacePayload>(WS_KEY)
    ?.allowedEmails.find((e) => e.id === id);
  if (!before) return;
  writeAllowedEmails((list) => list.filter((e) => e.id !== id));

  void (async () => {
    let ok = false;
    try {
      ok = (await fetch(`/api/admin/allowlist/${id}`, { method: "DELETE" })).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      writeAllowedEmails((list) => [...list, before].sort(byEmail));
      toast("Couldn't remove that email — restored.");
    }
  })();
}
