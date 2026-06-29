// Tests for the pure comment-search helpers (PROG-130). The LIKE wildcard
// escaping is the part most likely to bite (a literal "%" or "_" in a query),
// so it's pinned here alongside the snippet windowing. Run `bun test`.
import { describe, expect, it } from "bun:test";
import { commentSnippet, escapeLike } from "./searchComments";

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
