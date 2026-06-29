// Tests for the context-bundle "copy as prompt" work order (PROG-17/PROG-62).
// Run with `bun test`. Focus: the embedded smart-commit guidance and that the
// render stays deterministic.
import { describe, expect, it } from "bun:test";
import {
  renderArcBundle,
  renderBundle,
  type ArcBundleData,
  type ArcIssueData,
  type BundleData,
} from "./bundle";

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

  it("steers append-only docs (DECISIONS.md) to issue-keyed ids to avoid parallel-agent races", () => {
    const md = renderBundle(bundle({ key: "ACME-7" }));
    expect(md).toContain("Avoiding merge collisions");
    expect(md).toContain("docs/DECISIONS.md");
    // The decision heading example is keyed to this issue, not a global D<n>.
    expect(md).toContain("### ACME-7 — <title>");
    expect(md).toMatch(/never claim the next global running number/i);
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

// ---------- arc work order ----------

const arcIssue = (over: Partial<ArcIssueData> = {}): ArcIssueData => ({
  key: "PROG-1",
  issue: {
    title: "First issue",
    status: "todo",
    priority: "high",
    estimate: 2,
    dueDate: null,
    description: "Do the first thing.",
  } as ArcIssueData["issue"],
  repo: null,
  tags: [],
  comments: [],
  pullRequests: [],
  commits: [],
  ...over,
});

const arcBundle = (over: Partial<ArcBundleData> = {}): ArcBundleData => ({
  arc: { name: "Broaden & Due dates", description: "Why this epic exists." } as ArcBundleData["arc"],
  product: { name: "Progress", description: "A personal tracker." } as ArcBundleData["product"],
  issues: [arcIssue(), arcIssue({ key: "PROG-2", issue: { title: "Second issue", status: "in_progress", priority: "medium", estimate: null, dueDate: null, description: "Do the second thing." } as ArcIssueData["issue"] })],
  baseUrl: "https://example.test",
  ...over,
});

describe("renderArcBundle — coverage", () => {
  it("includes every open issue as its own section with the key and title", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("### PROG-1 — First issue");
    expect(md).toContain("### PROG-2 — Second issue");
    expect(md).toContain("## Issues (2)");
    expect(md).toContain("**Issue keys:** PROG-1, PROG-2");
  });

  it("carries the arc 'why' and product context once at the top", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("# Arc — Broaden & Due dates");
    expect(md).toContain("## Why this arc");
    expect(md).toContain("Why this epic exists.");
    expect(md).toContain("## Product context");
  });

  it("handles an arc with no open issues without crashing", () => {
    const md = renderArcBundle(arcBundle({ issues: [] }));
    expect(md).toContain("## Issues (0)");
    expect(md).toContain("_No open issues in this arc._");
  });
});

describe("renderArcBundle — combined-PR orchestration", () => {
  it("tells the agent to fan work out to sub-agents", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toMatch(/sub-agent/i);
    expect(md).toContain("## How to deliver this work");
  });

  it("demands ONE combined PR naming every key, not a PR per issue", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toMatch(/single pull request/i);
    expect(md).toMatch(/Open ONE pull request/);
    expect(md).toMatch(/Do not open a PR per issue/i);
    expect(md).toContain("PROG-1, PROG-2");
  });

  it("keeps the must-follow commit rules: conventional, secret-scan, no AI attribution", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("Conventional Commits");
    expect(md).toMatch(/scan the diff for secrets/i);
    expect(md).toMatch(/do \*\*not\*\* add `Co-Authored-By` or any AI\/Claude attribution/i);
  });
});

describe("renderArcBundle — determinism", () => {
  it("renders byte-for-byte identically across calls", () => {
    expect(renderArcBundle(arcBundle())).toBe(renderArcBundle(arcBundle()));
  });
});
