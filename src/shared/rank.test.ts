// Tests for the board-ordering rank keys (PROG-43). Run with `bun test`.
import { describe, expect, it } from "bun:test";
import { DEFAULT_RANK, isValidRank, rankAfter, rankBetween } from "./rank";

// Deterministic PRNG so any failure reproduces.
const prng = (s: number) => () => {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  return s / 0x7fffffff;
};
const sorted = (a: string[]) => a.every((v, i) => i === 0 || a[i - 1]! < v);

describe("rankBetween", () => {
  it("emits a valid key strictly between its bounds", () => {
    expect(rankBetween("0001", "0009") > "0001").toBe(true);
    expect(rankBetween("0001", "0009") < "0009").toBe(true);
    expect(isValidRank(rankBetween(null, null))).toBe(true);
    expect(rankBetween(null, "0005") < "0005").toBe(true);
    expect(rankBetween("0005", null) > "0005").toBe(true);
  });

  it("throws when before does not sort before after", () => {
    expect(() => rankBetween("z", "a")).toThrow();
    expect(() => rankBetween("aaa", "aaa")).toThrow();
  });

  it("stays correct across 100k random insertions from a backfilled board", () => {
    const rnd = prng(123456789);
    // Mirrors the migration backfill: width-12 decimal, +1 so keys end non-zero.
    const keys = Array.from({ length: 200 }, (_, i) => String(i * 1000 + 1).padStart(12, "0"));
    expect(sorted(keys)).toBe(true);

    for (let op = 0; op < 100_000; op++) {
      const slot = Math.floor(rnd() * (keys.length + 1));
      const before = slot === 0 ? null : keys[slot - 1]!;
      const after = slot === keys.length ? null : keys[slot]!;
      const r = rankBetween(before, after);
      expect(isValidRank(r)).toBe(true);
      expect(before === null || before < r).toBe(true);
      expect(after === null || r < after).toBe(true);
      keys.splice(slot, 0, r);
    }
    expect(sorted(keys)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("subdivides the same gap repeatedly without collapsing", () => {
    let lo = "00000000000a";
    const hi = "00000000000b";
    for (let i = 0; i < 500; i++) {
      const r = rankBetween(lo, hi);
      expect(lo < r && r < hi).toBe(true);
      lo = r; // squeeze toward hi
    }
  });

  it("prepends and appends indefinitely", () => {
    let lo = "000000000001";
    let hi = rankAfter(null);
    for (let i = 0; i < 1000; i++) {
      const p = rankBetween(null, lo);
      expect(p < lo).toBe(true);
      lo = p;
      const a = rankAfter(hi);
      expect(hi < a).toBe(true);
      hi = a;
    }
  });

  it("append keys grow slowly — ~61 appends per digit, not ~6 (PROG-129)", () => {
    // Every create appends after the global max, so append growth is the rate
    // real keys degrade. The old midpoint-toward-top ladder hit 38 chars in a
    // few hundred creates; +1 stepping keeps 1000 appends under 18.
    let key = rankAfter(null);
    for (let i = 0; i < 1000; i++) key = rankAfter(key);
    expect(key.length).toBeLessThanOrEqual(18);
  });

  it("keeps DEFAULT_RANK as the untouched midpoint", () => {
    expect(rankBetween(null, null)).toBe(DEFAULT_RANK);
  });
});

describe("isValidRank", () => {
  it("accepts non-empty alphabet strings, rejects everything else", () => {
    expect(isValidRank("0001")).toBe(true);
    expect(isValidRank("Zz9a")).toBe(true);
    expect(isValidRank("")).toBe(false);
    expect(isValidRank("ab-cd")).toBe(false);
    expect(isValidRank(42)).toBe(false);
    expect(isValidRank(null)).toBe(false);
  });
});
