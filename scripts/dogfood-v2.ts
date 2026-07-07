// v2 dogfood pass (SPEC v2 §11): record the v2 build as issues in Progress's
// own production backlog, through the LIVE API with the Progress API token
// (Authorization: Bearer) — the same pattern as scripts/dogfood-cutover.ts. Completed
// build work lands as `done`; genuine follow-ups carry due dates so the new
// Agenda view has real data across all four buckets.
//
// Run:  bun --env-file=.env scripts/dogfood-v2.ts   (idempotent — skips an
// issue whose title already exists in the product; PATCH-to-state is a no-op
// once it matches).

const BASE = process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev";
const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;
if (!API_TOKEN) {
  console.error("Missing PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.");
  process.exit(1);
}
const h = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401)
    throw new Error(`${method} ${path} → 401 unauthenticated (PROGRESS_API_TOKEN rejected).`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const PRODUCT_ID = "prd_progress";
const ARC_NAME = "v2 — Broaden & Due dates";
const ARC_DESC =
  "v2 broadens Progress to any area of responsibility (repo-less products, " +
  "frictionless structure creation) and adds the time dimension: optional " +
  "calendar-day due dates and the Agenda view. See docs/SPEC.md (v2).";

// done = completed build work; other statuses + dueDate = genuine follow-ups
// that exercise the Agenda buckets (today: 2026-06-17).
type Seed = {
  title: string;
  description: string;
  status: string;
  priority: string;
  estimate: number | null;
  dueDate?: string;
};

const SEEDS: Seed[] = [
  {
    title: "Repo-less products first-class + inline/dashboard structure creation",
    description:
      "SPEC v2 §3–§4. Repo stays optional; no view treats a missing repo as incomplete. " +
      "Add discoverable structure creation: a persistent New menu in the app header, inline " +
      "“+ New product/arc” in the create-issue dialog, and a /structure overview route with " +
      "inline “+ add” on each node. Reuses the v1 container write paths (D26).",
    status: "done",
    priority: "high",
    estimate: 3,
  },
  {
    title: "Due-date field end-to-end (schema → API → issue page → new-issue → palette)",
    description:
      "SPEC v2 §5. Optional calendar-day due date, timezone-safe ISO YYYY-MM-DD text (not an " +
      "instant). Nullable due_date column + migration; POST/PATCH validation; issue-page sidebar " +
      "field; new-issue dialog input; command-palette D picker. Rides the snapshot payload " +
      "(D37).",
    status: "done",
    priority: "high",
    estimate: 3,
  },
  {
    title: "Agenda view + reusable priority indicator",
    description:
      "SPEC v2 §6–§7.2. New /agenda route: dated, pending issues sorted by due date and grouped " +
      "Overdue/Today/This week/Later from the local day (rolling 7 days, D38); overdue rows " +
      "distinct; filterable by product/arc/tag; inline mark-done + bump-due. Priority indicator " +
      "is a single color-coded dot (D39). All client-side from the store.",
    status: "done",
    priority: "high",
    estimate: 5,
  },
  {
    title: "Agent surface: due dates in MCP (create_issue + set_due_date)",
    description:
      "Carry the due date through the agent surface: create_issue takes an optional dueDate and a " +
      "new set_due_date tool sets/clears it. The bundle work-order shows the due date too.",
    status: "done",
    priority: "medium",
    estimate: 1,
  },
  {
    title: "Ship v2: deploy, docs (D37–D40), and this dogfood pass",
    description:
      "Remote D1 migration + wrangler deploy; REFERENCE updated to as-built; SPEC v2 sections " +
      "shrunk to pointers; DECISIONS D37–D40; SETUP refreshed. Record the v2 build in production " +
      "as this arc.",
    status: "done",
    priority: "medium",
    estimate: 2,
  },
  // ---- genuine pending follow-ups, dated to populate the Agenda ----
  {
    title: "Backfill due dates on existing dated commitments",
    description:
      "Some existing tasks have implicit deadlines; set their due_date so they surface on the " +
      "Agenda. (Seeded overdue to exercise the Overdue bucket / styling.)",
    status: "todo",
    priority: "low",
    estimate: 1,
    dueDate: "2026-06-15",
  },
  {
    title: "Verify the Agenda view in production",
    description:
      "Open /agenda on the live site: confirm bucketing (Overdue/Today/This week/Later), relative " +
      "phrases, the priority dots, overdue styling, filters, and the inline done/bump actions.",
    status: "in_progress",
    priority: "high",
    estimate: 1,
    dueDate: "2026-06-17",
  },
  {
    title: "Owner: register GitHub webhook on connected repos (PROG-16 follow-up)",
    description:
      "Carry-over from v1 (REFERENCE / SETUP §6). Register the webhook so linked-PR/commit " +
      "sections light up. Dated this week to demonstrate the This-week bucket.",
    status: "todo",
    priority: "medium",
    estimate: 1,
    dueDate: "2026-06-22",
  },
  {
    title: "v2.1: scope recurring due dates",
    description:
      "SPEC v2 §8. The likely next step — most household chores repeat. The due-date model and " +
      "Agenda were built not to preclude recurrence; scope it. (Dated Later.)",
    status: "backlog",
    priority: "low",
    estimate: 2,
    dueDate: "2026-07-15",
  },
];

async function main() {
  const ws = await api("GET", "/api/snapshot");
  const product = ws.products.find((p: any) => p.id === PRODUCT_ID);
  if (!product) throw new Error(`Product ${PRODUCT_ID} not found in production.`);

  // Resolve or create the v2 arc.
  let arc = ws.arcs.find((a: any) => a.name === ARC_NAME && a.productId === PRODUCT_ID);
  if (!arc) {
    arc = (await api("POST", "/api/arcs", { name: ARC_NAME, productId: PRODUCT_ID, description: ARC_DESC }))
      .container;
    console.log(`+ arc ${arc.name}`);
  } else {
    console.log(`= arc ${arc.name} (exists)`);
  }

  const existingByTitle = new Map<string, any>(
    ws.issues.filter((i: any) => i.productId === PRODUCT_ID).map((i: any) => [i.title, i]),
  );

  for (const seed of SEEDS) {
    const existing = existingByTitle.get(seed.title);
    if (existing) {
      // Idempotent reconcile: nudge status/dueDate to the desired state.
      const patch: Record<string, unknown> = {};
      if (existing.status !== seed.status) patch.status = seed.status;
      if ((existing.dueDate ?? null) !== (seed.dueDate ?? null)) patch.dueDate = seed.dueDate ?? null;
      if (Object.keys(patch).length) {
        await api("PATCH", `/api/issues/${existing.id}`, patch);
        console.log(`~ ${product.keyPrefix}-${existing.number} ${JSON.stringify(patch)}`);
      } else {
        console.log(`= ${product.keyPrefix}-${existing.number} (up to date)`);
      }
      continue;
    }
    const { issue } = await api("POST", "/api/issues", {
      productId: PRODUCT_ID,
      arcId: arc.id,
      title: seed.title,
      description: seed.description,
      status: seed.status,
      priority: seed.priority,
      estimate: seed.estimate,
      dueDate: seed.dueDate ?? null,
    });
    console.log(
      `+ ${product.keyPrefix}-${issue.number} [${seed.status}${seed.dueDate ? ` due ${seed.dueDate}` : ""}] ${seed.title}`,
    );
  }

  // Report the Agenda as production now computes its inputs.
  const after = await api("GET", "/api/snapshot");
  const dated = after.issues
    .filter((i: any) => i.dueDate && i.status !== "done" && i.status !== "canceled")
    .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
  console.log(`\nAgenda inputs in production (${dated.length} dated, pending):`);
  for (const i of dated) console.log(`  ${i.dueDate}  ${product.keyPrefix}-${i.number}  ${i.title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
