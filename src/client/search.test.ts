// Tests for client-side workspace search ranking (PROG-130). The instant
// title/description half is pure, so its weighting + matching live here; the
// comment half is a server LIKE query covered by the worker. Run `bun test`.
import { describe, expect, it } from "bun:test";
import type { WorkspacePayload } from "../shared/types";
import { browseIssues, highlight, queryTerms, searchContainers, searchIssues } from "./search";

// A minimal workspace — search only reads issues + the four container arrays
// and their name/title/description/archivedAt fields, so the rest is cast away.
function ws(over: Partial<WorkspacePayload>): WorkspacePayload {
  return {
    initiatives: [],
    products: [],
    repos: [],
    arcs: [],
    issues: [],
    ...over,
  } as unknown as WorkspacePayload;
}

function issue(over: Record<string, unknown>) {
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

describe("searchIssues", () => {
  it("ranks a title match above a description-only match", () => {
    const data = ws({
      issues: [
        issue({ id: "desc", title: "unrelated", description: "mentions ozzie here" }),
        issue({ id: "title", title: "Ozzie onboarding", description: "" }),
      ],
    });
    const hits = searchIssues(data, "ozzie");
    expect(hits.map((h) => h.issue.id)).toEqual(["title", "desc"]);
    expect(hits[0]!.inTitle).toBe(true);
    expect(hits[1]!.inTitle).toBe(false);
  });

  it("requires every term to appear somewhere (AND semantics)", () => {
    const data = ws({
      issues: [
        issue({ id: "both", title: "Ozzie sync", description: "" }),
        issue({ id: "one", title: "Ozzie", description: "no second term" }),
      ],
    });
    expect(searchIssues(data, "ozzie sync").map((h) => h.issue.id)).toEqual(["both"]);
  });

  it("matches substrings, not just whole words", () => {
    const data = ws({ issues: [issue({ id: "x", title: "refactor the ozziefier" })] });
    expect(searchIssues(data, "ozzie").map((h) => h.issue.id)).toEqual(["x"]);
  });

  it("breaks score ties by recency", () => {
    const data = ws({
      issues: [
        issue({ id: "old", title: "ozzie", updatedAt: "2026-01-01T00:00:00.000Z" }),
        issue({ id: "new", title: "ozzie", updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(searchIssues(data, "ozzie").map((h) => h.issue.id)).toEqual(["new", "old"]);
  });

  it("returns nothing for an empty query", () => {
    const data = ws({ issues: [issue({ id: "x", title: "ozzie" })] });
    expect(searchIssues(data, "  ")).toEqual([]);
  });
});

describe("browseIssues", () => {
  it("returns every issue, newest first (PROG-78 empty-query browse)", () => {
    const data = ws({
      issues: [
        issue({ id: "old", title: "a", updatedAt: "2026-01-01T00:00:00.000Z" }),
        issue({ id: "new", title: "b", updatedAt: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(browseIssues(data).map((h) => h.issue.id)).toEqual(["new", "old"]);
  });

  it("marks hits inTitle so no description snippet renders", () => {
    const data = ws({ issues: [issue({ id: "x", description: "some body text" })] });
    expect(browseIssues(data)[0]).toMatchObject({ inTitle: true, score: 0 });
  });
});

describe("searchContainers", () => {
  it("matches name and description but skips archived", () => {
    const data = ws({
      products: [
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
    const data = ws({ arcs: [{ id: "a1", name: "Ozzie", description: "", archivedAt: null }] as never });
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
