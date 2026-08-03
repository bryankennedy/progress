import { describe, expect, test } from "bun:test";
import type { SnapshotPayload, WireAction } from "../shared/types";
import { completionSeries, dayBounds, dayRecap } from "./diary";
import { localDayOfInstant } from "./dates";

// Minimal snapshot: only the fields the diary helpers read.
function snapshotWith(actions: Partial<WireAction>[]): SnapshotPayload {
  return {
    me: null,
    isSuperAdmin: false,
    allowedEmails: [],
    users: [],
    workspaces: [],
    focuses: [],
    arcs: [],
    actions: actions as WireAction[],
    tags: [],
    actionTags: [],
    actionKeyAliases: [],
  };
}

// An instant that falls on the given LOCAL day (noon local time avoids any
// midnight edge regardless of the machine's timezone).
const noonOn = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
};

const action = (over: Partial<WireAction>): Partial<WireAction> => ({
  id: `acn_${Math.random().toString(36).slice(2)}`,
  status: "todo",
  createdAt: noonOn("2026-01-05"),
  updatedAt: noonOn("2026-01-05"),
  completedAt: null,
  ...over,
});

describe("dayBounds", () => {
  test("spans exactly local midnight to next local midnight", () => {
    const { from, to } = dayBounds("2026-08-03");
    expect(new Date(from * 1000).getHours()).toBe(0);
    expect(new Date(from * 1000).getDate()).toBe(3);
    expect(new Date(to * 1000).getDate()).toBe(4);
    // Non-DST day: exactly 24h. (A DST day would be 23/25h, still midnight
    // to midnight — asserted implicitly by the getHours/getDate checks.)
    expect(localDayOfInstant(new Date(from * 1000).toISOString())).toBe("2026-08-03");
    expect(localDayOfInstant(new Date(to * 1000 - 1).toISOString())).toBe("2026-08-03");
  });
});

describe("dayRecap", () => {
  const day = "2026-08-03";
  const other = "2026-08-01";

  test("splits completed / created / touched, no double-listing", () => {
    const snapshot = snapshotWith([
      // Completed on the day (created earlier).
      action({
        id: "a1",
        status: "done",
        createdAt: noonOn(other),
        completedAt: noonOn(day),
        updatedAt: noonOn(day),
      }),
      // Created on the day.
      action({ id: "a2", createdAt: noonOn(day), updatedAt: noonOn(day) }),
      // Created earlier, touched on the day.
      action({ id: "a3", createdAt: noonOn(other), updatedAt: noonOn(day) }),
      // Untouched on the day — appears nowhere.
      action({ id: "a4", createdAt: noonOn(other), updatedAt: noonOn(other) }),
      // Created AND completed on the day: listed in both, not in touched.
      action({
        id: "a5",
        status: "done",
        createdAt: noonOn(day),
        completedAt: noonOn(day),
        updatedAt: noonOn(day),
      }),
    ]);
    const recap = dayRecap(snapshot, day);
    expect(new Set(recap.completed.map((a) => a.id))).toEqual(new Set(["a1", "a5"]));
    expect(new Set(recap.created.map((a) => a.id))).toEqual(new Set(["a2", "a5"]));
    expect(recap.touched.map((a) => a.id)).toEqual(["a3"]);
  });

  test("an action reopened later no longer counts as completed that day", () => {
    // completedAt clears when status leaves done, so the snapshot simply has
    // nothing to attribute — the recap reflects current knowledge.
    const snapshot = snapshotWith([
      action({
        id: "a1",
        status: "in_progress",
        createdAt: noonOn(other),
        completedAt: null,
        updatedAt: noonOn(day),
      }),
    ]);
    const recap = dayRecap(snapshot, day);
    expect(recap.completed).toEqual([]);
    expect(recap.touched.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("completionSeries", () => {
  test("zero-fills the window, oldest first, ending at endDay", () => {
    const snapshot = snapshotWith([
      action({ id: "a1", status: "done", completedAt: noonOn("2026-08-02") }),
      action({ id: "a2", status: "done", completedAt: noonOn("2026-08-02") }),
      action({ id: "a3", status: "done", completedAt: noonOn("2026-07-31") }),
      // Outside the window — ignored.
      action({ id: "a4", status: "done", completedAt: noonOn("2026-07-01") }),
      // Not completed — ignored.
      action({ id: "a5", completedAt: null }),
    ]);
    const series = completionSeries(snapshot, "2026-08-03", 4);
    expect(series).toEqual([
      { day: "2026-07-31", count: 1 },
      { day: "2026-08-01", count: 0 },
      { day: "2026-08-02", count: 2 },
      { day: "2026-08-03", count: 0 },
    ]);
  });
});
