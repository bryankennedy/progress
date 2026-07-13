// Unit tests for the outline reorder math (PROG-86). Deterministic — no browser.
// Ranks are single decimal digits ("1".."4"), a valid subset of the rank
// alphabet that sorts the same way as the fractional keys minted in production.
import { describe, expect, it } from "bun:test";
import { rankForInsert, rankForReorder } from "./outlineReorder";

const RANKS: Record<string, string> = { a: "1", b: "2", c: "3", d: "4" };
const rankOf = (id: string) => RANKS[id]!;
const group = ["a", "b", "c", "d"];

// Assert the minted rank lands strictly between the two neighbour ranks
// (null = open end), so a re-sort places the row exactly where intended.
function between(rank: string | null, lo: string | null, hi: string | null) {
  expect(rank).not.toBeNull();
  if (lo !== null) expect(rank! > lo).toBe(true);
  if (hi !== null) expect(rank! < hi).toBe(true);
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
});
