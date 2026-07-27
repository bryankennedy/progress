// Background sync (PROG-128). The store's "load once, never refetch" model
// (SPEC §8.2) assumed this client was the only writer — no longer true now
// that agent sessions and other tabs write through the same API. This module
// polls the tiny GET /api/snapshot/version probe (route change, window
// focus/online, a slow interval) and, only when a cursor actually moved,
// refetches the full snapshot / invalidates open timelines. Idle tabs cost one
// aggregate SELECT per poll; nothing changes on the initial-load path.
//
// Two protections keep this from fighting the optimistic-mutation model:
// - A write counter (`trackedWrite` wraps every store mutation's server sync):
//   while any write is in flight, a changed cursor is NOT applied — the local
//   cursor stays stale, so a later check re-detects the change. Refetching
//   mid-write could clobber optimistic rows (a temp action would vanish until
//   the next sync).
// - Starting a write cancels an already-in-flight background snapshot refetch
//   for the same reason; the stale cursor re-detects later.
//
// Our own writes also move the server cursor, so a poll after local edits
// triggers one redundant snapshot refetch. Accepted: it's background, at most
// one per interval, and React Query's structural sharing keeps unchanged rows
// reference-stable so re-renders stay scoped.

import type { SyncCursors } from "../shared/types";
import { queryClient, SNAPSHOT_KEY } from "./store";

// Min gap between version polls — navigation bursts collapse to one probe.
const THROTTLE_MS = 10_000;
// Steady-state poll cadence while the tab is visible.
const INTERVAL_MS = 60_000;

export type SyncDeps = {
  now(): number;
  // The version probe; null = unreachable/unauthenticated (skip quietly, never
  // let a background poll bounce a working session to the sign-in screen).
  fetchCursors(): Promise<SyncCursors | null>;
  // Full snapshot refetch; true only if fresh data actually landed (a refetch
  // canceled by a write starting mid-flight reports false).
  refreshSnapshot(): Promise<boolean>;
  refreshTimelines(): void;
  hasSnapshot(): boolean;
  cancelSnapshotRefetch(): void;
};

export function createSyncController(deps: SyncDeps) {
  let cursors: SyncCursors | null = null;
  let pendingWrites = 0;
  let checking = false;
  let lastCheckAt = -Infinity;

  return {
    // Called by the store whenever a snapshot payload lands (initial load and
    // every refetch) — the payload carries cursors computed before its own
    // table reads, so adopting them can never skip past an unseen change.
    adoptCursors(next: SyncCursors | undefined) {
      if (next) cursors = next;
    },
    beginWrite() {
      pendingWrites++;
      if (pendingWrites === 1) deps.cancelSnapshotRefetch();
    },
    endWrite() {
      pendingWrites = Math.max(0, pendingWrites - 1);
    },
    async check(): Promise<void> {
      if (checking) return;
      const t = deps.now();
      if (t - lastCheckAt < THROTTLE_MS) return;
      // No snapshot yet (initial load / signed out) — nothing to sync.
      if (!deps.hasSnapshot()) return;
      checking = true;
      lastCheckAt = t;
      try {
        const next = await deps.fetchCursors();
        if (!next) return;
        if (!cursors) {
          // No baseline (payload predates syncCursors) — adopt without
          // refetching; the next change moves the cursor and is caught.
          cursors = next;
          return;
        }
        // Writes in flight: don't touch the caches. The cursor stays stale on
        // purpose so the next check re-detects this same change.
        if (pendingWrites > 0) return;
        if (next.timeline !== cursors.timeline) {
          deps.refreshTimelines();
          cursors = { ...cursors, timeline: next.timeline };
        }
        if (next.snapshot !== cursors.snapshot) {
          const before = cursors.snapshot;
          if (await deps.refreshSnapshot()) {
            // The refetched payload normally adopts its own (newer) cursors;
            // advance manually only if it didn't carry any.
            if (cursors.snapshot === before) cursors = { ...cursors, snapshot: next.snapshot };
          }
        }
      } finally {
        checking = false;
      }
    },
  };
}

const controller = createSyncController({
  now: () => Date.now(),
  fetchCursors: async () => {
    try {
      const res = await fetch("/api/snapshot/version");
      if (!res.ok) return null;
      return ((await res.json()) as { cursors: SyncCursors }).cursors;
    } catch {
      return null;
    }
  },
  refreshSnapshot: async () => {
    const before = queryClient.getQueryState(SNAPSHOT_KEY)?.dataUpdatedAt ?? 0;
    await queryClient.refetchQueries({ queryKey: SNAPSHOT_KEY });
    const state = queryClient.getQueryState(SNAPSHOT_KEY);
    // dataUpdatedAt moves only when fresh data landed — a canceled or failed
    // refetch keeps the old value, and must not advance the cursor.
    return state?.status === "success" && (state.dataUpdatedAt ?? 0) > before;
  },
  refreshTimelines: () => {
    // Prefix-matches every ["action", id, "timeline"] query: mounted ones
    // refetch now (in the background — data stays on screen), the rest are
    // marked stale and refetch on their next mount.
    void queryClient.invalidateQueries({ queryKey: ["action"] });
  },
  hasSnapshot: () => queryClient.getQueryData(SNAPSHOT_KEY) !== undefined,
  cancelSnapshotRefetch: () => {
    const state = queryClient.getQueryState(SNAPSHOT_KEY);
    // Only a background REFETCH is cancelable — never the initial load (no
    // data yet, and no optimistic state exists to protect).
    if (state?.fetchStatus === "fetching" && state.data !== undefined)
      void queryClient.cancelQueries({ queryKey: SNAPSHOT_KEY });
  },
});

export const adoptSyncCursors = (cursors: SyncCursors | undefined) =>
  controller.adoptCursors(cursors);

// Fire-and-forget: throttled internally, safe to call from any trigger.
export function requestSyncCheck() {
  void controller.check();
}

// Wraps a store mutation's server sync (send + reconcile) so background
// refreshes stay out of the way while it's in flight.
export async function trackedWrite<T>(work: () => Promise<T>): Promise<T> {
  controller.beginWrite();
  try {
    return await work();
  } finally {
    controller.endWrite();
  }
}

// Install the passive triggers. Called once from main.tsx; route changes are
// the remaining trigger, wired in App.tsx via useLocation.
export function startBackgroundSync() {
  window.addEventListener("focus", requestSyncCheck);
  window.addEventListener("online", requestSyncCheck);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestSyncCheck();
  });
  setInterval(() => {
    if (!document.hidden) requestSyncCheck();
  }, INTERVAL_MS);
}
