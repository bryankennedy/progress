// ---------- context bundle rendering (SPEC §11.1, PROG-17) ----------
//
// The "copy as prompt" / `get_bundle` work order. Extracted from the worker
// entry so it can be unit-tested in isolation (PROG-62).

import type { arcs, commitLinks, issues, prLinks, products, repos } from "../db/schema";

export type BundleData = {
  key: string;
  issue: typeof issues.$inferSelect;
  product: typeof products.$inferSelect;
  repo: typeof repos.$inferSelect | null;
  arc: typeof arcs.$inferSelect | null;
  tags: string[];
  comments: { body: string; createdAt: Date; author: string }[];
  pullRequests: (typeof prLinks.$inferSelect)[];
  commits: (typeof commitLinks.$inferSelect)[];
  // Origin for resolving relative `/api/images/...` refs to absolute URLs an
  // agent (MCP/CLI, bearer-authed) can actually fetch (PROG-42).
  baseUrl: string;
};

// Pull markdown image targets out of a body, resolving app-relative paths to
// absolute URLs. Used to give the agent bundle an explicit "Images" list.
const IMAGE_MD_RE = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
function extractImageUrls(text: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMAGE_MD_RE)) {
    const ref = m[1]!;
    out.push(ref.startsWith("/") ? baseUrl + ref : ref);
  }
  return out;
}

// Shared, deterministic formatters (no Date.now / locale) so the issue and arc
// bundles render byte-for-byte identically — see the note on renderBundle.
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const para = (text: string, fallback = "_None._") => (text.trim() ? text.trim() : fallback);

// The PROG-95 branch-hygiene rule, phrased once and shared by the issue and
// arc work orders so the two can't drift into a looser-sounding variant.
const noFeatureBranchBases =
  "never branch off another feature branch unless explicitly directed — a PR based on a feature branch can land after its base has already merged, stranding the work off `main` (PROG-95)";

