// Tests for the pure comment-search helpers (PROG-130). The LIKE wildcard
// escaping is the part most likely to bite (a literal "%" or "_" in a query),
// so it's pinned here alongside the snippet windowing. Run `bun test`.
import { describe, expect, it } from "bun:test";
import {
  commentSnippet,
  escapeLike,
  hasMorePages,
  MAX_OFFSET,
  parseOffset,
  SEARCH_CAP,
} from "./searchComments";

describe("parseOffset", () => {
  it("parses a plain non-negative integer", () => {
    expect(parseOffset("0")).toBe(0);
    expect(parseOffset("50")).toBe(50);
  });

  it("clamps anything malformed to 0 (absent, garbage, negative, fractional)", () => {
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("")).toBe(0);
    expect(parseOffset("abc")).toBe(0);
    expect(parseOffset("-50")).toBe(0);
    expect(parseOffset("12.5")).toBe(0);
    expect(parseOffset("1e999")).toBe(0);
  });

  it("caps runaway offsets", () => {
    expect(parseOffset("999999999")).toBe(MAX_OFFSET);
  });
});

describe("hasMorePages", () => {
  it("reports another page while the query overflows the cap", () => {
    expect(hasMorePages(SEARCH_CAP + 1, 0)).toBe(true);
    expect(hasMorePages(SEARCH_CAP + 1, MAX_OFFSET - SEARCH_CAP)).toBe(true);
  });

  it("reports no more pages when the match set is exhausted", () => {
    expect(hasMorePages(SEARCH_CAP, 0)).toBe(false);
    expect(hasMorePages(0, 0)).toBe(false);
  });

  it("ends pagination at the offset ceiling even mid-match-set", () => {
    // Beyond MAX_OFFSET parseOffset clamps, so advertising more pages here
    // would make the client refetch the same clamped page forever.
    expect(hasMorePages(SEARCH_CAP + 1, MAX_OFFSET)).toBe(false);
  });
});

describe("escapeLike", () => {
  it("leaves ordinary text untouched", () => {
    expect(escapeLike("ozzie")).toBe("ozzie");
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes backslash first so it can't consume the next escape", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("\\%")).toBe("\\\\\\%");
  });
});

describe("commentSnippet", () => {
  it("returns short bodies whole, no ellipses", () => {
    expect(commentSnippet("mentions ozzie here", ["ozzie"])).toBe("mentions ozzie here");
  });

  it("windows around the first matched term with ellipses", () => {
    const body = `${"x".repeat(100)} ozzie ${"y".repeat(100)}`;
    const snip = commentSnippet(body, ["ozzie"], 10);
    expect(snip.startsWith("… ")).toBe(true);
    expect(snip.endsWith(" …")).toBe(true);
    expect(snip).toContain("ozzie");
  });

  it("anchors on the earliest term among several", () => {
    const body = `start zzz ${"-".repeat(200)} aaa end`;
    // "aaa" appears far right, "zzz" near the left — window should hug "zzz".
    const snip = commentSnippet(body, ["aaa", "zzz"], 10);
    expect(snip).toContain("zzz");
    expect(snip).not.toContain("aaa");
  });

  it("is case-insensitive when locating the term (terms are lowercased)", () => {
    expect(commentSnippet("The OZZIE report", ["ozzie"])).toBe("The OZZIE report");
  });
});
