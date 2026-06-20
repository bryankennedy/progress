// Dogfood status update (SPEC §7): keep production's own backlog honest by
// moving issues through the same fixed status set agents use — via the LIVE
// API, authenticated with the Progress API token (Authorization: Bearer, PROG-34).
//
// Run:  bun run scripts/dogfood-status.ts
// Needs PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.
// Idempotent: a PATCH to a status the issue already holds is a no-op.

const BASE = process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev";

const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;
if (!API_TOKEN) {
  console.error("Missing PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.");
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
    throw new Error(`${method} ${path} → 401 unauthenticated — PROGRESS_API_TOKEN not accepted.`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Title-addressed so it survives any in-app renumbering. status = desired state.
const UPDATES: { title: string; status: string }[] = [
  { title: "Context bundle endpoint — GET /api/issues/:key/bundle", status: "done" }, // PROG-17 shipped (D33)
  { title: "Progress MCP server", status: "todo" }, // next brick — on deck
];

async function main() {
  const ws = await api("GET", "/api/workspace");
  const product = ws.products.find((p: any) => p.keyPrefix === "PROG");
  if (!product) throw new Error("PROG product not found in production workspace");

  const byTitle = new Map<string, any>(
    ws.issues.filter((i: any) => i.productId === product.id).map((i: any) => [i.title, i]),
  );

  for (const u of UPDATES) {
    const issue = byTitle.get(u.title);
    if (!issue) {
      console.warn(`  ! "${u.title}" not found — skipping`);
      continue;
    }
    const key = `${product.keyPrefix}-${issue.number}`;
    if (issue.status === u.status) {
      console.log(`  = ${key} already ${u.status} — no-op`);
      continue;
    }
    await api("PATCH", `/api/issues/${issue.id}`, { status: u.status });
    console.log(`→ ${key} ${issue.status} → ${u.status}  (${u.title})`);
  }

  console.log("\n✓ Status sync complete — production reflects reality.");
}

main().catch((err) => {
  console.error("\n✗ Status sync failed:", err.message);
  process.exit(1);
});