// Deterministic: every value comes from the row data (no Date.now / locale),
// and collections arrive pre-sorted, so the same issue always renders byte
// for byte the same — important for a "copy as prompt" artifact and for
// diffing what an agent was handed.
export function renderBundle(b: BundleData): string {
  const { issue } = b;
  const day = isoDay;
  const out: string[] = [];

  out.push(`# ${b.key} — ${issue.title}`, "");
  out.push(`- **Status:** ${issue.status}`);
  out.push(`- **Priority:** ${issue.priority}`);
  out.push(
    `- **Estimate:** ${
      issue.estimate === null ? "unestimated" : `${issue.estimate} point${issue.estimate === 1 ? "" : "s"}`
    }`,
  );
  if (issue.dueDate) out.push(`- **Due:** ${issue.dueDate}`);
  if (b.tags.length) out.push(`- **Tags:** ${b.tags.join(", ")}`);
  out.push("");

  out.push("## Description", "", para(issue.description, "_No description._"), "");

  // Lineage product → repo → arc, descriptions included — the arc description
  // is where epic-level intent ("why") lives, so the agent sees it.
  out.push("## Context", "");
  out.push(`**Product — ${b.product.name}**`, "");
  if (b.product.description.trim()) out.push(b.product.description.trim(), "");
  if (b.repo) {
    out.push(`**Repo — ${b.repo.name}**${b.repo.gitUrl ? ` (git: ${b.repo.gitUrl})` : ""}`, "");
    if (b.repo.description.trim()) out.push(b.repo.description.trim(), "");
  }
  if (b.arc) {
    out.push(`**Arc — ${b.arc.name}**`, "");
    if (b.arc.description.trim()) out.push(b.arc.description.trim(), "");
  }

  out.push(`## Comments (${b.comments.length})`, "");
  if (b.comments.length === 0) out.push("_None._", "");
  else
    for (const cm of b.comments) out.push(`**${cm.author}** · ${day(cm.createdAt)}`, "", para(cm.body), "");

  // Images embedded in the description/comments, as absolute URLs (PROG-42) — a
  // vision-capable agent (bearer-authed via MCP/CLI) can fetch these for context.
  const imageUrls = [
    ...new Set([
      ...extractImageUrls(issue.description, b.baseUrl),
      ...b.comments.flatMap((cm) => extractImageUrls(cm.body, b.baseUrl)),
    ]),
  ];
  out.push(`## Images (${imageUrls.length})`, "");
  if (imageUrls.length === 0) out.push("_None._", "");
  else {
    for (const u of imageUrls) out.push(`- ${u}`);
    out.push("");
  }

  out.push(`## Linked pull requests (${b.pullRequests.length})`, "");
  if (b.pullRequests.length === 0) out.push("_None._");
  else
    for (const pr of b.pullRequests)
      out.push(`- [${pr.state}] **#${pr.prNumber}** ${pr.title} — ${pr.url} (${pr.githubRepo})`);
  out.push("");

  out.push(`## Linked commits (${b.commits.length})`, "");
  if (b.commits.length === 0) out.push("_None._");
  else
    for (const cm of b.commits)
      out.push(`- \`${cm.sha.slice(0, 10)}\` ${cm.message} — ${cm.url} (${cm.githubRepo})`);
  out.push("");

  // Stable report-back preamble (SPEC §11.1): how an agent feeds work back so
  // it lands on this issue. The git convention works today via the §5 webhook;
  // comment/status report-back rides the API/MCP surface (PROG-18).
  out.push("---", "", "## How to report back", "");
  out.push(
    `You are working on **${b.key}** (${issue.title}).`,
    "",
    `1. **Branch off fresh \`main\`** — \`git fetch origin && git checkout -b iss/${b.key} origin/main\`; ${noFeatureBranchBases}.`,
    `2. Mention **${b.key}** in commit messages and the PR title/body. Progress auto-links branches, commits, and PRs that name the key (the branch from item 1 already does), so the work appears on this issue with no extra step.`,
    `3. Post progress notes as a comment on **${b.key}** and move its status as you go (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools.`,
    `4. Keep this issue the source of truth — if scope changes, leave a comment rather than silently diverging.`,
    "",
  );
  // A local, key-aware copy of the owner's smart-commit skill (PROG-62) so a
  // handed-off agent crafts commits/PRs to the owner's rules without needing the
  // skill installed. The conventional-commit example interpolates the key, which
  // both reinforces auto-linking (item 1) and matches the prod git history.
  out.push("### Committing & PRs", "");
  out.push(
    "Split the working tree into logical commits, then push a PR for review — don't stall at a local commit:",
    "",
    "1. **Analyze** — `git status` and `git diff` (incl. `--cached`) to see exactly what changed.",
    "2. **Security check** — scan the diff for secrets, API keys, passwords, tokens, or PII. If you find any, **STOP**, do not commit, and flag it.",
    "3. **Plan** — one commit per logical unit of work; keep unrelated changes in separate commits.",
    `4. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/): \`type(scope): ${b.key} subject\` (types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert). Subject in imperative mood, no trailing period; the body explains *why* (context), *what* (the change), and any side effects. Do **not** add \`Co-Authored-By\` or any AI/Claude attribution.`,
    "5. **Verify** — `git status` and `git log` to confirm the history is clean and complete.",
    `6. **Push the PR against \`main\`** — once the work is functioning and verified, push the branch and open a pull request **based on \`main\`** (\`gh pr create --base main …\`; never another feature branch — PROG-95), title/body naming **${b.key}**, for review. The work isn't handed off until the PR is up, so don't stop at a local commit. Then move **${b.key}** to \`in_review\` (item 3).`,
    "",
  );
  // Multiple agents often work different issues against this repo in parallel,
  // so anything shared and appended-to (a log file, a running counter) races.
  // The decision log is one file per work element (PROG-91), so tell the agent
  // to write ITS issue's file — different issues touch different files and
  // can't collide.
  out.push("### Avoiding merge collisions (parallel agents)", "");
  out.push(
    `Other agents may be editing this repo on other issues at the same time. Never append to a shared log or claim the next global running number — both race. Scope shared-doc writes to this issue instead:`,
    "",
    `- **Decisions** go in \`docs/decisions/${b.key}.md\` (create it), headed \`### ${b.key} — <title>\`; a second decision for the same issue appends there with a letter suffix (\`### ${b.key}b — …\`). Do not edit \`docs/DECISIONS.md\`, other issues' files, or the frozen \`docs/decisions/D1-D49.md\` — supersede a settled entry by naming it from your own file.`,
    `- Same rule for any other shared log keyed by a running counter: derive the id from **${b.key}**, not a shared sequence.`,
    `- If a merge conflict still appears in a shared file, it's a "keep both entries" resolution — never renumber or drop the other agent's entry.`,
    "",
  );
  return out.join("\n");
}

// ---------- arc-level work order (PROG: arc "copy as prompt") ----------
//
// One Markdown prompt covering every OPEN issue in an arc (closed = done /
// canceled are dropped), so the owner can hand a whole epic to a lead agent
// that fans the issues out to sub-agents and lands them in ONE combined PR.
// Built from the same row data and shaped to match the issue bundle, so a
// reader (and the sub-agents) sees each issue in the familiar format.

