// Tests for the background-sync controller (PROG-128). Run with `bun test`.
// The controller is exercised through injected deps — a manual clock and
// recording fakes — so these cover the decision logic (throttle, baseline
// adoption, changed-cursor refresh, the pending-write guard) without React
// Query or the network.
import { describe, expect, it } from "bun:test";
import { createSyncController, type SyncDeps } from "./sync";
import type { SyncCursors } from "../shared/types";

const c = (snapshot: string, timeline = "t0"): SyncCursors => ({ snapshot, timeline });

// A deps harness: `cursors` is what the next probe returns (null = probe
// failed); refreshSnapshot succeeds by default and, like the real dep chain,
// adopts the payload's cursors when `payloadCursors` is set.
function harness(overrides: Partial<SyncDeps> & { payloadCursors?: SyncCursors } = {}) {
  const calls = { probes: 0, snapshotRefreshes: 0, timelineRefreshes: 0, cancels: 0 };
  let now = 0;
  let probeResult: SyncCursors | null = null;
  const deps: SyncDeps = {
    now: () => now,
    fetchCursors: async () => {
      calls.probes++;
      return probeResult;
    },
    refreshSnapshot: async () => {
      calls.snapshotRefreshes++;
      if (overrides.payloadCursors) controller.adoptCursors(overrides.payloadCursors);
      return true;
    },
    refreshTimelines: () => {
      calls.timelineRefreshes++;
    },
    hasSnapshot: () => true,
    cancelSnapshotRefetch: () => {
      calls.cancels++;
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "payloadCursors")),
  };
  const controller = createSyncController(deps);
  return {
    controller,
    calls,
    setProbe: (r: SyncCursors | null) => (probeResult = r),
    advance: (ms: number) => (now += ms),
  };
}

describe("createSyncController", () => {
  it("does nothing before the snapshot has loaded", async () => {
    const h = harness({ hasSnapshot: () => false });
    await h.controller.check();
    expect(h.calls.probes).toBe(0);
  });

  it("throttles probes within the minimum interval", async () => {
    const h = harness();
    h.setProbe(c("a"));
    await h.controller.check();
    await h.controller.check(); // same instant — skipped
    h.advance(9_000);
    await h.controller.check(); // still inside the window
    expect(h.calls.probes).toBe(1);
    h.advance(2_000);
    await h.controller.check();
    expect(h.calls.probes).toBe(2);
  });

  it("adopts the first probed cursors as baseline without refetching", async () => {
    const h = harness();
    h.setProbe(c("a"));
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(0);
    // Same cursor later: still no refresh.
    h.advance(60_000);
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(0);
  });

  it("refreshes the snapshot when its cursor moves, then stays quiet", async () => {
    const h = harness({ payloadCursors: c("b") });
    h.controller.adoptCursors(c("a"));
    h.setProbe(c("b"));
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(1);
    expect(h.calls.timelineRefreshes).toBe(0);
    // Cursor unchanged on the next probe — no second refresh.
    h.advance(60_000);
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(1);
  });

  it("advances the cursor itself when the refetched payload carries none", async () => {
    const h = harness(); // no payloadCursors — adoptCursors never called
    h.controller.adoptCursors(c("a"));
    h.setProbe(c("b"));
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(1);
    h.advance(60_000);
    await h.controller.check();
    // Without the manual advance this would refetch forever.
    expect(h.calls.snapshotRefreshes).toBe(1);
  });

  it("does not advance the cursor when the refresh reports failure", async () => {
    let attempts = 0;
    const h = harness({
      refreshSnapshot: async () => {
        attempts++;
        return false; // canceled or failed — no fresh data landed
      },
    });
    h.controller.adoptCursors(c("a"));
    h.setProbe(c("b"));
    await h.controller.check();
    h.advance(60_000);
    await h.controller.check();
    // Cursor stayed stale, so the same change was re-detected and retried.
    expect(attempts).toBe(2);
  });

  it("skips a failed probe quietly", async () => {
    const h = harness();
    h.controller.adoptCursors(c("a"));
    h.setProbe(null);
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(0);
    // A later successful probe with a moved cursor still refreshes.
    h.advance(60_000);
    h.setProbe(c("b"));
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(1);
  });

  it("refreshes timelines independently of the snapshot", async () => {
    const h = harness();
    h.controller.adoptCursors({ snapshot: "a", timeline: "t0" });
    h.setProbe({ snapshot: "a", timeline: "t1" });
    await h.controller.check();
    expect(h.calls.timelineRefreshes).toBe(1);
    expect(h.calls.snapshotRefreshes).toBe(0);
    h.advance(60_000);
    await h.controller.check();
    expect(h.calls.timelineRefreshes).toBe(1);
  });

  it("defers applying a change while writes are in flight, then catches up", async () => {
    const h = harness({ payloadCursors: c("b") });
    h.controller.adoptCursors(c("a"));
    h.setProbe(c("b"));
    h.controller.beginWrite();
    await h.controller.check();
    expect(h.calls.snapshotRefreshes).toBe(0); // guarded
    h.controller.endWrite();
    h.advance(60_000);
    await h.controller.check(); // cursor stayed stale — change re-detected
    expect(h.calls.snapshotRefreshes).toBe(1);
  });

  it("cancels an in-flight background refetch when the first write begins", () => {
    const h = harness();
    h.controller.beginWrite();
    h.controller.beginWrite(); // only the 0→1 transition cancels
    expect(h.calls.cancels).toBe(1);
    h.controller.endWrite();
    h.controller.endWrite();
    h.controller.beginWrite();
    expect(h.calls.cancels).toBe(2);
  });
});
