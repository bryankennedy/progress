// Dogfood cutover (SPEC §7): bring Progress's own backlog in production up to
// reality and seed the v1.x agent-integration backlog — through the LIVE API,
// authenticated with the Progress API token (Authorization: Bearer, PROG-34).
//
// Run:  bun run scripts/dogfood-cutover.ts
// Needs PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env
// (Bun auto-loads .env). Idempotent: re-running skips issues whose title
// already exists in the product, and PATCH-to-done is a no-op once done.

const BASE = process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev";

const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;
if (!API_TOKEN) {
  console.error(
    "Missing PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.\n" +
      "Set it to the value behind `wrangler secret put PROGRESS_API_TOKEN`.",
  );
  process.exit(1);
}

const accessHeaders = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: accessHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 401) {
    throw new Error(
      `${method} ${path} → 401 unauthenticated — PROGRESS_API_TOKEN is missing or wrong.`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---- desired v1.x backlog (the work that follows v1; SPEC §10–§11) ----------
// arc names are resolved/created below; null = product-level (ops) item.
type NewIssue = {
  title: string;
  description: string;
  status: string;
  priority: string;
  estimate: number | null;
  repo: boolean; // true = code work in the repo; false = ops/product-level
  arc: string | null;
  tags: string[];
};

const AGENT_ARC = "Agent Integration";
const GIT_ARC = "Git Integration";

const NEW_ISSUES: NewIssue[] = [
  {
    title: "Register the GitHub webhook on connected repos",
    description:
      "Point real repositories at the live endpoint (SPEC §5): Settings → Webhooks → " +
      "payload URL `https://progress.bck.dev/api/webhooks/github`, content " +
      "type `application/json`, shared secret, events Pushes + Pull requests. The endpoint " +
      "is deployed and verified (401 unsigned / 200 signed); this is the owner-side hookup.",
    status: "todo",
    priority: "medium",
    estimate: 1,
    repo: false,
    arc: null,
    tags: ["infra"],
  },
  {
    title: "Context bundle endpoint — GET /api/issues/:key/bundle",
    description:
      "Deterministic Markdown work-order for an issue plus its lineage (product → repo with " +
      "`gitUrl` → arc), comments, and linked PRs/commits, ending in a stable report-back " +
      "preamble (SPEC §11.1). Shared foundation for both integration directions; also a " +
      "'copy as prompt' button for manual use.",
    status: "todo",
    priority: "high",
    estimate: 3,
    repo: true,
    arc: AGENT_ARC,
    tags: ["agent"],
  },
  {
    title: "Progress MCP server",
    description:
      "Expose the Worker API as MCP tools (SPEC §11.3): get issue/bundle by key, list/filter " +
      "issues, update status, comment, create and move issues. Authenticates with the Access " +
      "service token (§11.4). This is the 'API for third-party clients' from §6, promoted " +
      "from deferred.",
    status: "backlog",
    priority: "high",
    estimate: 5,
    repo: true,
    arc: AGENT_ARC,
    tags: ["agent"],
  },
  {
    title: "Outbound: 'Work on this' kickoff from an issue",
    description:
      "Palette command + button that primes a Claude Code session with the bundle (SPEC §11.2). " +
      "v1.x minimal: a `progress work PROG-n` handoff one-liner that fetches the bundle and " +
      "launches `claude` in the right checkout. Later: branch-from-key (`iss/PROG-n`) so the " +
      "§5 magic-word linking closes the loop automatically.",
    status: "backlog",
    priority: "medium",
    estimate: 5,
    repo: true,
    arc: AGENT_ARC,
    tags: ["agent"],
  },
  {
    title: "Cloudflare Access service token for non-interactive clients",
    description:
      "Service token + a Service Auth policy on the Progress app so scripts, the MCP server, " +
      "and agents reach the Access-protected API without an interactive login (SPEC §8.3, " +
      "§11.4) — the same bypass pattern the webhook uses with HMAC. First real use: this " +
      "dogfood cutover ran through it.",
    status: "done",
    priority: "medium",
    estimate: 1,
    repo: false,
    arc: AGENT_ARC,
    tags: ["infra"],
  },
  {
    title: "Dogfood cutover: move the backlog into Progress",
    description:
      "SPEC §7: v1 is 'done' when Progress's own backlog lives inside Progress, in production. " +
      "Milestone history (PROG-1..14) marked complete and the v1.x agent-integration backlog " +
      "created here — all via the live API + Access service token, not raw SQL.",
    status: "done",
    priority: "medium",
    estimate: 1,
    repo: false,
    arc: null,
    tags: [],
  },
  {
    title: "PR-driven status automation",
    description:
      "Deferred from v1 (SPEC §5): a linked PR opening moves the issue to In Review, merging " +
      "moves it to Done. Builds directly on the §5 webhook already shipped (D29).",
    status: "backlog",
    priority: "low",
    estimate: 3,
    repo: true,
    arc: GIT_ARC,
    tags: [],
  },
];

async function main() {
  console.log("→ Connecting to production through the Access service token…");
  const ws = await api("GET", "/api/workspace");
  console.log(`  ✓ authenticated — ${ws.issues.length} issues, ${ws.products.length} products`);

  const product = ws.products.find((p: any) => p.keyPrefix === "PROG");
  if (!product) throw new Error("PROG product not found in production workspace");

  // --- Step 1: milestone history. PROG-1..14 are all shipped + deployed. ---
  const byNumber = new Map<number, any>(
    ws.issues.filter((i: any) => i.productId === product.id).map((i: any) => [i.number, i]),
  );
  let marked = 0;
  for (let n = 1; n <= 14; n++) {
    const issue = byNumber.get(n);
    if (!issue) {
      console.warn(`  ! PROG-${n} not found — skipping`);
      continue;
    }
    if (issue.status === "done") continue;
    await api("PATCH", `/api/issues/${issue.id}`, { status: "done" });
    marked++;
  }
  console.log(`→ Milestone history: marked ${marked} issue(s) done (PROG-1..14 complete).`);

  // --- Step 2: ensure arcs exist (Agent Integration is new this cutover). ---
  const arcByName = new Map<string, string>(
    ws.arcs.filter((a: any) => a.productId === product.id).map((a: any) => [a.name, a.id]),
  );
  for (const name of [AGENT_ARC]) {
    if (arcByName.has(name)) continue;
    const { container } = await api("POST", "/api/arcs", {
      productId: product.id,
      name,
      description:
        "Close the gap between tracking work and executing it: an issue as an executable " +
        "work order for Claude Code (SPEC §11) — context bundle, MCP server, work kickoff.",
    });
    arcByName.set(name, container.id);
    console.log(`→ Created arc "${name}".`);
  }

  // --- Step 3: create the v1.x backlog (skip titles already present). ---
  const existingTitles = new Set(
    ws.issues.filter((i: any) => i.productId === product.id).map((i: any) => i.title),
  );
  for (const spec of NEW_ISSUES) {
    if (existingTitles.has(spec.title)) {
      console.log(`  = "${spec.title}" already exists — skipping`);
      continue;
    }
    const { issue } = await api("POST", "/api/issues", {
      title: spec.title,
      productId: product.id,
      repoId: spec.repo ? ws.repos.find((r: any) => r.productId === product.id)?.id ?? null : null,
      arcId: spec.arc ? arcByName.get(spec.arc) ?? null : null,
      description: spec.description,
      status: spec.status,
      priority: spec.priority,
      estimate: spec.estimate,
    });
    for (const tag of spec.tags) {
      await api("POST", `/api/issues/${issue.id}/tags`, { name: tag });
    }
    console.log(`→ Created ${product.keyPrefix}-${issue.number}: ${spec.title}`);
  }

  const after = await api("GET", "/api/workspace");
  console.log(
    `\n✓ Cutover complete. Production now holds ${after.issues.length} issues ` +
      `across ${after.arcs.length} arcs. v1 is dogfooded.`,
  );
}

main().catch((err) => {
  console.error("\n✗ Cutover failed:", err.message);
  process.exit(1);
});
