// Tests for the context-bundle "copy as prompt" work order (PROG-17/PROG-62/
// PROG-112). Run with `bun test`. Focus: the embedded smart-commit guidance,
// the PROG-112 shape rules (empty sections omitted, Step lineage, repo-less
// degrade), and that the render stays deterministic.
import { describe, expect, it } from "bun:test";
import {
  renderArcBundle,
  renderBundle,
  type ArcBundleData,
  type ArcActionData,
  type BundleData,
} from "./bundle";

// Minimal bundle — only the fields renderBundle reads, cast to the row types.
// gitUrl is set by default; the repo-less degrade has its own tests.
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
  focus: {
    name: "Progress",
    description: "A personal tracker.",
    gitUrl: "https://github.com/owner/progress",
  } as BundleData["focus"],
  arc: null,
  parents: [],
  steps: [],
  tags: [],
  comments: [],
  pullRequests: [],
  commits: [],
  baseUrl: "https://example.test",
  ...over,
});

describe("renderBundle — Committing & PRs (smart-commit)", () => {
  it("embeds the commit-flow steps", () => {
    const md = renderBundle(bundle());
    expect(md).toContain("### Committing & PRs");
    expect(md).toContain("**Security check**");
    expect(md).toContain("**Commit**");
    expect(md).toContain("**Verify**");
    expect(md).toContain("**Push the PR against `main`**");
  });

  it("tells the agent to push a PR rather than stall at a local commit", () => {
    const md = renderBundle(bundle());
    expect(md).toMatch(/open a pull request/i);
    expect(md).toMatch(/don't (stall|stop) at a local commit/i);
  });

  it("tells the agent to run the repo's own checks before pushing (PROG-112)", () => {
    const md = renderBundle(bundle());
    expect(md).toMatch(/run the repo's own checks \(tests, typecheck, lint\/format/i);
    expect(md).toMatch(/fix what breaks before pushing/i);
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
    expect(md).toMatch(/scan the full diff for secrets/i);
    expect(md).toContain("Co-Authored-By");
    // The ban covers the PR body too — the harness adds a "Generated with
    // Claude Code" footer by default, so it needs its own explicit override.
    expect(md).toContain('"Generated with Claude Code"');
    expect(md).toMatch(/not to commits, and not to the PR body/i);
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

describe("renderBundle — repo-less focus degrade (PROG-112)", () => {
  const repoless = () =>
    bundle({
      focus: {
        name: "Household",
        description: "Home things.",
        gitUrl: null,
      } as BundleData["focus"],
    });

  it("keeps the comment-and-status report-back", () => {
    const md = renderBundle(repoless());
    expect(md).toContain("## How to report back");
    expect(md).toContain("no linked git repository");
    expect(md).toMatch(/post progress notes as a comment/i);
    expect(md).toContain("`todo` → `in_progress` → `in_review` → `done`");
    expect(md).toMatch(/source of truth/i);
  });

  it("drops the branch/commit/PR/decision-log machinery", () => {
    const md = renderBundle(repoless());
    expect(md).not.toContain("Branch off fresh");
    expect(md).not.toContain("### Committing & PRs");
    expect(md).not.toContain("Avoiding merge collisions");
    expect(md).not.toContain("docs/decisions");
    expect(md).not.toContain("--base main");
  });
});

describe("renderBundle — omit what isn't there (PROG-112)", () => {
  it("renders no section at all for empty comments/images/PRs/commits", () => {
    const md = renderBundle(bundle());
    expect(md).not.toContain("## Comments");
    expect(md).not.toContain("## Images");
    expect(md).not.toContain("## Linked pull requests");
    expect(md).not.toContain("## Linked commits");
    expect(md).not.toContain("_None._");
  });

  it("renders comments with author and ISO day when present", () => {
    const md = renderBundle(
      bundle({
        comments: [{ body: "Ship it.", createdAt: new Date("2026-08-01T12:00:00Z"), author: "B" }],
      }),
    );
    expect(md).toContain("## Comments (1)");
    expect(md).toContain("**B** · 2026-08-01");
    expect(md).toContain("Ship it.");
  });

  it("omits unset estimate and priority none, keeps them when set", () => {
    const md = renderBundle(bundle());
    expect(md).not.toContain("**Estimate:**");
    const set = renderBundle(
      bundle({
        action: {
          ...bundle().action,
          estimate: 1,
          priority: "none",
        } as BundleData["action"],
      }),
    );
    expect(set).toContain("- **Estimate:** 1 point");
    expect(set).not.toContain("**Priority:**");
  });

  it("resolves relative image refs against the base URL when images exist", () => {
    const md = renderBundle(
      bundle({
        action: {
          ...bundle().action,
          description: "See ![shot](/api/images/abc.png).",
        } as BundleData["action"],
      }),
    );
    expect(md).toContain("## Images (1)");
    expect(md).toContain("- https://example.test/api/images/abc.png");
  });
});

describe("renderBundle — Step lineage (PROG-112, gap from PROG-106)", () => {
  it("names the ancestor chain in Context, outermost first", () => {
    const md = renderBundle(
      bundle({
        parents: [
          { key: "PROG-100", title: "Big feature" },
          { key: "PROG-105", title: "Middle slice" },
        ],
      }),
    );
    expect(md).toContain(
      "**Step of:** PROG-100 — Big feature → PROG-105 — Middle slice (outermost first)",
    );
  });

  it("keeps a single parent plain, and says nothing for a top-level action", () => {
    const one = renderBundle(bundle({ parents: [{ key: "PROG-100", title: "Big feature" }] }));
    expect(one).toContain("**Step of:** PROG-100 — Big feature");
    expect(one).not.toContain("outermost");
    expect(renderBundle(bundle())).not.toContain("Step of");
  });

  it("lists child Steps with status after the description", () => {
    const md = renderBundle(
      bundle({
        steps: [
          { key: "PROG-140", title: "First slice", status: "done" },
          { key: "PROG-141", title: "Second slice", status: "todo" },
        ],
      }),
    );
    expect(md).toContain("## Steps (2)");
    expect(md).toContain("- [done] PROG-140 — First slice");
    expect(md).toContain("- [todo] PROG-141 — Second slice");
    expect(renderBundle(bundle())).not.toContain("## Steps");
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
  stepOf: null,
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
  focus: {
    name: "Progress",
    description: "A personal tracker.",
    gitUrl: "https://github.com/owner/progress",
  } as ArcBundleData["focus"],
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

  it("omits empty per-action sections and unset fields (PROG-112)", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).not.toContain("#### Comments");
    expect(md).not.toContain("#### Linked pull requests");
    expect(md).not.toContain("_None._");
    // PROG-1 has an estimate, PROG-2 doesn't — exactly one estimate line.
    expect(md.match(/\*\*Estimate:\*\*/g)?.length).toBe(1);
  });

  it("marks a Step with its parent so the lead agent can group them (PROG-112)", () => {
    const md = renderArcBundle(
      arcBundle({
        actions: [
          arcAction(),
          arcAction({ key: "PROG-2", stepOf: { key: "PROG-1", title: "First action" } }),
        ],
      }),
    );
    expect(md).toContain("- **Step of:** PROG-1 — First action");
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

  it("keeps the must-follow commit rules: conventional, secret-scan, checks, no AI attribution", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("Conventional Commits");
    expect(md).toMatch(/scan the full diff for secrets/i);
    expect(md).toMatch(/run the repo's own checks/i);
    expect(md).toContain('"Generated with Claude Code"');
    expect(md).toMatch(/not to commits, and not to the PR body/i);
  });

  it("creates the shared arc branch off fresh main and PRs against main (PROG-95)", () => {
    const md = renderArcBundle(arcBundle());
    expect(md).toContain("**Share one branch, created off fresh `main`**");
    expect(md).toContain("from `origin/main`");
    expect(md).toMatch(/never branch off another feature branch unless explicitly directed/i);
    expect(md).toContain("--base main");
  });

  it("drops the git machinery for a repo-less focus but keeps the fan-out (PROG-112)", () => {
    const md = renderArcBundle(
      arcBundle({
        focus: { name: "Household", description: "", gitUrl: null } as ArcBundleData["focus"],
      }),
    );
    expect(md).toContain("no linked git repository");
    expect(md).toMatch(/fan out to sub-agents/i);
    expect(md).toMatch(/post a progress comment/i);
    expect(md).not.toContain("### Committing & PRs");
    expect(md).not.toContain("Avoiding merge collisions");
    expect(md).not.toContain("--base main");
  });
});

describe("renderArcBundle — determinism", () => {
  it("renders byte-for-byte identically across calls", () => {
    expect(renderArcBundle(arcBundle())).toBe(renderArcBundle(arcBundle()));
  });
});
