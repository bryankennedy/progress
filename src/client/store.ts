// The client store (D21): the whole snapshot lives in one TanStack Query
// cache entry, loaded once and rendered from memory (SPEC §8.2). Components
// subscribe to slices via `useSnapshotSlice`; structural sharing keeps
// unchanged slices reference-stable so re-renders stay scoped. Per-action
// timelines (comments + activity) are separate queries (D20).

import { keepPreviousData, QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ACTION_STATUS,
  tagColor,
  type ActionPriority,
  type ActionStatus,
} from "../shared/constants";
import { DEFAULT_RANK, rankAfter } from "../shared/rank";
import type {
  CommentSearchResponse,
  WireActivity,
  WireAllowedEmail,
  WireArc,
  WireComment,
  WireCommitLink,
  WireWorkspace,
  WireAction,
  WirePrLink,
  WireFocus,
  WireTag,
  SnapshotPayload,
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

const WS_KEY = ["snapshot"] as const;
const timelineKey = (actionId: string) => ["action", actionId, "timeline"] as const;

// Initial app load is the one permitted loading state; surface its cost.
export const loadStats = { fetchMs: 0 };

// Thrown when the snapshot load returns 401 (PROG-34): no session cookie /
// bearer. App.tsx renders the SignIn landing page on this rather than the error
// banner; the retry guard below stops React Query from re-fetching it.
export class UnauthenticatedError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "UnauthenticatedError";
  }
}

async function fetchSnapshot(): Promise<SnapshotPayload> {
  const t0 = performance.now();
  const res = await fetch("/api/snapshot");
  // Not signed in: surface as a distinct error so App can show the landing page
  // with a "Sign in with Google" CTA instead of silently redirecting.
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`snapshot load failed: HTTP ${res.status}`);
  const ws = (await res.json()) as SnapshotPayload;
  loadStats.fetchMs = performance.now() - t0;
  return ws;
}

const snapshotQuery = {
  queryKey: WS_KEY,
  queryFn: fetchSnapshot,
  // No point retrying an unauthenticated load — the answer won't change until
  // the user signs in. Other failures keep the default retry behavior.
  retry: (failureCount: number, error: Error) =>
    !(error instanceof UnauthenticatedError) && failureCount < 3,
} as const;

export function useSnapshot() {
  return useQuery(snapshotQuery);
}

export function useSnapshotSlice<T>(select: (ws: SnapshotPayload) => T): T | undefined {
  return useQuery({ ...snapshotQuery, select }).data;
}

// ---------- action keys ----------

export function actionKeyOf(ws: SnapshotPayload, action: WireAction): string {
  const prefix = ws.focuses.find((p) => p.id === action.focusId)?.keyPrefix ?? "?";
  return `${prefix}-${action.number}`;
}

// The Step parents above an action, outermost first (PROG-106). Steps nest to
// unbounded depth (PROG-124), so the action page's breadcrumb walks the whole
// chain rather than naming only the immediate parent. A parent missing from the
// snapshot truncates the chain instead of throwing. The API enforces acyclicity
// on reparent, but `seen` keeps a corrupt snapshot from spinning forever.
export function actionAncestors(ws: SnapshotPayload, action: WireAction): WireAction[] {
  const chain: WireAction[] = [];
  const seen = new Set<string>([action.id]);
  let current = action;
  while (current.parentActionId) {
    const parent = ws.actions.find((a) => a.id === current.parentActionId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    chain.push(parent);
    current = parent;
  }
  return chain.reverse();
}

// Resolves "PROG-123" to an action: current keys first, then the permanent
// aliases left behind by cross-focus moves (SPEC §3). Returns the action and
// whether it was reached via an alias (callers redirect to the canonical key).
export function findActionByKey(
  ws: SnapshotPayload,
  key: string,
): { action: WireAction; viaAlias: boolean } | undefined {
  const match = /^([A-Za-z]+)-(\d+)$/.exec(key.trim());
  if (match) {
    const prefix = match[1]!.toUpperCase();
    const number = Number(match[2]!);
    const focus = ws.focuses.find((p) => p.keyPrefix.toUpperCase() === prefix);
    const action = focus && ws.actions.find((i) => i.focusId === focus.id && i.number === number);
    if (action) return { action, viaAlias: false };
  }
  const alias = ws.actionKeyAliases.find((a) => a.key.toUpperCase() === key.trim().toUpperCase());
  const aliased = alias && ws.actions.find((i) => i.id === alias.actionId);
  return aliased ? { action: aliased, viaAlias: true } : undefined;
}

// ---------- action mutations ----------

function getAction(id: string): WireAction | undefined {
  return queryClient.getQueryData<SnapshotPayload>(WS_KEY)?.actions.find((i) => i.id === id);
}

function writeAction(id: string, write: (action: WireAction) => WireAction) {
  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (ws) =>
    ws ? { ...ws, actions: ws.actions.map((i) => (i.id === id ? write(i) : i)) } : ws,
  );
}

