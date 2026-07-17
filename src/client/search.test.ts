// Tests for client-side snapshot search ranking (PROG-130). The instant
// title/description half is pure, so its weighting + matching live here; the
// comment half is a server LIKE query covered by the worker. Run `bun test`.
import { describe, expect, it } from "bun:test";
import type { SnapshotPayload } from "../shared/types";
import {
  actionMatches,
  browseActions,
  cycleActionSort,
  highlight,
  queryTerms,
  searchContainers,
  searchActions,
  sortActionHits,
  type ActionHit,
} from "./search";

// A minimal snapshot — search only reads actions + the three container arrays
// and their name/title/description/archivedAt fields, so the rest is cast away.
function ws(over: Partial<SnapshotPayload>): SnapshotPayload {
  return {
    workspaces: [],
    focuses: [],
    arcs: [],
    actions: [],
    ...over,
  } as unknown as SnapshotPayload;
}

function action(over: Record<string, unknown>) {
  return {
    id: "i1",
    title: "",
    description: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("queryTerms", () => {
  it("lowercases, trims, and splits on whitespace", () => {
    expect(queryTerms("  Ozzie  Sync ")).toEqual(["ozzie", "sync"]);
    expect(queryTerms("")).toEqual([]);
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("searchActions", () => {
  it("ranks a title match above a description-only match", () => {
    const data = ws({
      actions: [
        action({ id: "desc", title: "unrelated", description: "mentions ozzie here" }),
        action({ id: "title", title: "Ozzie onboarding", description: "" }),
      ],
    });
    const hits = searchActions(data, "ozzie");
    expect(hits.map((h) => h.action.id)).toEqual(["title", "desc"]);
    expect(hits[0]!.inTitle).toBe(true);
    expect(hits[1]!.inTitle).toBe(false);
  });

  it("requires every term to appear somewhere (AND semantics)", () => {
    const data = ws({
      actions: [
        action({ id: "both", title: "Ozzie sync", description: "" }),
        action({ id: "one", title: "Ozzie", description: "no second term" }),
      ],
    });
    expect(searchActions(data, "ozzie sync").map((h) => h.action.id)).toEqual(["both"]);
  });

  it("matches substrings, not just whole words", () => {
    const data = ws({ actions: [action({ id: "x", title: "refactor the ozziefier" })] });
    expect(searchActions(data, "ozzie").map((h) => h.action.id)).toEqual(["x"]);
  });

  it("breaks score ties by recency", () => {
    const data = ws({
      actions: [
        action({ id: "old", title: "ozzie", updatedAt: "2026-01-01T00:00:00.000Z" }),
        action({ id: "new", title: "ozzie", updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(searchActions(data, "ozzie").map((h) => h.action.id)).toEqual(["new", "old"]);
  });

  it("returns nothing for an empty query", () => {
    const data = ws({ actions: [action({ id: "x", title: "ozzie" })] });
    expect(searchActions(data, "  ")).toEqual([]);
  });
});

describe("browseActions", () => {
  it("returns every action, newest first (PROG-78 empty-query browse)", () => {
    const data = ws({
      actions: [
        action({ id: "old", title: "a", updatedAt: "2026-01-01T00:00:00.000Z" }),
        action({ id: "new", title: "b", updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(browseActions(data).map((h) => h.action.id)).toEqual(["new", "old"]);
  });

  it("marks hits inTitle so no description snippet renders", () => {
    const data = ws({ actions: [action({ id: "x", description: "some body text" })] });
    expect(browseActions(data)[0]).toMatchObject({ inTitle: true, score: 0 });
  });
});

describe("sortActionHits", () => {
  const hitsOf = (actions: Record<string, unknown>[]): ActionHit[] =>
    actions.map((i) => ({ action: action(i), score: 0, inTitle: true }) as unknown as ActionHit);

  const focuses = [
    { id: "p1", name: "Alpha", keyPrefix: "ALPH" },
    { id: "p2", name: "beta", keyPrefix: "BETA" },
  ] as never;

  it("returns the hits untouched when sort is null (default order preserved)", () => {
    const hits = hitsOf([{ id: "b" }, { id: "a" }]);
    expect(sortActionHits(ws({}), hits, null)).toBe(hits);
  });

  it("sorts by key numerically within a focus (PROG-2 before PROG-10)", () => {
    const hits = hitsOf([
      { id: "ten", focusId: "p1", number: 10 },
      { id: "two", focusId: "p1", number: 2 },
      { id: "other", focusId: "p2", number: 1 },
    ]);
    const sorted = sortActionHits(ws({ focuses }), hits, { key: "key", dir: "asc" });
    expect(sorted.map((h) => h.action.id)).toEqual(["two", "ten", "other"]);
  });

  it("sorts title and focus case-insensitively, and desc flips the order", () => {
    const hits = hitsOf([
      { id: "z", title: "zebra", focusId: "p2" },
      { id: "a", title: "Apple", focusId: "p1" },
    ]);
    const data = ws({ focuses });
    expect(
      sortActionHits(data, hits, { key: "title", dir: "asc" }).map((h) => h.action.id),
    ).toEqual(["a", "z"]);
    expect(
      sortActionHits(data, hits, { key: "title", dir: "desc" }).map((h) => h.action.id),
    ).toEqual(["z", "a"]);
    expect(
      sortActionHits(data, hits, { key: "focus", dir: "asc" }).map((h) => h.action.id),
    ).toEqual(["a", "z"]);
  });

  it("sorts status by workflow order and priority by urgency, not alphabetically", () => {
    const statusHits = hitsOf([
      { id: "done", status: "done" },
      { id: "backlog", status: "backlog" },
      { id: "prog", status: "in_progress" },
    ]);
    expect(
      sortActionHits(ws({}), statusHits, { key: "status", dir: "asc" }).map((h) => h.action.id),
    ).toEqual(["backlog", "prog", "done"]);

    // Alphabetical would put "high" before "urgent"; urgency order must not.
    const prioHits = hitsOf([
      { id: "none", priority: "none" },
      { id: "high", priority: "high" },
      { id: "urgent", priority: "urgent" },
    ]);
    expect(
      sortActionHits(ws({}), prioHits, { key: "priority", dir: "asc" }).map((h) => h.action.id),
    ).toEqual(["urgent", "high", "none"]);
  });

  it("sorts by updated time chronologically (PROG-96)", () => {
    const hits = hitsOf([
      { id: "mid", updatedAt: "2026-03-01T00:00:00.000Z" },
      { id: "new", updatedAt: "2026-06-01T00:00:00.000Z" },
      { id: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(
      sortActionHits(ws({}), hits, { key: "updated", dir: "asc" }).map((h) => h.action.id),
    ).toEqual(["old", "mid", "new"]);
    expect(
      sortActionHits(ws({}), hits, { key: "updated", dir: "desc" }).map((h) => h.action.id),
    ).toEqual(["new", "mid", "old"]);
  });

  it("breaks ties by recency regardless of direction", () => {
    const hits = hitsOf([
      { id: "old", status: "todo", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", status: "todo", updatedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    for (const dir of ["asc", "desc"] as const) {
      expect(sortActionHits(ws({}), hits, { key: "status", dir }).map((h) => h.action.id)).toEqual([
        "new",
        "old",
      ]);
    }
  });
});

describe("searchContainers", () => {
  it("matches name and description but skips archived", () => {
    const data = ws({
      focuses: [
        { id: "p1", name: "Ozzie", description: "", archivedAt: null },
        { id: "p2", name: "Other", description: "about ozzie", archivedAt: null },
        { id: "p3", name: "Ozzie archived", description: "", archivedAt: "2026-01-01" },
      ] as never,
    });
    const ids = searchContainers(data, "ozzie").map((h) => h.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).not.toContain("p3");
  });

  it("builds the route href from the kind", () => {
    const data = ws({
      arcs: [{ id: "a1", name: "Ozzie", description: "", archivedAt: null }] as never,
    });
    expect(searchContainers(data, "ozzie")[0]).toMatchObject({ kind: "arc", href: "/arc/a1" });
  });
});

describe("highlight", () => {
  it("splits text into matched and unmatched segments, case-insensitively", () => {
    expect(highlight("Fix Ozzie now", ["ozzie"])).toEqual([
      { text: "Fix ", match: false },
      { text: "Ozzie", match: true },
      { text: " now", match: false },
    ]);
  });

  it("treats regex metacharacters in terms literally", () => {
    expect(highlight("cost is 100% today", ["100%"])).toEqual([
      { text: "cost is ", match: false },
      { text: "100%", match: true },
      { text: " today", match: false },
    ]);
  });

  it("returns the whole string unmatched when there are no terms", () => {
    expect(highlight("anything", [])).toEqual([{ text: "anything", match: false }]);
  });
});

// PROG-126: the shared-table helpers added for the container/Agenda embeds.
describe("cycleActionSort", () => {
  it("cycles new column → asc, same column → desc, third click → default", () => {
    expect(cycleActionSort(null, "title")).toEqual({ key: "title", dir: "asc" });
    expect(cycleActionSort({ key: "title", dir: "asc" }, "title")).toEqual({
      key: "title",
      dir: "desc",
    });
    expect(cycleActionSort({ key: "title", dir: "desc" }, "title")).toBeNull();
  });

  it("switching columns starts ascending regardless of the old direction", () => {
    expect(cycleActionSort({ key: "title", dir: "desc" }, "status")).toEqual({
      key: "status",
      dir: "asc",
    });
  });
});

describe("actionMatches", () => {
  const a = action({ title: "Fix the roof", description: "before winter" });
  it("matches every term across title and description (AND)", () => {
    expect(actionMatches(["fix", "winter"], a as never)).toBe(true);
    expect(actionMatches(["fix", "summer"], a as never)).toBe(false);
  });
  it("no terms matches everything", () => {
    expect(actionMatches([], a as never)).toBe(true);
  });
});

describe("sortActionHits — due column (PROG-126)", () => {
  const hitsOf = (rows: Record<string, unknown>[]): ActionHit[] =>
    rows.map((r) => ({ action: action(r) as never, score: 0, inTitle: true }));
  it("sorts by calendar day and always sinks undated rows", () => {
    const hits = hitsOf([
      { id: "none", dueDate: null },
      { id: "late", dueDate: "2026-08-01" },
      { id: "soon", dueDate: "2026-07-01" },
    ]);
    const asc = sortActionHits(ws({}), hits, { key: "due", dir: "asc" });
    expect(asc.map((h) => h.action.id)).toEqual(["soon", "late", "none"]);
    const desc = sortActionHits(ws({}), hits, { key: "due", dir: "desc" });
    expect(desc.map((h) => h.action.id)).toEqual(["late", "soon", "none"]);
  });
});
