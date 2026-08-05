// Tests for theme preset persistence + application (PROG-150). Run with
// `bun test`. Mirrors outlinePrefs.test.ts's pattern: a minimal fake
// localStorage on `window`, plus a minimal fake `document`/`documentElement`
// so setTheme's DOM side effects (data-theme attribute, theme-color meta) are
// exercised without a real DOM.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getTheme, setTheme, THEMES } from "./theme";

const KEY = "progress:theme";

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

function fakeDocument() {
  const dataset: Record<string, string> = {};
  const themeColorMeta = {
    attrs: new Map<string, string>([["content", "#f7f7f2"]]),
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value);
    },
    getAttribute(name: string) {
      return this.attrs.get(name) ?? null;
    },
  };
  return {
    documentElement: { dataset },
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? themeColorMeta : null),
    _themeColorMeta: themeColorMeta,
  };
}

type FakeGlobal = {
  window?: { localStorage: Storage };
  document?: ReturnType<typeof fakeDocument>;
};
const g = globalThis as unknown as FakeGlobal;
let savedWindow: FakeGlobal["window"];
let savedDocument: FakeGlobal["document"];

beforeEach(() => {
  savedWindow = g.window;
  savedDocument = g.document;
  g.window = { localStorage: fakeStorage() };
  g.document = fakeDocument();
});
afterEach(() => {
  g.window = savedWindow;
  g.document = savedDocument;
});

describe("THEMES metadata", () => {
  it("lists exactly the three presets, porcelain first (the default)", () => {
    expect(THEMES.map((t) => t.id)).toEqual(["porcelain", "adobe", "sanzo"]);
  });

  it("gives every theme a label, description, and three swatch colors", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.swatch.paper).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.swatch.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.swatch.moss).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("getTheme", () => {
  it("defaults to porcelain when nothing is stored", () => {
    expect(getTheme()).toBe("porcelain");
  });

  it("reads back a stored valid theme id", () => {
    g.window!.localStorage.setItem(KEY, "adobe");
    expect(getTheme()).toBe("adobe");
  });

  it("falls back to porcelain for an unknown stored value", () => {
    g.window!.localStorage.setItem(KEY, "sepia");
    expect(getTheme()).toBe("porcelain");
  });

  it("fails soft when localStorage throws", () => {
    g.window = {
      localStorage: {
        getItem() {
          throw new Error("storage disabled");
        },
      } as unknown as Storage,
    };
    expect(getTheme()).toBe("porcelain");
  });
});

describe("setTheme", () => {
  it("stores non-porcelain ids and sets data-theme + theme-color", () => {
    setTheme("sanzo");
    expect(g.window!.localStorage.getItem(KEY)).toBe("sanzo");
    expect(g.document!.documentElement.dataset.theme).toBe("sanzo");
    expect(g.document!._themeColorMeta.getAttribute("content")).toBe(
      THEMES.find((t) => t.id === "sanzo")!.swatch.paper,
    );
  });

  it("clears the stored key and the data-theme attribute for porcelain", () => {
    setTheme("adobe");
    setTheme("porcelain");
    expect(g.window!.localStorage.getItem(KEY)).toBeNull();
    expect(g.document!.documentElement.dataset.theme).toBeUndefined();
    expect(g.document!._themeColorMeta.getAttribute("content")).toBe(
      THEMES.find((t) => t.id === "porcelain")!.swatch.paper,
    );
  });

  it("round-trips through getTheme", () => {
    setTheme("adobe");
    expect(getTheme()).toBe("adobe");
  });

  it("never throws when localStorage throws", () => {
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
    expect(() => setTheme("adobe")).not.toThrow();
    // The DOM side effect still applies even though storage failed.
    expect(g.document!.documentElement.dataset.theme).toBe("adobe");
  });

  it("never throws when document is unavailable", () => {
    g.document = undefined;
    expect(() => setTheme("sanzo")).not.toThrow();
    // The storage side effect still applies even though the DOM failed.
    expect(g.window!.localStorage.getItem(KEY)).toBe("sanzo");
  });
});
