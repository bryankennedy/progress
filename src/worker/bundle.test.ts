// Tests for the context-bundle "copy as prompt" work order (PROG-17/PROG-62).
// Run with `bun test`. Focus: the embedded smart-commit guidance and that the
// render stays deterministic.
import { describe, expect, it } from "bun:test";
import {
  renderArcBundle,
  renderBundle,
  type ArcBundleData,
  type ArcActionData,
  type BundleData,
} from "./bundle";

// Minimal bundle — only the fields renderBundle reads, cast to the row types.
const bundle = (over: Partial<BundleData> = {}): BundleData => ({
  key: "PROG-62",
  action: {
    title: "Embed smart-commit in the bundle",
    status: "in_progress",
    priority: "urgent",
    estimate: null,
    dueDate: null,
    description: "Make the copy-as-prompt output follow the commit rules.",
  } as BundleData["action"],
  focus: { name: "Progress", description: "A personal tracker." } as BundleData["focus"],
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
    expect(md).toContain("**Push the PR against `main`**");
  });

  it("tells the agent to push a PR rather than stall at a local commit", () => {
    const md = renderBundle(bundle());
    expect(md).toMatch(/open a pull request/i);
    expect(md).toMatch(/don't (stall|stop) at a local commit/i);
  });

  it("steers decisions to this action's own file to avoid parallel-agent races (PROG-91)", () => {
    const md = renderBundle(bundle({ key: "ACME-7" }));
    expect(md).toContain("Avoiding merge collisions");
    // One file per work element: the agent writes ITS action's file.
    expect(md).toContain("docs/decisions/ACME-7.md");
    // The decision heading example is keyed to this action, not a global D<n>.
    expect(md).toContain("### ACME-7 — <title>");
    expect(md).toMatch(/never append to a shared log or claim the next global running number/i);
    // The frozen legacy log and other actions' files are off-limits.
    expect(md).toContain("docs/decisions/D1-D49.md");
  });

  it("carries the must-follow rules: conventional format, secret-scan, no AI attribution", () => {
    const md = renderBundle(bundle());
    expect(md).toContain("Conventional Commits");
    expect(md).toMatch(/scan the diff for secrets/i);
    expect(md).toContain("Co-Authored-By");
    expect(md).toMatch(/do \*\*not\*\* add `Co-Authored-By` or any AI\/Claude attribution/i);
  });

  it("interpolates the action key into the commit-message example", () => {
    const md = renderBundle(bundle({ key: "ACME-1" }));
    expect(md).toContain("`type(scope): ACME-1 subject`");
    expect(md).not.toContain("PROG-62");
  });
});

describe("renderBundle — branch off main (PROG-95)", () => {
  it("opens the report-back with branching off fresh main, key interpolated", () => {
    const md = renderBundle(bundle({ key: "ACME-9" }));
    expect(md).toContain("**Branch off fresh `main`**");
    expect(md).toContain("`git fetch origin && git checkout -b act/ACME-9 origin/main`");
  });

  it("forbids basing on another feature branch unless explicitly directed", () => {
    const md = renderBundle(bundle());
    expect(md).toMatch(/never branch off another feature branch unless explicitly directed/i);
  });

  it("requires the PR itself to target main", () => {
    const md = renderBundle(bundle());
    expect(md).toContain("--base main");
    expect(md).toMatch(/based on `main`/i);
  });

  it("states the identical rule (with its why) in the action and arc orders", () => {
    const rule =
      "never branch off another feature branch unless explicitly directed — a PR based on a feature branch can land after its base has already merged, stranding the work off `main` (PROG-95)";
    expect(renderBundle(bundle())).toContain(rule);
    expect(renderArcBundle(arcBundle())).toContain(rule);
  });
});

describe("renderBundle — determinism", () => {
  it("renders byte-for-byte identically across calls", () => {
    expect(renderBundle(bundle())).toBe(renderBundle(bundle()));
  });
});

// ---------- arc work order ----------

const arcAction = (over: Partial<ArcActionData> = {}): ArcActionData => ({
  key: "PROG-1",
  action: {
    title: "First action",
    status: "todo",
    priority: "high",
    estimate: 2,
    dueDate: null,
    description: "Do the first thing.",
  } as ArcActionData["action"],
  repo: null,
  tags: [],
  comments: [],
  pullRequests: [],
  commits: [],
  ...over,
});

const arcBundle = (over: Partial<ArcBundleData> = {}): ArcBundleData => ({
  arc: {
    name: "Broaden & Due dates",
    description: "Why this epic exists.",
  } as ArcBundleData["arc"],
  focus: { name: "Progress", description: "A personal tracker." } as ArcBundleData["focus"],
  actions: [
    arcAction(),
    arcAction({
      key: "PROG-2",
      action: {
        title: "Second action",
        status: "in_progress",
        priority: "medium",
        estimate: null,
        dueDate: null,
        description: "Do the second thing.",
      } as ArcActionData["action"],
    }),
  ],
  baseUrl: "https://example.test",
  ...over,
});

describe("renderArcBundle — coverage", () => {
  it("includes every open action as its own section with the key and title", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("### PROG-1 — First action");
    expect(md).toContain("### PROG-2 — Second action");
    expect(md).toContain("## Actions (2)");
    expect(md).toContain("**Action keys:** PROG-1, PROG-2");
  });

  it("carries the arc 'why' and focus context once at the top", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("# Arc — Broaden & Due dates");
    expect(md).toContain("## Why this arc");
    expect(md).toContain("Why this epic exists.");
    expect(md).toContain("## Focus context");
  });

  it("handles an arc with no open actions without crashing", () => {
    const md = renderArcBundle(arcBundle({ actions: [] }));
    expect(md).toContain("## Actions (0)");
    expect(md).toContain("_No open actions in this arc._");
  });
});

describe("renderArcBundle — combined-PR orchestration", () => {
  it("tells the agent to fan work out to sub-agents", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toMatch(/sub-agent/i);
    expect(md).toContain("## How to deliver this work");
  });

  it("demands ONE combined PR naming every key, not a PR per action", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toMatch(/single pull request/i);
    expect(md).toMatch(/Open ONE pull request/);
    expect(md).toMatch(/Do not open a PR per action/i);
    expect(md).toContain("PROG-1, PROG-2");
  });

  it("keeps the must-follow commit rules: conventional, secret-scan, no AI attribution", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("Conventional Commits");
    expect(md).toMatch(/scan the diff for secrets/i);
    expect(md).toMatch(/do \*\*not\*\* add `Co-Authored-By` or any AI\/Claude attribution/i);
  });

  it("creates the shared arc branch off fresh main and PRs against main (PROG-95)", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("**Share one branch, created off fresh `main`**");
    expect(md).toContain("from `origin/main`");
    expect(md).toMatch(/never branch off another feature branch unless explicitly directed/i);
    expect(md).toContain("--base main");
  });
});

describe("renderArcBundle — determinism", () => {
  it("renders byte-for-byte identically across calls", () => {
    expect(renderArcBundle(arcBundle())).toBe(renderArcBundle(arcBundle()));
  });
});
