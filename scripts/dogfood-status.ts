// Dogfood status update (SPEC §7): keep production's own backlog honest by
// moving issues through the same fixed status set agents use — via the LIVE
// API, authenticated with the Cloudflare Access service token (SPEC §8.3).
//
// Run:  bun run scripts/dogfood-status.ts
// Needs PROD_CF_ACCESS_CLIENT_ID / PROD_CF_ACCESS_CLIENT_SECRET in .env.
// Idempotent: a PATCH to a status the issue already holds is a no-op.

const BASE = "https://progress.bryan-22c.workers.dev";

const CLIENT_ID = process.env.PROD_CF_ACCESS_CLIENT_ID;
const CLIENT_SECRET = process.env.PROD_CF_ACCESS_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing PROD_CF_ACCESS_CLIENT_ID / PROD_CF_ACCESS_CLIENT_SECRET in .env.");
  process.exit(1);
}

const accessHeaders = {
  "CF-Access-Client-Id": CLIENT_ID,
  "CF-Access-Client-Secret": CLIENT_SECRET,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: accessHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 0) {
    throw new Error(`${method} ${path} → redirected to Access login — service token not accepted.`);
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