// Re-warm the cached "Work on this" bundle after a server-confirmed change, so
// a later copy reflects the edit/comment/tag/move instead of a stale snapshot
// from page load. Keyed by the action's current canonical key (a cross-focus
// move re-keys, and the action is already updated in the store by then).
function refreshBundle(id: string) {
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
  const action = ws?.actions.find((i) => i.id === id);
  if (ws && action) prefetchBundle(actionKeyOf(ws, action));
}

// The optimistic-mutation template (SPEC §8.2): write the store
// synchronously, sync to the server in the background, and on failure restore
// the action's pre-mutation snapshot and raise a toast. Rollback is per-action
// (a failure never clobbers other actions' optimistic writes); overlapping
// mutations to the SAME action can over-rollback, acceptable at single-user
// rates.
async function optimisticActionMutation(
  id: string,
  patch: Partial<WireAction>,
  send: () => Promise<Response>,
  opts?: { toastOnError?: boolean },
): Promise<boolean> {
  const before = getAction(id);
  if (!before) return false;
  writeAction(id, (action) => ({ ...action, ...patch }));
  // PATCH is idempotent, so transient D1 resets can be retried safely (PROG-51).
  // Fast backoff: the optimistic value is on screen, so revert quickly on a true
  // failure rather than holding a wrong value through a long retry.
  const res = await sendWithRetry(send, MUTATION_BACKOFF_MS);
  const ok = res?.ok ?? false;
  if (!ok) {
    writeAction(id, () => before);
    // A caller managing its own draft/Retry affordance (the description editor)
    // suppresses this generic toast to avoid a double notification.
    if (opts?.toastOnError !== false) {
      // Surface the server's reason when it gave one (a 4xx names the invalid
      // field) — same affordance as updateContainer.
      let message = "";
      try {
        message = res ? (((await res.json()) as { error?: string }).error ?? "") : "";
      } catch {
        // no JSON body (network failure / non-JSON error) — generic message
      }
      toast(`Couldn't save that change — reverted.${message ? ` (${message})` : ""}`);
    }
  } else {
    refreshBundle(id);
    if (patch.status !== undefined) {
      // The server appended a status_changed activity event; refresh the
      // timeline if this action's page has loaded it.
      void queryClient.invalidateQueries({ queryKey: timelineKey(id) });
    }
  }
  return ok;
}

