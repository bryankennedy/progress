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

// Deterministic: every value comes from the row data (no Date.now / locale),
// and collections arrive pre-sorted, so the same issue always renders byte
// for byte the same — important for a "copy as prompt" artifact and for
// diffing what an agent was handed.
export function renderBundle(b: BundleData): string {
  const { issue } = b;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const para = (text: string, fallback = "_None._") =>
    text.trim() ? text.trim() : fallback;
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
    `1. Name your branch with the key — e.g. \`iss/${b.key}\` — and mention **${b.key}** in commit messages and the PR title/body. Progress auto-links branches, commits, and PRs that name the key, so the work appears on this issue with no extra step.`,
    `2. Post progress notes as a comment on **${b.key}** and move its status as you go (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools.`,
    `3. Keep this issue the source of truth — if scope changes, leave a comment rather than silently diverging.`,
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
    `6. **Push the PR** — once the work is functioning and verified, push the branch and open a pull request (title/body naming **${b.key}**) for review. The work isn't handed off until the PR is up, so don't stop at a local commit. Then move **${b.key}** to \`in_review\` (item 2).`,
    "",
  );
  // Multiple agents often work different issues against this repo in parallel,
  // so append-only docs with a global running counter (e.g. DECISIONS.md's
  // `D<n>`) race — two agents grab the same number and conflict (PROG-62). Tell
  // the agent to key such entries to THIS issue instead, which can't collide
  // across issues.
  out.push("### Avoiding merge collisions (parallel agents)", "");
  out.push(
    `Other agents may be editing this repo on other issues at the same time. In **append-only docs**, never claim the next global running number — that races. Key the entry to this issue instead:`,
    "",
    `- **\`docs/DECISIONS.md\`** — head a new decision \`### ${b.key} — <title>\` (not the next \`D<n>\`); a second decision for the same issue gets a letter suffix (\`### ${b.key}b — …\`). Append at the end of the file.`,
    `- Same rule for any other append-only log keyed by a running counter: derive the id from **${b.key}**, not a shared sequence.`,
    `- If a trailing merge conflict still appears in such a file, it's a "keep both entries" resolution — never renumber or drop the other agent's entry.`,
    "",
  );
  return out.join("\n");
}
