// Unit tests for the tie-healing drop placement (PROG-129). Deterministic —
// no browser. The crashing production shape: sibling groups whose fractional
// ranks carry exact duplicates (racing creates) and 38-char degenerate keys.
import { describe, expect, it } from "bun:test";
import { isValidRank } from "../shared/rank";
import { placementRanks } from "./rankPlacement";

// Apply a placement: splice the active rank in at `insertAt` and overwrite the
// healed indices, returning the group's final rank sequence.
function apply(ranks: string[], insertAt: number) {
  const placed = placementRanks(ranks, insertAt);
  const next = [...ranks];
  for (const h of placed.heal) next[h.index] = h.rank;
  next.splice(insertAt, 0, placed.rank);
  return { placed, next };
}

const strictlyAscending = (a: string[]) => a.every((v, i) => i === 0 || a[i - 1]! < v);

describe("placementRanks", () => {
  it("mints a single rank when the slot's neighbours are distinct", () => {
    const { placed, next } = apply(["1", "2", "3"], 1);
    expect(placed.heal).toEqual([]);
    expect(strictlyAscending(next)).toBe(true);
  });

  it("handles the open ends", () => {
    expect(apply(["5"], 0).next[0]! < "5").toBe(true);
    expect(apply(["5"], 1).next[1]! > "5").toBe(true);
    expect(isValidRank(placementRanks([], 0).rank)).toBe(true);
  });

  it("heals a duplicate pair at the slot (the PROG-129 crash)", () => {
    // Two rows with the SAME key — dropping between them has no gap.
    const { placed, next } = apply(["1", "7", "7", "9"], 2);
    expect(placed.heal.length).toBeGreaterThan(0);
    expect(strictlyAscending(next)).toBe(true);
    // The rewrite stays inside the strict outer bounds.
    expect(next.every((r, i) => i === 0 || r > "1")).toBe(true);
    expect(next[4]).toBe("9");
  });

  it("heals the real degenerate keys from production", () => {
    const z = (n: number, tail: string) => "z".repeat(n) + tail;
    // The actual arc tail that crashed: 37-z duplicates around the drop.
    const ranks = [z(36, "s"), z(36, "w"), z(36, "x"), z(37, "k"), z(37, "s"), z(37, "s")];
    // Drag to the very bottom: an append never throws and never touches the
    // group (a tie only heals when the drop lands on it).
    const bottom = apply(ranks, 6);
    expect(bottom.placed.heal).toEqual([]);
    expect(bottom.placed.rank > ranks[5]!).toBe(true);
    // Drop between the duplicate pair — the exact PROG-129 crash: the run is
    // re-spaced and the whole group comes out strictly ordered.
    const between = apply(ranks, 5);
    expect(strictlyAscending(between.next)).toBe(true);
  });

  it("heals an entirely tied group", () => {
    const { next } = apply(["V", "V", "V", "V"], 2);
    expect(strictlyAscending(next)).toBe(true);
    expect(next.every(isValidRank)).toBe(true);
  });

  it("leaves rows outside the tied run untouched", () => {
    const ranks = ["1", "4", "4", "8", "9"];
    const placed = placementRanks(ranks, 2);
    // Only the 4/4 run may move; 1, 8 and 9 keep their keys.
    for (const h of placed.heal) expect([1, 2]).toContain(h.index);
  });
});
