// PR-reference autolinking (PROG-121): bare `#123` in action text links to the
// focus repo's PR page; code spans, existing links, and hex colors stay alone.

import { describe, expect, test } from "bun:test";
import remarkPrRefs, { prRefBase, splitPrRefs } from "./prRefs";

const BASE = "https://github.com/o/r";

describe("prRefBase", () => {
  test("passes a clean URL through", () => {
    expect(prRefBase("https://github.com/o/r")).toBe("https://github.com/o/r");
  });

  test("strips trailing slashes and .git", () => {
    expect(prRefBase("https://github.com/o/r/")).toBe("https://github.com/o/r");
    expect(prRefBase("https://github.com/o/r.git")).toBe("https://github.com/o/r");
  });

  test("null/undefined/empty → null", () => {
    expect(prRefBase(null)).toBeNull();
    expect(prRefBase(undefined)).toBeNull();
    expect(prRefBase("  ")).toBeNull();
  });
});

describe("splitPrRefs", () => {
  test("linkifies a bare ref mid-sentence", () => {
    expect(splitPrRefs("Fixed in PR #107.", BASE)).toEqual([
      { type: "text", value: "Fixed in PR " },
      {
        type: "link",
        url: `${BASE}/pull/107`,
        children: [{ type: "text", value: "#107" }],
      },
      { type: "text", value: "." },
    ]);
  });

  test("linkifies at start of text and inside parens", () => {
    expect(splitPrRefs("#9 shipped", BASE)[0]).toMatchObject({ url: `${BASE}/pull/9` });
    const parens = splitPrRefs("(see #12)", BASE);
    expect(parens[1]).toMatchObject({ url: `${BASE}/pull/12` });
    expect(parens[2]).toEqual({ type: "text", value: ")" });
  });

  test("handles multiple refs in one text run", () => {
    const nodes = splitPrRefs("Supersedes #4 and #10.", BASE);
    const links = nodes.filter((n) => n.type === "link").map((n) => n.url);
    expect(links).toEqual([`${BASE}/pull/4`, `${BASE}/pull/10`]);
  });

  test("leaves hex colors, fragments, and word-adjacent hashes alone", () => {
    for (const text of ["color #1e90ff", "color #123456", "C#5 chord", "foo#123", "#123abc"]) {
      expect(splitPrRefs(text, BASE)).toEqual([{ type: "text", value: text }]);
    }
  });

  test("returns the text unchanged when there is no ref", () => {
    expect(splitPrRefs("no refs here", BASE)).toEqual([{ type: "text", value: "no refs here" }]);
  });
});

describe("remarkPrRefs (tree walk)", () => {
  test("rewrites text nodes but not code or existing links", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "PR #7 vs " },
            { type: "inlineCode", value: "#8" },
            { type: "text", value: " and " },
            {
              type: "link",
              url: "https://example.com",
              children: [{ type: "text", value: "#9" }],
            },
          ],
        },
        { type: "code", value: "#10" },
      ],
    };
    remarkPrRefs({ base: BASE })(tree);
    const para = tree.children[0];
    expect(para.children).toEqual([
      { type: "text", value: "PR " },
      { type: "link", url: `${BASE}/pull/7`, children: [{ type: "text", value: "#7" }] },
      { type: "text", value: " vs " },
      { type: "inlineCode", value: "#8" },
      { type: "text", value: " and " },
      { type: "link", url: "https://example.com", children: [{ type: "text", value: "#9" }] },
    ]);
    expect(tree.children[1]).toEqual({ type: "code", value: "#10" });
  });
});