export type ActionPatch = Partial<{
  title: string;
  description: string;
  status: ActionStatus;
  priority: ActionPriority;
  estimate: number | null;
  arcId: string | null;
  // Step reparent (PROG-124): the new parent action, or null to outdent to
  // the top of its focus. Server enforces same-focus + acyclic.
  parentActionId: string | null;
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
export function updateAction(
  id: string,
  patch: ActionPatch,
  opts?: { toastOnError?: boolean },
): Promise<boolean> {
  const now = new Date().toISOString();
  // Mirrors the server's PATCH semantics so the optimistic state matches
  // what a reload would fetch.
  const optimistic: Partial<WireAction> = { ...patch, updatedAt: now };
  if (patch.status !== undefined) {
    optimistic.completedAt = patch.status === "done" ? now : null;
  }
  return optimisticActionMutation(
    id,
    optimistic,
    () =>
      fetch(`/api/actions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    opts,
  );
}

export function setActionStatus(id: string, status: ActionStatus) {
  updateAction(id, { status });
}

// ---------- action creation ----------

// Only title + focus are required; everything else defaults here (PROG-115),
// so every creation surface (dialog, outline capture, agenda quick-add) shares
// one defaulting path instead of each restating the boilerplate. A new action
// starts in the backlog (DEFAULT_ACTION_STATUS) unless the creator picks
// otherwise.
export type ActionCreateInput = {
  title: string;
  focusId: string;
  arcId?: string | null;
  parentActionId?: string | null;
  status?: ActionStatus;
  priority?: ActionPriority;
  estimate?: number | null;
  dueDate?: string | null;
  // Existing tag ids to link at birth (PROG-89b: the Agenda quick-add inherits
  // the active Tag filter so the capture stays visible under it).
  tagIds?: string[];
};

// Optimistic create: the action number is allocated locally from the
// focus's nextActionNumber mirror — safe because this client is the only
// writer (single-user v1) — so the new key is correct immediately and
// callers can navigate to it without waiting. The temp row is replaced by
// the server row on success (same key, real id) or removed with a toast on
// failure. Returns the new action's key, or undefined if the focus is gone.
export function createAction(input: ActionCreateInput): string | undefined {
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
  const focus = ws?.focuses.find((p) => p.id === input.focusId);
  if (!ws || !focus) return undefined;

  // Resolve the omitted fields ONCE, before the optimistic row and the POST
  // body are built from them — the temp row must show exactly what the server
  // will store (the API's own fallbacks match, but relying on them would let
  // the two drift).
  const full = {
    ...input,
    arcId: input.arcId ?? null,
    parentActionId: input.parentActionId ?? null,
    status: input.status ?? DEFAULT_ACTION_STATUS,
    priority: input.priority ?? "none",
    estimate: input.estimate ?? null,
    dueDate: input.dueDate ?? null,
  };

  // Birth tags (PROG-89b): deduped and limited to tags the store knows, so the
  // optimistic links and the request body always agree. Linked under the temp
  // id, remapped to the server id on reconcile.
  const tagIds = [...new Set(input.tagIds ?? [])].filter((tid) =>
    ws.tags.some((t) => t.id === tid),
  );

  const tempId = `acn_optimistic_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  // Optimistic board rank: append after the current last action, mirroring the
  // server (PROG-43). The single writer means our max matches the DB's, so the
  // server returns the same key; the temp row is replaced on reconcile anyway.
  const ranks = ws.actions.map((i) => i.rank).filter(Boolean);
  const maxRank = ranks.length ? ranks.reduce((a, b) => (a > b ? a : b)) : null;
  const temp: WireAction = {
    id: tempId,
    focusId: full.focusId,
    arcId: full.arcId,
    parentActionId: full.parentActionId,
    number: focus.nextActionNumber,
    title: full.title,
    description: "",
    status: full.status,
    priority: full.priority,
    estimate: full.estimate,
    dueDate: full.dueDate,
    rank: rankAfter(maxRank),
    creatorId: "usr_owner",
    assigneeId: "usr_owner",
    createdAt: now,
    updatedAt: now,
    completedAt: full.status === "done" ? now : null,
  };
  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
    w
      ? {
          ...w,
          actions: [...w.actions, temp],
          actionTags: tagIds.length
            ? [...w.actionTags, ...tagIds.map((tagId) => ({ actionId: tempId, tagId }))]
            : w.actionTags,
          focuses: w.focuses.map((p) =>
            p.id === focus.id ? { ...p, nextActionNumber: p.nextActionNumber + 1 } : p,
          ),
        }
      : w,
  );

  void (async () => {
    let serverAction: WireAction | undefined;
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...full, tagIds }),
      });
      if (res.ok) serverAction = ((await res.json()) as { action: WireAction }).action;
    } catch {
      // handled below
    }
    queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) => {
      if (!w) return w;
      if (serverAction) {
        const real = serverAction;
        return {
          ...w,
          actions: w.actions.map((i) => (i.id === tempId ? real : i)),
          actionTags: w.actionTags.map((l) =>
            l.actionId === tempId ? { ...l, actionId: real.id } : l,
          ),
        };
      }
      // Failure: remove the temp action (and its tag links) and put the
      // allocated number back.
      return {
        ...w,
        actions: w.actions.filter((i) => i.id !== tempId),
        actionTags: w.actionTags.filter((l) => l.actionId !== tempId),
        focuses: w.focuses.map((p) =>
          p.id === focus.id ? { ...p, nextActionNumber: p.nextActionNumber - 1 } : p,
        ),
      };
    });
    if (!serverAction) toast("Couldn't create that action — removed.");
  })();

  return `${focus.keyPrefix}-${temp.number}`;
}

