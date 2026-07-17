// Unit tests for the outline reorder math (PROG-86). Deterministic — no browser.
// Ranks are single decimal digits ("1".."4"), a valid subset of the rank
// alphabet that sorts the same way as the fractional keys minted in production.
import { describe, expect, it } from "bun:test";
import { rankForInsert, rankForReorder, type ReorderPlacement } from "./outlineReorder";

const RANKS: Record<string, string> = { a: "1", b: "2", c: "3", d: "4" };
const rankOf = (id: string) => RANKS[id]!;
const group = ["a", "b", "c", "d"];

// Assert the minted rank lands strictly between the two neighbour ranks
// (null = open end), so a re-sort places the row exactly where intended —
// and that the drop needed no heal writes (all neighbour ranks distinct).
function between(placed: ReorderPlacement | null, lo: string | null, hi: string | null) {
  expect(placed).not.toBeNull();
  expect(placed!.heal).toEqual([]);
  if (lo !== null) expect(placed!.rank > lo).toBe(true);
  if (hi !== null) expect(placed!.rank < hi).toBe(true);
}

describe("rankForReorder", () => {
  it("moves a row DOWN one slot — between its new neighbours", () => {
    // Drop a onto b: a lands AFTER b (board's arrayMove-down semantics).
    between(rankForReorder(group, rankOf, "a", "b"), "2", "3");
  });

  it("moves a row DOWN two slots", () => {
    // Drop a onto c: a lands after c, before d.
    between(rankForReorder(group, rankOf, "a", "c"), "3", "4");
  });

  it("moves a row UP", () => {
    // Drop d onto b: d lands before b, after a.
    between(rankForReorder(group, rankOf, "d", "b"), "1", "2");
  });

  it("moves a row to the very top (open start)", () => {
    between(rankForReorder(group, rankOf, "c", "a"), null, "1");
  });

  it("moves a row to the very bottom (open end)", () => {
    between(rankForReorder(group, rankOf, "a", "d"), "4", null);
  });

  it("returns null when dropped on itself", () => {
    expect(rankForReorder(group, rankOf, "b", "b")).toBeNull();
  });

  it("returns null when an id is not in the group", () => {
    expect(rankForReorder(group, rankOf, "a", "zzz")).toBeNull();
    expect(rankForReorder(group, rankOf, "zzz", "a")).toBeNull();
  });

  it("heals a tied run instead of throwing (PROG-129)", () => {
    // b, c and d share one duplicate key — the racing-create shape that used
    // to crash the page: dropping a between two equal ranks has no gap.
    const dupRanks: Record<string, string> = { a: "1", b: "7", c: "7", d: "7" };
    const dupOf = (id: string) => dupRanks[id]!;
    const placed = rankForReorder(group, dupOf, "a", "b");
    expect(placed).not.toBeNull();
    // a lands after b; the whole tied run is re-spaced strictly between the
    // outer bounds ("1" and the open end), preserving b < a < c < d.
    const rankAt = (id: string) =>
      id === "a" ? placed!.rank : (placed!.heal.find((h) => h.id === id)?.rank ?? dupOf(id));
    const order = ["b", "a", "c", "d"].map(rankAt);
    expect([...order].every((r, i) => i === 0 || order[i - 1]! < r)).toBe(true);
    expect(order.every((r) => r > "1")).toBe(true);
  });
});

describe("rankForInsert (cross-group drop, PROG-118)", () => {
  it("lands above the hovered member when the pointer is above its middle", () => {
    between(rankForInsert(group, rankOf, "b", false), "1", "2");
  });

  it("lands below the hovered member when the pointer is past its middle", () => {
    between(rankForInsert(group, rankOf, "b", true), "2", "3");
  });

  it("lands at the very top (open start)", () => {
    between(rankForInsert(group, rankOf, "a", false), null, "1");
  });

  it("lands at the very bottom (open end)", () => {
    between(rankForInsert(group, rankOf, "d", true), "4", null);
  });

  it("appends when dropped over the group itself (overId not a member)", () => {
    between(rankForInsert(group, rankOf, "the-arc-section", false), "4", null);
  });

  it("mints a first rank for an empty group", () => {
    between(rankForInsert([], rankOf, "the-arc-section", false), null, null);
  });

  it("heals a tied run at the insertion point (PROG-129)", () => {
    const dupRanks: Record<string, string> = { a: "1", b: "5", c: "5", d: "9" };
    const dupOf = (id: string) => dupRanks[id]!;
    // Insert before c: the b/c duplicate pair around the slot is re-spaced.
    const placed = rankForInsert(group, dupOf, "c", false);
    const rankAt = (id: string) => placed.heal.find((h) => h.id === id)?.rank ?? dupOf(id);
    const order = [rankAt("a"), rankAt("b"), placed.rank, rankAt("c"), rankAt("d")];
    expect(order.every((r, i) => i === 0 || order[i - 1]! < r)).toBe(true);
  });
});
