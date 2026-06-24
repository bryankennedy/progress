// Tests for the context-bundle "copy as prompt" work order (PROG-17/PROG-62).
// Run with `bun test`. Focus: the embedded smart-commit guidance and that the
// render stays deterministic.
import { describe, expect, it } from "bun:test";
import { renderBundle, type BundleData } from "./bundle";

// Minimal bundle — only the fields renderBundle reads, cast to the row types.
const bundle = (over: Partial<BundleData> = {}): BundleData => ({
  key: "PROG-62",
  issue: {
    title: "Embed smart-commit in the bundle",
    status: "in_progress",
    priority: "urgent",
    estimate: null,
    dueDate: null,
    description: "Make the copy-as-prompt output follow the commit rules.",
  } as BundleData["issue"],
  product: { name: "Progress", description: "A personal tracker." } as BundleData["product"],
  repo: null,
  arc: null,
  tags: [],
  comments: [],
  pullRequests: [],
  commits: [],
  baseUrl: "https://example.test",
  ...over,
});

describe("renderBundle — Committing & PRs (smart-commit)", () => {
  it("embeds the five smart-commit steps", () => {
    const md = renderBundle(bundle());
    expect(md).toContain("### Committing & PRs");
    expect(md).toContain("**Analyze**");
    expect(md).toContain("**Security check**");
    expect(md).toContain("**Plan**");
    expect(md).toContain("**Commit**");
    expect(md).toContain("**Verify**");
    expect(md).toContain("**Push the PR**");
  });

  it("tells the agent to push a PR rather than stall at a local commit", () => {
    const md = renderBundle(bundle());
    expect(md).toMatch(/open a pull request/i);
    expect(md).toMatch(/don't (stall|stop) at a local commit/i);
  });

  it("carries the must-follow rules: conventional format, secret-scan, no AI attribution", () => {
    const md = renderBundle(bundle());
    expect(md).toContain("Conventional Commits");
    expect(md).toMatch(/scan the diff for secrets/i);
    expect(md).toContain("Co-Authored-By");
    expect(md).toMatch(/do \*\*not\*\* add `Co-Authored-By` or any AI\/Claude attribution/i);
  });

  it("interpolates the issue key into the commit-message example", () => {
    const md = renderBundle(bundle({ key: "ACME-1" }));
    expect(md).toContain("`type(scope): ACME-1 subject`");
    expect(md).not.toContain("PROG-62");
  });
});

describe("renderBundle — determinism", () => {
  it("renders byte-for-byte identically across calls", () => {
    expect(renderBundle(bundle())).toBe(renderBundle(bundle()));
  });
});