// ---------- action movement ----------

export type MoveTarget = { focusId: string };

// Optimistic move (SPEC §3, PROG-102): a move changes the focus (the sole
// container). The action is re-keyed from the target's sequence, its arc is
// cleared, and the old key is appended to the alias list — all locally first,
// so the board and any open action page (which redirects via the alias) update
// instantly. Rollback restores exactly what this move touched.
export function moveAction(id: string, target: MoveTarget) {
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
  const before = ws?.actions.find((i) => i.id === id);
  const targetFocus = ws?.focuses.find((p) => p.id === target.focusId);
  if (!ws || !before || !targetFocus) return;
  if (before.focusId === target.focusId) return;

  const now = new Date().toISOString();
  const oldKey = actionKeyOf(ws, before);
  // The move also detaches this action's steps (they stay behind, top-level —
  // PROG-124). The server only detaches on a *successful* move, so capture what
  // the optimistic detach touches to restore it on failure.
  const stepsBefore = new Map(
    ws.actions.filter((i) => i.parentActionId === id).map((i) => [i.id, i.updatedAt]),
  );

  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) => {
    if (!w) return w;
    return {
      ...w,
      actions: w.actions.map((i) =>
        i.id === id
          ? {
              ...i,
              focusId: target.focusId,
              arcId: null,
              // Cross-focus move drops the parent and detaches children
              // (PROG-124) — mirrors the server's move handler.
              parentActionId: null,
              number: targetFocus.nextActionNumber,
              updatedAt: now,
            }
          : i.parentActionId === id
            ? { ...i, parentActionId: null, updatedAt: now }
            : i,
      ),
      focuses: w.focuses.map((p) =>
        p.id === target.focusId ? { ...p, nextActionNumber: p.nextActionNumber + 1 } : p,
      ),
      actionKeyAliases: [...w.actionKeyAliases, { key: oldKey, actionId: id, createdAt: now }],
    };
  });

  void (async () => {
    let serverAction: WireAction | undefined;
    try {
      const res = await fetch(`/api/actions/${id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      if (res.ok) serverAction = ((await res.json()) as { action: WireAction }).action;
    } catch {
      // handled below
    }
    if (serverAction) {
      const real = serverAction;
      writeAction(id, () => real);
      // The server appended a "moved" activity event.
      void queryClient.invalidateQueries({ queryKey: timelineKey(id) });
      refreshBundle(id);
      return;
    }
    queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) => {
      if (!w) return w;
      const restored = {
        ...w,
        actions: w.actions.map((i) => {
          if (i.id === id) return before;
          const stepUpdatedAt = stepsBefore.get(i.id);
          return stepUpdatedAt !== undefined
            ? { ...i, parentActionId: id, updatedAt: stepUpdatedAt }
            : i;
        }),
      };
      return {
        ...restored,
        focuses: restored.focuses.map((p) =>
          p.id === target.focusId ? { ...p, nextActionNumber: p.nextActionNumber - 1 } : p,
        ),
        actionKeyAliases: restored.actionKeyAliases.filter(
          (a) => !(a.key === oldKey && a.actionId === id),
        ),
      };
    });
    toast("Couldn't move that action — reverted.");
  })();
}

// ---------- containers (D26) ----------

export type ContainerKind = "workspace" | "focus" | "arc";

export const CONTAINER_COLLECTIONS = {
  workspace: "workspaces",
  focus: "focuses",
  arc: "arcs",
} as const;
type ContainerCollection = (typeof CONTAINER_COLLECTIONS)[ContainerKind];

const CONTAINER_ID_PREFIXES: Record<ContainerKind, string> = {
  workspace: "ini",
  focus: "prd",
  arc: "arc",
};

type WireContainer = WireWorkspace | WireFocus | WireArc;

// The three container collections have distinct element types; TS can't relate
// a union-typed key to its value type on write, so this helper centralizes
// the (runtime-safe) casts.
function writeContainers(key: ContainerCollection, fn: (list: WireContainer[]) => WireContainer[]) {
  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (ws) =>
    ws ? ({ ...ws, [key]: fn(ws[key] as WireContainer[]) } as SnapshotPayload) : ws,
  );
}

export type ContainerCreateInput =
  | { kind: "workspace"; name: string }
  | { kind: "focus"; name: string; workspaceId: string; keyPrefix: string; gitUrl?: string | null }
  | { kind: "arc"; name: string; focusId: string };

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
  // Reorderable containers start at the shared default rank, matching the
  // server's column default — the "nobody has reordered yet" tie (PROG-87).
  const temp: WireContainer =
    input.kind === "workspace"
      ? { ...base, rank: DEFAULT_RANK }
      : input.kind === "focus"
        ? {
            ...base,
            workspaceId: input.workspaceId,
            gitUrl: input.gitUrl ?? null,
            keyPrefix: input.keyPrefix.toUpperCase(),
            nextActionNumber: 1,
            rank: DEFAULT_RANK,
          }
        : { ...base, focusId: input.focusId, rank: DEFAULT_RANK };
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
  // Optional git repo mirrored by a focus (PROG-102).
  gitUrl: string | null;
  // Manual outline order (PROG-87); workspaces/focuses/arcs.
  rank: string;
}>;

// Returns whether the server confirmed the change. Like updateAction, most
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
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
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
  if (patch.rank !== undefined) optimistic.rank = patch.rank;
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
export function tagAction(actionId: string, tag: { tagId: string } | { name: string }) {
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
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
  if (ws.actionTags.some((l) => l.actionId === actionId && l.tagId === tagId)) return;

  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
    w
      ? {
          ...w,
          tags: createdTemp ? [...w.tags, createdTemp] : w.tags,
          actionTags: [...w.actionTags, { actionId, tagId }],
        }
      : w,
  );

  void (async () => {
    let serverTag: WireTag | undefined;
    try {
      const res = await fetch(`/api/actions/${actionId}/tags`, {
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
      queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
        w
          ? {
              ...w,
              tags: [...w.tags.filter((t) => t.id !== tagId && t.id !== real.id), real],
              actionTags: w.actionTags.map((l) =>
                l.actionId === actionId && l.tagId === tagId ? { ...l, tagId: real.id } : l,
              ),
            }
          : w,
      );
      refreshBundle(actionId);
    } else {
      queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
        w
          ? {
              ...w,
              tags: createdTemp ? w.tags.filter((t) => t.id !== tagId) : w.tags,
              actionTags: w.actionTags.filter(
                (l) => !(l.actionId === actionId && l.tagId === tagId),
              ),
            }
          : w,
      );
      toast("Couldn't add that tag — removed.");
    }
  })();
}

export function untagAction(actionId: string, tagId: string) {
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
  if (!ws?.actionTags.some((l) => l.actionId === actionId && l.tagId === tagId)) return;

  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
    w
      ? {
          ...w,
          actionTags: w.actionTags.filter((l) => !(l.actionId === actionId && l.tagId === tagId)),
        }
      : w,
  );

  void (async () => {
    let ok = false;
    try {
      ok = (await fetch(`/api/actions/${actionId}/tags/${tagId}`, { method: "DELETE" })).ok;
    } catch {
      // handled below
    }
    if (!ok) {
      queryClient.setQueryData<SnapshotPayload>(WS_KEY, (w) =>
        w ? { ...w, actionTags: [...w.actionTags, { actionId, tagId }] } : w,
      );
      toast("Couldn't remove that tag — restored.");
    } else {
      refreshBundle(actionId);
    }
  })();
}

// ---------- comment search (PROG-130) ----------

// Debounce a fast-changing value (the search box) so we don't fire a request
// per keystroke. Returns the latest value once it's been stable for `ms`.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// The server half of search: comments aren't in the store (D20), so this is the
// one query that hits the network. Debounced, and it keeps the previous results
// on screen while the next query loads so the comments section doesn't blank
// between keystrokes. React Query keys by the (debounced) query, so a slow
// response for an old query can't clobber a newer one; `signal` also aborts the
// in-flight fetch when the query changes.
//
// Paged (PROG-78): the server returns SEARCH_CAP hits per page with a
// `truncated` flag; `fetchMore` pulls the next page via ?offset= and the pages
// accumulate. `data` flattens them into the pre-pagination shape ({ hits,
// truncated }) so the `/` modal — which only ever wants the first page — is
// untouched; the search page adds a "show more" control on `hasMore`.
export function useCommentSearch(query: string, debounceMs = 150) {
  const debounced = useDebounced(query.trim(), debounceMs);
  const result = useInfiniteQuery({
    queryKey: ["search", "comments", debounced],
    enabled: debounced.length > 0,
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }): Promise<CommentSearchResponse> => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(debounced)}&offset=${pageParam}`,
        { signal },
      );
      if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
      return res.json() as Promise<CommentSearchResponse>;
    },
    // Next page starts after every hit fetched so far; no next page once the
    // server says the match set is exhausted.
    getNextPageParam: (last, pages) =>
      last.truncated ? pages.reduce((n, p) => n + p.hits.length, 0) : undefined,
  });

  const pages = result.data?.pages;
  const data = useMemo<CommentSearchResponse | undefined>(() => {
    if (!pages || pages.length === 0) return undefined;
    return { hits: pages.flatMap((p) => p.hits), truncated: pages[pages.length - 1]!.truncated };
  }, [pages]);

  return {
    data,
    isFetching: result.isFetching,
    hasMore: result.hasNextPage,
    fetchMore: result.fetchNextPage,
    isFetchingMore: result.isFetchingNextPage,
  };
}