export type ArcIssueData = {
  key: string;
  issue: typeof issues.$inferSelect;
  repo: typeof repos.$inferSelect | null;
  tags: string[];
  comments: { body: string; createdAt: Date; author: string }[];
  pullRequests: (typeof prLinks.$inferSelect)[];
  commits: (typeof commitLinks.$inferSelect)[];
};

export type ArcBundleData = {
  arc: typeof arcs.$inferSelect;
  product: typeof products.$inferSelect;
  // Pre-filtered to open issues and pre-sorted (status, then number) by the
  // caller, so the render is deterministic and the caller owns "what's open".
  issues: ArcIssueData[];
  baseUrl: string;
};

// The full per-issue section — the issue bundle's body (fields, description,
// comments, images, linked PRs/commits) at one heading level deeper, minus the
// per-issue report-back footer (the arc has a single combined one). Repo is
// rendered per issue because issues in one arc can target different repos.
function renderArcIssueSection(b: ArcIssueData, baseUrl: string): string[] {
  const { issue } = b;
  const out: string[] = [];

  out.push(`### ${b.key} — ${issue.title}`, "");
  out.push(`- **Status:** ${issue.status}`);
  out.push(`- **Priority:** ${issue.priority}`);
  out.push(
    `- **Estimate:** ${
      issue.estimate === null ? "unestimated" : `${issue.estimate} point${issue.estimate === 1 ? "" : "s"}`
    }`,
  );
  if (issue.dueDate) out.push(`- **Due:** ${issue.dueDate}`);
  if (b.repo) out.push(`- **Repo:** ${b.repo.name}${b.repo.gitUrl ? ` (git: ${b.repo.gitUrl})` : ""}`);
  if (b.tags.length) out.push(`- **Tags:** ${b.tags.join(", ")}`);
  out.push("");

  out.push("#### Description", "", para(issue.description, "_No description._"), "");

  out.push(`#### Comments (${b.comments.length})`, "");
  if (b.comments.length === 0) out.push("_None._", "");
  else for (const cm of b.comments) out.push(`**${cm.author}** · ${isoDay(cm.createdAt)}`, "", para(cm.body), "");

  const imageUrls = [
    ...new Set([
      ...extractImageUrls(issue.description, baseUrl),
      ...b.comments.flatMap((cm) => extractImageUrls(cm.body, baseUrl)),
    ]),
  ];
  out.push(`#### Images (${imageUrls.length})`, "");
  if (imageUrls.length === 0) out.push("_None._", "");
  else {
    for (const u of imageUrls) out.push(`- ${u}`);
    out.push("");
  }

  out.push(`#### Linked pull requests (${b.pullRequests.length})`, "");
  if (b.pullRequests.length === 0) out.push("_None._");
  else
    for (const pr of b.pullRequests)
      out.push(`- [${pr.state}] **#${pr.prNumber}** ${pr.title} — ${pr.url} (${pr.githubRepo})`);
  out.push("");

  out.push(`#### Linked commits (${b.commits.length})`, "");
  if (b.commits.length === 0) out.push("_None._");
  else
    for (const cm of b.commits) out.push(`- \`${cm.sha.slice(0, 10)}\` ${cm.message} — ${cm.url} (${cm.githubRepo})`);
  out.push("");

  return out;
}

