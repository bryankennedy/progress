// Tests for the Done-column cap (PROG-40). Run with `bun test`.
import { describe, expect, it } from "bun:test";
import { DONE_VISIBLE_LIMIT, recentlyCompleted } from "./boardDone";

type Row = { id: string; completedAt: string | null };
const row = (id: string, completedAt: string | null): Row => ({ id, completedAt });

describe("recentlyCompleted", () => {
  it("returns everything (a copy) when under the limit", () => {
    const done = [row("a", "2026-01-01"), row("b", "2026-02-01")];
    const out = recentlyCompleted(done, 10);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out).not.toBe(done); // copy, not the same array
  });

  it("keeps the N most recently completed, dropping older ones", () => {
    const done = [
      row("jan", "2026-01-01"),
      row("mar", "2026-03-01"),
      row("feb", "2026-02-01"),
      row("apr", "2026-04-01"),
    ];
    expect(
      recentlyCompleted(done, 2)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["apr", "mar"]);
  });

  it("preserves the input (rank) order of the kept items", () => {
    // Input is in rank order, NOT completedAt order; output must keep rank order.
    const done = [
      row("r1", "2026-04-01"),
      row("r2", "2026-01-01"), // oldest → dropped when limit is 2
      row("r3", "2026-03-01"),
    ];
    expect(recentlyCompleted(done, 2).map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("treats a null completedAt as oldest (dropped first)", () => {
    const done = [row("dated", "2026-01-01"), row("undated", null)];
    expect(recentlyCompleted(done, 1).map((r) => r.id)).toEqual(["dated"]);
  });

  it("defaults to DONE_VISIBLE_LIMIT", () => {
    const done = Array.from({ length: DONE_VISIBLE_LIMIT + 5 }, (_, i) =>
      row(`i${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`),
    );
    expect(recentlyCompleted(done)).toHaveLength(DONE_VISIBLE_LIMIT);
  });
});
