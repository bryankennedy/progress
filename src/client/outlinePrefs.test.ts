// Tests for the sticky Outline "hide done" preference (PROG-77). Run with
// `bun test`. We stub a minimal localStorage on `window` so the soft-fail
// behavior and round-trip are exercised without a real DOM.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { loadHideDone, loadScope, saveHideDone, saveScope } from "./outlinePrefs";

const KEY = "progress:outline-hide-done";
const SCOPE_KEY = "progress:outline-scope";

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

const g = globalThis as unknown as { window?: { localStorage: Storage } };
let savedWindow: typeof g.window;

beforeEach(() => {
  savedWindow = g.window;
  g.window = { localStorage: fakeStorage() };
});
afterEach(() => {
  g.window = savedWindow;
});

describe("outline hide-done preference", () => {
  it("defaults to false (show done) when nothing is stored", () => {
    expect(loadHideDone()).toBe(false);
  });

  it("round-trips true → stores '1' and loads back as true", () => {
    saveHideDone(true);
    expect(g.window!.localStorage.getItem(KEY)).toBe("1");
    expect(loadHideDone()).toBe(true);
  });

  it("saving false clears the key (so it reads as the default)", () => {
    saveHideDone(true);
    saveHideDone(false);
    expect(g.window!.localStorage.getItem(KEY)).toBeNull();
    expect(loadHideDone()).toBe(false);
  });

  it("fails soft when localStorage throws — never breaks the view", () => {
    g.window = {
      localStorage: {
        getItem() {
          throw new Error("storage disabled");
        },
        setItem() {
          throw new Error("storage disabled");
        },
        removeItem() {
          throw new Error("storage disabled");
        },
      } as unknown as Storage,
    };
    expect(loadHideDone()).toBe(false);
    expect(() => saveHideDone(true)).not.toThrow();
  });
});

describe("outline scope preference (PROG-140)", () => {
  it("returns null when nothing is stored", () => {
    expect(loadScope()).toBeNull();
  });

  it("round-trips the all scope as the bare token 'all'", () => {
    saveScope({ kind: "all" });
    expect(g.window!.localStorage.getItem(SCOPE_KEY)).toBe("all");
    expect(loadScope()).toEqual({ kind: "all" });
  });

  it("round-trips an id-bearing scope as '<kind>:<id>'", () => {
    saveScope({ kind: "focus", id: "prd_1" });
    expect(g.window!.localStorage.getItem(SCOPE_KEY)).toBe("focus:prd_1");
    expect(loadScope()).toEqual({ kind: "focus", id: "prd_1" });

    saveScope({ kind: "workspace", id: "ini_2" });
    expect(loadScope()).toEqual({ kind: "workspace", id: "ini_2" });
  });

  it("ignores an unknown kind or a missing id", () => {
    g.window!.localStorage.setItem(SCOPE_KEY, "arc:arc_1");
    expect(loadScope()).toBeNull();
    g.window!.localStorage.setItem(SCOPE_KEY, "focus:");
    expect(loadScope()).toBeNull();
  });

  it("fails soft when localStorage throws", () => {
    g.window = {
      localStorage: {
        getItem() {
          throw new Error("storage disabled");
        },
        setItem() {
          throw new Error("storage disabled");
        },
        removeItem() {
          throw new Error("storage disabled");
        },
      } as unknown as Storage,
    };
    expect(loadScope()).toBeNull();
    expect(() => saveScope({ kind: "all" })).not.toThrow();
  });
});
