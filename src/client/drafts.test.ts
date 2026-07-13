// Tests for local draft persistence (PROG-51; "capture" kind added by
// PROG-107). Run with `bun test`. drafts.ts reads the bare `localStorage`
// global, so we stub one on globalThis; deleting it exercises the soft-fail
// guards (a ReferenceError inside the try must degrade, never crash).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearDraft, readDraft, writeDraft } from "./drafts";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const g = globalThis as unknown as { localStorage?: Storage };
let savedStorage: Storage | undefined;

beforeEach(() => {
  savedStorage = g.localStorage;
  g.localStorage = fakeStorage();
});
afterEach(() => {
  if (savedStorage === undefined) delete g.localStorage;
  else g.localStorage = savedStorage;
});

describe("local draft persistence", () => {
  it("round-trips a draft per kind/user/target", () => {
    writeDraft("capture", "usr_a", "prd_1", "half-typed action");
    expect(readDraft("capture", "usr_a", "prd_1")).toBe("half-typed action");
    // Other kinds, users, and targets see nothing — keys don't collide.
    expect(readDraft("comment", "usr_a", "prd_1")).toBe("");
    expect(readDraft("capture", "usr_b", "prd_1")).toBe("");
    expect(readDraft("capture", "usr_a", "prd_2")).toBe("");
  });

  it("writing the empty string removes the stored draft", () => {
    writeDraft("capture", "usr_a", "prd_1", "text");
    writeDraft("capture", "usr_a", "prd_1", "");
    expect(g.localStorage!.length).toBe(0);
    expect(readDraft("capture", "usr_a", "prd_1")).toBe("");
  });

  it("clearDraft removes the stored draft", () => {
    writeDraft("comment", "usr_a", "act_1", "unsent comment");
    clearDraft("comment", "usr_a", "act_1");
    expect(readDraft("comment", "usr_a", "act_1")).toBe("");
  });

  it("fails soft when localStorage is unavailable — never throws", () => {
    delete g.localStorage;
    expect(readDraft("capture", "usr_a", "prd_1")).toBe("");
    expect(() => writeDraft("capture", "usr_a", "prd_1", "text")).not.toThrow();
    expect(() => clearDraft("capture", "usr_a", "prd_1")).not.toThrow();
  });
});