// ---------- per-action timeline ----------

export type Timeline = {
  comments: WireComment[];
  activity: WireActivity[];
  pullRequests: WirePrLink[];
  commits: WireCommitLink[];
};

export function useTimeline(actionId: string) {
  return useQuery({
    queryKey: timelineKey(actionId),
    // A just-created action carries its optimistic temp id for a beat; hold
    // the fetch until the server row (real id) replaces it.
    enabled: !actionId.startsWith("acn_optimistic_"),
    queryFn: async (): Promise<Timeline> => {
      const res = await fetch(`/api/actions/${actionId}/timeline`);
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
export async function addComment(actionId: string, body: string): Promise<boolean> {
  const id = `cmt_${crypto.randomUUID().replaceAll("-", "")}`;
  const authorId = queryClient.getQueryData<SnapshotPayload>(WS_KEY)?.me?.id ?? "usr_owner";
  const now = new Date().toISOString();
  const temp: WireComment = { id, actionId, authorId, body, createdAt: now, updatedAt: now };
  queryClient.setQueryData<Timeline>(timelineKey(actionId), (t) =>
    t ? { ...t, comments: [...t.comments, temp] } : t,
  );

  const res = await sendWithRetry(() =>
    fetch(`/api/actions/${actionId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, body }),
    }),
  );
  if (res?.ok) {
    void queryClient.invalidateQueries({ queryKey: timelineKey(actionId) });
    refreshBundle(actionId);
    return true;
  }
  queryClient.setQueryData<Timeline>(timelineKey(actionId), (t) =>
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
  queryClient.setQueryData<SnapshotPayload>(WS_KEY, (ws) =>
    ws ? { ...ws, allowedEmails: write(ws.allowedEmails) } : ws,
  );
}

export function addAllowedEmail(email: string, note: string) {
  const normalized = email.trim().toLowerCase();
  const trimmedNote = note.trim();
  if (normalized === "") return;
  const ws = queryClient.getQueryData<SnapshotPayload>(WS_KEY);
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
    .getQueryData<SnapshotPayload>(WS_KEY)
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
    .getQueryData<SnapshotPayload>(WS_KEY)
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
