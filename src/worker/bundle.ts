// ---------- context bundle rendering (SPEC §11.1, PROG-17) ----------
//
// The "copy as prompt" / `get_bundle` work order. Extracted from the worker
// entry so it can be unit-tested in isolation (PROG-62).
//
// PROG-112 shape rules (reviewed against the Aug-2026 Claude Code harness):
// every line costs the agent attention, so unset fields and empty collections
// are omitted rather than rendered as "(0) / _None._" placeholders — absence
// reads the same. Guidance the harness already follows by default (inspecting
// `git status`/`git diff` before committing) is not restated; guidance that
// *counters* a harness default (no AI attribution on commits or PR bodies) is
// stated explicitly, because the default wins unless overridden. A focus with
// no linked git repo gets a short comment-and-status report-back instead of
// branch/PR machinery it can't use.

import type { arcs, commitLinks, actions, prLinks, focuses } from "../db/schema";

export type BundleData = {
  key: string;
  action: typeof actions.$inferSelect;
  focus: typeof focuses.$inferSelect;
  arc: typeof arcs.$inferSelect | null;
  // Ancestor Step chain (PROG-112, closing the gap recorded in PROG-106):
  // outermost first, empty for a top-level action. Same-focus is API-enforced,
  // so ancestor keys share this focus's prefix.
  parents: { key: string; title: string }[];
  // Direct child Steps (all statuses — done ones show what's already handled),
  // sorted by number.
  steps: { key: string; title: string; status: string }[];
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

// Shared, deterministic formatters (no Date.now / locale) so the action and arc
// bundles render byte-for-byte identically — see the note on renderBundle.
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const para = (text: string, fallback = "_None._") => (text.trim() ? text.trim() : fallback);

// The PROG-95 branch-hygiene rule, phrased once and shared by the action and
// arc work orders so the two can't drift into a looser-sounding variant.
const noFeatureBranchBases =
  "never branch off another feature branch unless explicitly directed — a PR based on a feature branch can land after its base has already merged, stranding the work off `main` (PROG-95)";

// Commit-flow steps shared verbatim by the action and arc orders. The
// attribution ban covers the PR body too, not just commit trailers — the
// Claude Code harness adds both by default, so each needs its own explicit
// override.
const securityCheckStep =
  "**Security check** — scan the full diff for secrets, API keys, passwords, tokens, or PII. If you find any, **STOP**, do not commit, and flag it.";
const runChecksStep =
  "**Verify** — run the repo's own checks (tests, typecheck, lint/format — see its CLAUDE.md or package.json scripts) and fix what breaks before pushing.";
const noAttribution =
  'Do **not** add `Co-Authored-By`, a "Generated with Claude Code" footer, or any other AI/Claude attribution — not to commits, and not to the PR body';

// Action metadata bullets: one line per SET field. Unset fields (no estimate,
// priority "none", no due date, no tags) are omitted, not rendered as noise.
function metaLines(action: BundleData["action"], tags: string[]): string[] {
  const out: string[] = [`- **Status:** ${action.status}`];
  if (action.priority !== "none") out.push(`- **Priority:** ${action.priority}`);
  if (action.estimate !== null)
    out.push(`- **Estimate:** ${action.estimate} point${action.estimate === 1 ? "" : "s"}`);
  if (action.dueDate) out.push(`- **Due:** ${action.dueDate}`);
  if (tags.length) out.push(`- **Tags:** ${tags.join(", ")}`);
  return out;
}

// The per-action body sections shared by the action bundle (h = "##") and the
// arc bundle's per-action sections (h = "####"). Empty collections render
// nothing at all.
function commentsSection(
  h: string,
  comments: { body: string; createdAt: Date; author: string }[],
): string[] {
  if (comments.length === 0) return [];
  const out = [`${h} Comments (${comments.length})`, ""];
  for (const cm of comments)
    out.push(`**${cm.author}** · ${isoDay(cm.createdAt)}`, "", para(cm.body), "");
  return out;
}

// Images embedded in the description/comments, as absolute URLs (PROG-42) — a
// vision-capable agent (bearer-authed via MCP/CLI) can fetch these for context.
function imagesSection(
  h: string,
  description: string,
  comments: { body: string }[],
  baseUrl: string,
): string[] {
  const urls = [
    ...new Set([
      ...extractImageUrls(description, baseUrl),
      ...comments.flatMap((cm) => extractImageUrls(cm.body, baseUrl)),
    ]),
  ];
  if (urls.length === 0) return [];
  return [`${h} Images (${urls.length})`, "", ...urls.map((u) => `- ${u}`), ""];
}

function linkSections(
  h: string,
  pullRequests: BundleData["pullRequests"],
  commits: BundleData["commits"],
): string[] {
  const out: string[] = [];
  if (pullRequests.length) {
    out.push(`${h} Linked pull requests (${pullRequests.length})`, "");
    for (const pr of pullRequests)
      out.push(`- [${pr.state}] **#${pr.prNumber}** ${pr.title} — ${pr.url} (${pr.githubRepo})`);
    out.push("");
  }
  if (commits.length) {
    out.push(`${h} Linked commits (${commits.length})`, "");
    for (const cm of commits)
      out.push(`- \`${cm.sha.slice(0, 10)}\` ${cm.message} — ${cm.url} (${cm.githubRepo})`);
    out.push("");
  }
  return out;
}

// Deterministic: every value comes from the row data (no Date.now / locale),
// and collections arrive pre-sorted, so the same action always renders byte
// for byte the same — important for a "copy as prompt" artifact and for
// diffing what an agent was handed.
export function renderBundle(b: BundleData): string {
  const { action } = b;
  const out: string[] = [];
  const hasRepo = !!b.focus.gitUrl;

  out.push(`# ${b.key} — ${action.title}`, "");
  out.push(...metaLines(action, b.tags));
  out.push("");

  out.push("## Description", "", para(action.description, "_No description._"), "");

  // Direct child Steps, right after the description — they're part of the work
  // definition, not surrounding context.
  if (b.steps.length) {
    out.push(`## Steps (${b.steps.length})`, "");
    out.push("_Child actions of this one; fetch a Step's own bundle for its full context._", "");
    for (const s of b.steps) out.push(`- [${s.status}] ${s.key} — ${s.title}`);
    out.push("");
  }

  // Lineage focus → arc → parent chain, descriptions included — the arc
  // description is where epic-level intent ("why") lives, so the agent sees it.
  // The focus's optional git repo (PROG-102) rides the focus heading. A Step
  // also names what it's part of (PROG-106): ancestor chain, outermost first.
  out.push("## Context", "");
  out.push(`**Focus — ${b.focus.name}**${b.focus.gitUrl ? ` (git: ${b.focus.gitUrl})` : ""}`, "");
  if (b.focus.description.trim()) out.push(b.focus.description.trim(), "");
  if (b.arc) {
    out.push(`**Arc — ${b.arc.name}**`, "");
    if (b.arc.description.trim()) out.push(b.arc.description.trim(), "");
  }
  if (b.parents.length) {
    out.push(
      `**Step of:** ${b.parents.map((p) => `${p.key} — ${p.title}`).join(" → ")}${
        b.parents.length > 1 ? " (outermost first)" : ""
      }`,
      "",
    );
  }

  out.push(...commentsSection("##", b.comments));
  out.push(...imagesSection("##", action.description, b.comments, b.baseUrl));
  out.push(...linkSections("##", b.pullRequests, b.commits));

  // Stable report-back preamble (SPEC §11.1): how an agent feeds work back so
  // it lands on this action. The git convention works today via the §5 webhook;
  // comment/status report-back rides the API/MCP surface (PROG-18). A focus
  // with no linked repo (v2 household work) gets only the comment-and-status
  // flow — branch/PR/decision-log instructions would be noise it can't act on.
  out.push("---", "", "## How to report back", "");
  if (!hasRepo) {
    out.push(
      `You are working on **${b.key}** (${action.title}). This focus has no linked git repository, so there is no branch/PR flow — report back on the action itself:`,
      "",
      `1. Post progress notes as a comment on **${b.key}** and move its status as you go (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools.`,
      `2. Keep this action the source of truth — if scope changes, leave a comment rather than silently diverging.`,
      "",
    );
    return out.join("\n");
  }
  out.push(
    `You are working on **${b.key}** (${action.title}).`,
    "",
    `1. **Branch off fresh \`main\`** — \`git fetch origin && git checkout -b act/${b.key} origin/main\`; ${noFeatureBranchBases}.`,
    `2. Mention **${b.key}** in commit messages and the PR title/body. Progress auto-links branches, commits, and PRs that name the key (the branch from item 1 already does), so the work appears on this action with no extra step.`,
    `3. Post progress notes as a comment on **${b.key}** and move its status as you go (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools.`,
    `4. Keep this action the source of truth — if scope changes, leave a comment rather than silently diverging.`,
    "",
  );
  // A local, key-aware copy of the owner's smart-commit skill (PROG-62) so a
  // handed-off agent crafts commits/PRs to the owner's rules without needing the
  // skill installed. The conventional-commit example interpolates the key, which
  // both reinforces auto-linking (item 1) and matches the prod git history.
  out.push("### Committing & PRs", "");
  out.push(
    "Commit in logical units and push a PR for review — don't stall at a local commit:",
    "",
    `1. ${securityCheckStep}`,
    `2. **Commit** — one commit per logical unit of work (keep unrelated changes separate), using [Conventional Commits](https://www.conventionalcommits.org/): \`type(scope): ${b.key} subject\` (types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert). Subject in imperative mood, no trailing period; the body explains *why*. ${noAttribution}.`,
    `3. ${runChecksStep}`,
    `4. **Push the PR against \`main\`** — once the work passes its checks, push the branch and open a pull request **based on \`main\`** (\`gh pr create --base main …\`; never another feature branch — PROG-95), title/body naming **${b.key}**, for review. The work isn't handed off until the PR is up. Then move **${b.key}** to \`in_review\` (item 3 above).`,
    "",
  );
  // Multiple agents often work different actions against this repo in parallel,
  // so anything shared and appended-to (a log file, a running counter) races.
  // The decision log is one file per work element (PROG-91), so tell the agent
  // to write ITS action's file — different actions touch different files and
  // can't collide.
  out.push("### Avoiding merge collisions (parallel agents)", "");
  out.push(
    `Other agents may be editing this repo on other actions at the same time. Never append to a shared log or claim the next global running number — both race. Scope shared-doc writes to this action instead:`,
    "",
    `- **Decisions** go in \`docs/decisions/${b.key}.md\` (create it), headed \`### ${b.key} — <title>\`; a second decision for the same action appends there with a letter suffix (\`### ${b.key}b — …\`). Do not edit \`docs/DECISIONS.md\`, other actions' files, or the frozen \`docs/decisions/D1-D49.md\` — supersede a settled entry by naming it from your own file.`,
    `- Same rule for any other shared log keyed by a running counter: derive the id from **${b.key}**, not a shared sequence.`,
    `- If a merge conflict still appears in a shared file, it's a "keep both entries" resolution — never renumber or drop the other agent's entry.`,
    "",
  );
  return out.join("\n");
}

// ---------- arc-level work order (PROG: arc "copy as prompt") ----------
//
// One Markdown prompt covering every OPEN action in an arc (closed = done /
// canceled are dropped), so the owner can hand a whole epic to a lead agent
// that fans the actions out to sub-agents and lands them in ONE combined PR.
// Built from the same row data and shaped to match the action bundle, so a
// reader (and the sub-agents) sees each action in the familiar format.

export type ArcActionData = {
  key: string;
  action: typeof actions.$inferSelect;
  // The action's parent when it is a Step (PROG-112) — lets the lead agent
  // group a Step with its parent instead of treating it as free-standing work.
  stepOf: { key: string; title: string } | null;
  tags: string[];
  comments: { body: string; createdAt: Date; author: string }[];
  pullRequests: (typeof prLinks.$inferSelect)[];
  commits: (typeof commitLinks.$inferSelect)[];
};

export type ArcBundleData = {
  arc: typeof arcs.$inferSelect;
  focus: typeof focuses.$inferSelect;
  // Pre-filtered to open actions and pre-sorted (status, then number) by the
  // caller, so the render is deterministic and the caller owns "what's open".
  actions: ArcActionData[];
  baseUrl: string;
};

// The full per-action section — the action bundle's body (fields, description,
// comments, images, linked PRs/commits) at one heading level deeper, minus the
// per-action report-back footer (the arc has a single combined one). The git
// repo is a focus-level field now (PROG-102), so it's stated once in the arc's
// "Focus context", not per action.
function renderArcActionSection(b: ArcActionData, baseUrl: string): string[] {
  const { action } = b;
  const out: string[] = [];

  out.push(`### ${b.key} — ${action.title}`, "");
  out.push(...metaLines(action, b.tags));
  if (b.stepOf) out.push(`- **Step of:** ${b.stepOf.key} — ${b.stepOf.title}`);
  out.push("");

  out.push("#### Description", "", para(action.description, "_No description._"), "");
  out.push(...commentsSection("####", b.comments));
  out.push(...imagesSection("####", action.description, b.comments, baseUrl));
  out.push(...linkSections("####", b.pullRequests, b.commits));

  return out;
}

// Deterministic like renderBundle: every value comes from the row data, and the
// caller pre-sorts the action list, so the same arc renders byte-for-byte the
// same.
export function renderArcBundle(b: ArcBundleData): string {
  const { arc, focus, actions: list } = b;
  const out: string[] = [];
  const keys = list.map((i) => i.key);
  const hasRepo = !!focus.gitUrl;

  out.push(`# Arc — ${arc.name}`, "");
  out.push(`- **Focus:** ${focus.name}`);
  out.push(`- **Open actions:** ${list.length}`);
  if (keys.length) out.push(`- **Action keys:** ${keys.join(", ")}`);
  out.push("");

  // Arc description is the epic-level "why"; focus description gives the
  // surrounding context. Both up top so they're stated once for the whole run.
  out.push("## Why this arc", "", para(arc.description, "_No description._"), "");
  out.push(
    "## Focus context",
    "",
    `**${focus.name}**${focus.gitUrl ? ` (git: ${focus.gitUrl})` : ""}`,
    "",
  );
  if (focus.description.trim()) out.push(focus.description.trim(), "");

  out.push(`## Actions (${list.length})`, "");
  if (list.length === 0) out.push("_No open actions in this arc._", "");
  else for (const it of list) out.push(...renderArcActionSection(it, b.baseUrl));

  // Combined-PR orchestration (the arc analogue of the action report-back
  // preamble). Differs from the per-action flow on purpose: the actions here are
  // meant to ship together, so it's ONE shared branch and ONE PR naming every
  // key, not a branch/PR per action. A repo-less focus keeps the fan-out but
  // drops the git machinery it can't use.
  out.push("---", "", "## How to deliver this work", "");
  const takingOn = `You're taking on the whole **${arc.name}** arc — the ${list.length} open action${
    list.length === 1 ? "" : "s"
  } above${keys.length ? ` (${keys.join(", ")})` : ""}.`;
  if (!hasRepo) {
    out.push(
      `${takingOn} This focus has no linked git repository, so there is no branch/PR flow.`,
      "",
      `1. **Plan the split.** Read every action above and decide a sensible division of labor; a Step belongs with its parent. Sequence actions that depend on each other.`,
      `2. **Fan out to sub-agents.** Spin up one sub-agent per action (or per independent group) and give each that action's section above as its brief; it can fetch more via the Progress API / MCP tools (\`get_bundle <KEY>\`).`,
      `3. **Update each action** as you go — post a progress comment and move its status (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools. Keep each action the source of truth; if scope changes, comment rather than silently diverging.`,
      "",
    );
    return out.join("\n");
  }
  out.push(
    `${takingOn} Drive them as one coordinated change that lands in a **single pull request**.`,
    "",
    `1. **Plan the split.** Read every action above and decide a sensible division of labor. A Step belongs with its parent, and actions that touch the same files or depend on each other should be sequenced or grouped so sub-agents don't fight over the same code.`,
    `2. **Fan out to sub-agents.** Spin up one sub-agent per action (or per independent group) and have each implement its action. Give each sub-agent that action's section above as its brief, and tell it to fetch more detail from the Progress API / MCP tools (\`get_bundle <KEY>\`) if it needs it.`,
    `3. **Share one branch, created off fresh \`main\`** — \`git fetch origin\` then branch the arc's single feature branch from \`origin/main\` (e.g. \`arc/${arc.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(
        /^-+|-+$/g,
        "",
      )}\`); ${noFeatureBranchBases}. All sub-agents work toward that one branch. Mention the relevant action key in each commit so Progress auto-links the work back to the right action.`,
    `4. **Integrate and verify.** Once the sub-agents finish, reconcile their work on the shared branch, resolve any conflicts, and make sure the whole thing builds, type-checks, and passes tests **together** — not just action-by-action.`,
    `5. **Open ONE pull request** for the arc whose title/body names every action key (${
      keys.length ? keys.join(", ") : "the keys above"
    }). Do not open a PR per action.`,
    `6. **Update each action** as you go — post a progress comment and move its status (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools. Keep each action the source of truth; if scope changes, comment rather than silently diverging.`,
    "",
  );

  // Same smart-commit rules as the action bundle (PROG-62), but the commit-scope
  // example is keyed to whichever action a given commit advances.
  out.push("### Committing & PRs", "");
  out.push(
    "Commit in logical units and push the single arc PR — don't stall at a local commit:",
    "",
    `1. ${securityCheckStep}`,
    `2. **Commit** — one commit per logical unit of work (keep unrelated changes separate), using [Conventional Commits](https://www.conventionalcommits.org/): \`type(scope): KEY subject\` (types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert), where \`KEY\` is the action that commit advances. Subject in imperative mood, no trailing period; the body explains *why*. ${noAttribution}.`,
    `3. ${runChecksStep}`,
    `4. **Push the one PR against \`main\`** — once the whole arc passes its checks, push the shared branch and open a single pull request **based on \`main\`** (\`gh pr create --base main …\`; never another feature branch — PROG-95), title/body naming ${
      keys.length ? keys.join(", ") : "every action key"
    }, for review. The work isn't handed off until that PR is up. Then move each action to \`in_review\`.`,
    "",
  );

  // Multiple sub-agents now edit the SAME repo and branch at once, so the
  // shared-doc race is sharper here than for a lone action agent. Decisions are
  // one file per work element (PROG-91): each sub-agent writes its own action's
  // file and the files can't collide.
  out.push("### Avoiding merge collisions (parallel sub-agents)", "");
  out.push(
    `Your sub-agents are editing the same repo and branch simultaneously. Never append to a shared log or claim the next global running number — both race. Scope shared-doc writes to the action they belong to:`,
    "",
    "- **Decisions** go in `docs/decisions/<KEY>.md` (create it), headed `### KEY — <title>`, where `KEY` is the action the decision came from; a second decision for the same action appends there with a letter suffix (`### KEYb — …`). Do not edit `docs/DECISIONS.md`, other actions' files, or the frozen `docs/decisions/D1-D49.md` — supersede a settled entry by naming it from your own file.",
    "- Same rule for any other shared log keyed by a running counter: derive the id from the action key, not a shared sequence.",
    `- If a merge conflict still appears in a shared file, it's a "keep both entries" resolution — never renumber or drop another sub-agent's entry.`,
    "",
  );

  return out.join("\n");
}
