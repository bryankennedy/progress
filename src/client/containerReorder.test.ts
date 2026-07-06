// Unit tests for the container reorder math (PROG-87). Deterministic — no
// browser. Mirrors outlineReorder.test.ts, plus the tied-rank cases that are
// this module's reason to exist.
import { describe, expect, it } from "bun:test";
import { DEFAULT_RANK } from "../shared/rank";
import { byRankThenName, containerReorderRanks, type Ranked } from "./containerReorder";

const tied = (id: string, name: string): Ranked => ({ id, name, rank: DEFAULT_RANK });

// Apply updates to a group and re-sort — what the store + view do after a drop.
function applied(group: Ranked[], updates: Array<{ id: string; rank: string }>): string[] {
  const byId = new Map(updates.map((u) => [u.id, u.rank]));
  return group
    .map((g) => ({ ...g, rank: byId.get(g.id) ?? g.rank }))
    .sort(byRankThenName)
    .map((g) => g.id);
}

describe("byRankThenName", () => {
  it("falls back to alphabetical names while all ranks tie", () => {
    const group = [tied("c", "Cider"), tied("a", "Apple"), tied("b", "Banana")];
    expect([...group].sort(byRankThenName).map((g) => g.id)).toEqual(["a", "b", "c"]);
  });

  it("lets rank override the alphabet once ranks diverge", () => {
    const group = [
      { id: "a", name: "Apple", rank: "k" },
      { id: "b", name: "Banana", rank: "V" },
    ];
    expect([...group].sort(byRankThenName).map((g) => g.id)).toEqual(["b", "a"]);
  });
});

describe("containerReorderRanks — tied group (nobody has reordered yet)", () => {
  // Rendered alphabetically: a, b, c, d — all at DEFAULT_RANK.
  const group = [tied("a", "Alpha"), tied("b", "Beta"), tied("c", "Gamma"), tied("d", "Delta")];

  it("renumbers the whole group in the new visual order", () => {
    const updates = containerReorderRanks(group, "d", "a")!;
    expect(applied(group, updates)).toEqual(["d", "a", "b", "c"]);
  });

  it("mints strictly increasing, valid ranks", () => {
    const updates = containerReorderRanks(group, "a", "c")!;
    expect(applied(group, updates)).toEqual(["b", "c", "a", "d"]);
    const ranks = applied(group, updates).map(
      (id) => updates.find((u) => u.id === id)?.rank ?? DEFAULT_RANK,
    );
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]! < ranks[i]!).toBe(true);
  });

  it("skips rows whose rank is already right (the new head keeps DEFAULT_RANK)", () => {
    // Moving d to the top: the renumber chain starts at rankAfter(null) =
    // DEFAULT_RANK, which d already carries — so d itself needs no write; only
    // the rows now sorting after it do.
    const updates = containerReorderRanks(group, "d", "a")!;
    expect(updates.find((u) => u.id === "d")).toBeUndefined();
    expect(updates.map((u) => u.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("is a partial renumber trigger even when only SOME ranks tie", () => {
    const mixed = [
      { id: "a", name: "Alpha", rank: "V" },
      { id: "b", name: "Beta", rank: "V" }, // tie with a
      { id: "c", name: "Gamma", rank: "k" },
    ];
    const updates = containerReorderRanks(mixed, "c", "a")!;
    expect(applied(mixed, updates)).toEqual(["c", "a", "b"]);
  });
});

describe("containerReorderRanks — distinct ranks (fast path)", () => {
  const group = [
    { id: "a", name: "Alpha", rank: "1" },
    { id: "b", name: "Beta", rank: "2" },
    { id: "c", name: "Gamma", rank: "3" },
  ];

  it("moves with a single write, between the new neighbours", () => {
    const updates = containerReorderRanks(group, "c", "a")!;
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("c");
    expect(updates[0]!.rank < "1").toBe(true);
    expect(applied(group, updates)).toEqual(["c", "a", "b"]);
  });

  it("moves down with a single write", () => {
    const updates = containerReorderRanks(group, "a", "b")!;
    expect(updates).toHaveLength(1);
    expect(applied(group, updates)).toEqual(["b", "a", "c"]);
  });
});

describe("containerReorderRanks — invalid drops", () => {
  const group = [tied("a", "Alpha"), tied("b", "Beta")];

  it("returns null when dropped on itself", () => {
    expect(containerReorderRanks(group, "a", "a")).toBeNull();
  });

  it("returns null when an id is not in the group", () => {
    expect(containerReorderRanks(group, "a", "zzz")).toBeNull();
    expect(containerReorderRanks(group, "zzz", "a")).toBeNull();
  });
});
