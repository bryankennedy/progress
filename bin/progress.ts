#!/usr/bin/env bun
// progress — kick off work on an action from the terminal (SPEC §11.2, PROG-19).
//
//   progress work PROG-19
//
// Fetches the action's context bundle (GET /api/actions/:key/bundle) and launches
// a Claude Code session primed with it, in the current checkout. By default it
// also creates/checks out `act/PROG-19` — the branch-from-key linchpin — so the
// commits and PRs that follow auto-link back to the action (Progress §5).
//
// It operates in the current directory and never tries to locate a repo from
// its gitUrl, so Progress stays free of machine-specific knowledge about where
// repos live (SPEC §11.2). Run it from inside the checkout you want to work in.
//
// Expose it as `progress` once (see SETUP §7):
//   alias progress='bun --env-file=/abs/path/progress/.env /abs/path/progress/bin/progress.ts'

import { execFileSync, spawnSync } from "node:child_process";

const BASE = (process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev").replace(/\/+$/, "");
const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;

const KEY_RE = /^[A-Z]{2,8}-\d+$/;

const USAGE = `Usage:
  progress work <KEY> [--no-branch] [--print]

Fetches an action's context bundle and launches \`claude\` primed with it, in the
current directory. By default also creates/checks out \`act/<KEY>\` so commits
and PRs auto-link back to the action.

Options:
  --no-branch   Use the current branch; don't create/switch to act/<KEY>.
  --print       Print the bundle to stdout and exit (don't launch claude).

Env:
  PROGRESS_BASE_URL                 (default: production)
  PROGRESS_API_TOKEN                Progress API token (Authorization: Bearer)
                                    (falls back to PROD_PROGRESS_API_TOKEN)`;

function fail(msg: string): never {
  console.error(`progress: ${msg}`);
  process.exit(1);
}

async function fetchBundle(key: string): Promise<string> {
  if (!API_TOKEN) fail("missing PROGRESS_API_TOKEN (or PROD_PROGRESS_API_TOKEN fallback) in env.");
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/actions/${key}/bundle`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      redirect: "manual",
    });
  } catch (e) {
    return fail(`couldn't reach ${BASE}: ${(e as Error).message}`);
  }
  if (res.status === 401) fail("401 unauthenticated — PROGRESS_API_TOKEN is missing or wrong.");
  if (res.status === 404) fail(`no action found for ${key}.`);
  if (res.status === 400) fail(`malformed action key: ${key} (expected e.g. PROG-19).`);
  const text = await res.text();
  if (!res.ok) fail(`bundle fetch failed: HTTP ${res.status}: ${text}`);
  return text;
}

function inGitWorkTree(): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  return r.status === 0;
}

function gitOut(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// Create or switch to act/<KEY>; no-op if already there. Returns the branch name.
function ensureBranch(key: string): string {
  const branch = `act/${key}`;
  if (gitOut(["branch", "--show-current"]) === branch) return branch;
  const exists =
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      stdio: "ignore",
    }).status === 0;
  const r = spawnSync("git", exists ? ["checkout", branch] : ["checkout", "-b", branch], {
    stdio: "inherit",
  });
  if (r.status !== 0)
    fail(`couldn't check out ${branch} (uncommitted changes?). Re-run with --no-branch.`);
  return branch;
}

async function work(rest: string[]): Promise<void> {
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const positional = rest.filter((a) => !a.startsWith("--"));
  for (const f of flags)
    if (f !== "--no-branch" && f !== "--print") fail(`unknown option ${f}.\n\n${USAGE}`);

  const key = (positional[0] ?? "").toUpperCase();
  if (!KEY_RE.test(key)) fail(`expected an action key like PROG-19, got "${positional[0] ?? ""}".`);

  const bundle = await fetchBundle(key);
  if (flags.has("--print")) {
    process.stdout.write(bundle.endsWith("\n") ? bundle : bundle + "\n");
    return;
  }

  if (!flags.has("--no-branch")) {
    if (inGitWorkTree()) ensureBranch(key);
    else
      console.error(
        `progress: not in a git repo — skipping the act/${key} branch. ` +
          `cd into the checkout first, or pass --no-branch to silence this.`,
      );
  }

  // Hand the bundle to Claude Code as the session's opening prompt. No shell is
  // involved (direct exec), so the Markdown can't be reinterpreted.
  const r = spawnSync("claude", [bundle], { stdio: "inherit" });
  if (r.error)
    fail(`couldn't launch \`claude\` (is Claude Code installed and on PATH?): ${r.error.message}`);
  process.exit(r.status ?? 0);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "work") return work(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return;
  }
  fail(`unknown command "${cmd}".\n\n${USAGE}`);
}

main().catch((e) => fail((e as Error).message));