// Deterministic like renderBundle: every value comes from the row data, and the
// caller pre-sorts the issue list, so the same arc renders byte-for-byte the
// same.
export function renderArcBundle(b: ArcBundleData): string {
  const { arc, product, issues: list } = b;
  const out: string[] = [];
  const keys = list.map((i) => i.key);

  out.push(`# Arc — ${arc.name}`, "");
  out.push(`- **Product:** ${product.name}`);
  out.push(`- **Open issues:** ${list.length}`);
  if (keys.length) out.push(`- **Issue keys:** ${keys.join(", ")}`);
  out.push("");

  // Arc description is the epic-level "why"; product description gives the
  // surrounding context. Both up top so they're stated once for the whole run.
  out.push("## Why this arc", "", para(arc.description, "_No description._"), "");
  out.push("## Product context", "", `**${product.name}**`, "");
  if (product.description.trim()) out.push(product.description.trim(), "");

  out.push(`## Issues (${list.length})`, "");
  if (list.length === 0) out.push("_No open issues in this arc._", "");
  else for (const it of list) out.push(...renderArcIssueSection(it, b.baseUrl));

  // Combined-PR orchestration (the arc analogue of the issue report-back
  // preamble). Differs from the per-issue flow on purpose: the issues here are
  // meant to ship together, so it's ONE shared branch and ONE PR naming every
  // key, not a branch/PR per issue.
  out.push("---", "", "## How to deliver this work", "");
  out.push(
    `You're taking on the whole **${arc.name}** arc — the ${list.length} open issue${
      list.length === 1 ? "" : "s"
    } above${keys.length ? ` (${keys.join(", ")})` : ""}. Drive them as one coordinated change that lands in a **single pull request**.`,
    "",
    `1. **Plan the split.** Read every issue above and decide a sensible division of labor. Watch for issues that touch the same files or depend on each other — sequence or group those so sub-agents don't fight over the same code.`,
    `2. **Fan out to sub-agents.** Spin up one sub-agent per issue (or per independent group) and have each implement its issue. Give each sub-agent that issue's section above as its brief, and tell it to fetch more detail from the Progress API / MCP tools (\`get_bundle <KEY>\`) if it needs it.`,
    `3. **Share one branch, created off fresh \`main\`** — \`git fetch origin\` then branch the arc's single feature branch from \`origin/main\` (e.g. \`arc/${arc.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}\`); ${noFeatureBranchBases}. All sub-agents work toward that one branch. Mention the relevant issue key in each commit so Progress auto-links the work back to the right issue.`,
    `4. **Integrate and verify.** Once the sub-agents finish, reconcile their work on the shared branch, resolve any conflicts, and make sure the whole thing builds, type-checks, and passes tests **together** — not just issue-by-issue.`,
    `5. **Open ONE pull request** for the arc whose title/body names every issue key (${
      keys.length ? keys.join(", ") : "the keys above"
    }). Do not open a PR per issue.`,
    `6. **Update each issue** as you go — post a progress comment and move its status (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools. Keep each issue the source of truth; if scope changes, comment rather than silently diverging.`,
    "",
  );

  // Same smart-commit rules as the issue bundle (PROG-62), but the commit-scope
  // example is keyed to whichever issue a given commit advances.
  out.push("### Committing & PRs", "");
  out.push(
    "Split the working tree into logical commits, then push the single arc PR — don't stall at a local commit:",
    "",
    "1. **Analyze** — `git status` and `git diff` (incl. `--cached`) to see exactly what changed.",
    "2. **Security check** — scan the diff for secrets, API keys, passwords, tokens, or PII. If you find any, **STOP**, do not commit, and flag it.",
    "3. **Plan** — one commit per logical unit of work; keep unrelated changes in separate commits, and name the issue key the commit advances.",
    "4. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): KEY subject` (types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert), where `KEY` is the issue that commit advances. Subject in imperative mood, no trailing period; the body explains *why* (context), *what* (the change), and any side effects. Do **not** add `Co-Authored-By` or any AI/Claude attribution.",
    "5. **Verify** — `git status` and `git log` to confirm the history is clean and complete.",
    `6. **Push the one PR against \`main\`** — once the whole arc is functioning and verified, push the shared branch and open a single pull request **based on \`main\`** (\`gh pr create --base main …\`; never another feature branch — PROG-95), title/body naming ${
      keys.length ? keys.join(", ") : "every issue key"
    }, for review. The work isn't handed off until that PR is up. Then move each issue to \`in_review\`.`,
    "",
  );

  // Multiple sub-agents now edit the SAME repo and branch at once, so the
  // shared-doc race is sharper here than for a lone issue agent. Decisions are
  // one file per work element (PROG-91): each sub-agent writes its own issue's
  // file and the files can't collide.
  out.push("### Avoiding merge collisions (parallel sub-agents)", "");
  out.push(
    `Your sub-agents are editing the same repo and branch simultaneously. Never append to a shared log or claim the next global running number — both race. Scope shared-doc writes to the issue they belong to:`,
    "",
    "- **Decisions** go in `docs/decisions/<KEY>.md` (create it), headed `### KEY — <title>`, where `KEY` is the issue the decision came from; a second decision for the same issue appends there with a letter suffix (`### KEYb — …`). Do not edit `docs/DECISIONS.md`, other issues' files, or the frozen `docs/decisions/D1-D49.md` — supersede a settled entry by naming it from your own file.",
    "- Same rule for any other shared log keyed by a running counter: derive the id from the issue key, not a shared sequence.",
    `- If a merge conflict still appears in a shared file, it's a "keep both entries" resolution — never renumber or drop another sub-agent's entry.`,
    "",
  );

  return out.join("\n");
}
