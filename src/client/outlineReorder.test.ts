// Unit tests for the outline reorder math (PROG-86). Deterministic — no browser.
// Ranks are single decimal digits ("1".."4"), a valid subset of the rank
// alphabet that sorts the same way as the fractional keys minted in production.
import { describe, expect, it } from "bun:test";
import { rankForReorder } from "./outlineReorder";

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
