#!/usr/bin/env bun
// progress — kick off work on an issue from the terminal (SPEC §11.2, PROG-19).
//
//   progress work PROG-19
//
// Fetches the issue's context bundle (GET /api/issues/:key/bundle) and launches
// a Claude Code session primed with it, in the current checkout. By default it
// also creates/checks out `iss/PROG-19` — the branch-from-key linchpin — so the
// commits and PRs that follow auto-link back to the issue (Progress §5).
//
// It operates in the current directory and never tries to locate a repo from
// its gitUrl, so Progress stays free of machine-specific knowledge about where
// repos live (SPEC §11.2). Run it from inside the checkout you want to work in.
//
// Expose it as `progress` once (see SETUP §7):
//   alias progress='bun --env-file=/abs/path/progress/.env /abs/path/progress/bin/progress.ts'

import { execFileSync, spawnSync } from "node:child_process";

const BASE = (process.env.PROGRESS_BASE_URL ?? "https://progress.bryan-22c.workers.dev").replace(
  /\/+$/,
  "",
);
const CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? process.env.PROD_CF_ACCESS_CLIENT_ID;
const CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? process.env.PROD_CF_ACCESS_CLIENT_SECRET;

const KEY_RE = /^[A-Z]{2,8}-\d+$/;

const USAGE = `Usage:
  progress work <KEY> [--no-branch] [--print]

Fetches an issue's context bundle and launches \`claude\` primed with it, in the
current directory. By default also creates/checks out \`iss/<KEY>\` so commits
and PRs auto-link back to the issue.

Options:
  --no-branch   Use the current branch; don't create/switch to iss/<KEY>.
  --print       Print the bundle to stdout and exit (don't launch claude).

Env:
  PROGRESS_BASE_URL                 (default: production)
  CF_ACCESS_CLIENT_ID / _SECRET     Cloudflare Access service token
                                    (falls back to PROD_CF_ACCESS_CLIENT_ID/_SECRET)`;

function fail(msg: string): never {
  console.error(`progress: ${msg}`);
  process.exit(1);
}

async function fetchBundle(key: string): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET)
    fail("missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (or PROD_ fallbacks) in env.");
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/issues/${key}/bundle`, {
      headers: { "CF-Access-Client-Id": CLIENT_ID, "CF-Access-Client-Secret": CLIENT_SECRET },
      redirect: "manual",
    });
  } catch (e) {
    return fail(`couldn't reach ${BASE}: ${(e as Error).message}`);
  }
  if (res.status === 302 || res.status === 0)
    fail("redirected to the Access login — the service token is not being accepted.");
  if (res.status === 404) fail(`no issue found for ${key}.`);
  if (res.status === 400) fail(`malformed issue key: ${key} (expected e.g. PROG-19).`);
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

// Create or switch to iss/<KEY>; no-op if already there. Returns the branch name.
function ensureBranch(key: string): string {
  const branch = `iss/${key}`;
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
  if (!KEY_RE.test(key)) fail(`expected an issue key like PROG-19, got "${positional[0] ?? ""}".`);

  const bundle = await fetchBundle(key);
  if (flags.has("--print")) {
    process.stdout.write(bundle.endsWith("\n") ? bundle : bundle + "\n");
    return;
  }

  if (!flags.has("--no-branch")) {
    if (inGitWorkTree()) ensureBranch(key);
    else
      console.error(
        `progress: not in a git repo — skipping the iss/${key} branch. ` +
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
