// Uptime/alerting monitors as code (PROG-47). Declares the external monitors we
// want in Better Stack and syncs them to the account via its Uptime REST API, so
// the monitoring config lives in this repo rather than being hand-clicked in a
// dashboard. Better Stack is the general-purpose alerting layer for the whole
// stack (see docs/DECISIONS.md PROG-47); add an app = add an entry to MONITORS.
//
// Idempotent: matches an existing monitor by `pronounceable_name`, PATCHes it to
// the desired config (no-op when already correct), or POSTs a new one. As a
// one-time convenience it also ADOPTS a single pre-existing monitor on the same
// host that has no name match (e.g. Better Stack's onboarding sample), repointing
// it instead of creating a duplicate. It never deletes monitors it doesn't manage.
//
// Run:  bun --env-file=.env scripts/monitors.ts        (sync)
//       bun --env-file=.env scripts/monitors.ts --dry  (preview, no writes)

const BASE = "https://uptime.betterstack.com/api/v2";
const TOKEN = process.env.BETTERSTACK_API_TOKEN;
if (!TOKEN) {
  console.error(
    "Missing BETTERSTACK_API_TOKEN in .env. Create an Uptime API token in " +
      "Better Stack (Settings → API tokens → Team-based) and add it to .env.",
  );
  process.exit(1);
}
const DRY = process.argv.includes("--dry");

const h = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401)
    throw new Error(`${method} ${path} → 401 unauthenticated (BETTERSTACK_API_TOKEN rejected).`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// Desired monitors. `pronounceable_name` is the stable sync key — keep it unique
// and don't rename casually (a rename creates a second monitor). The managed
// fields are exactly those listed here; anything else stays at Better Stack's
// default and is left untouched on existing monitors.
type Monitor = {
  pronounceable_name: string;
  url: string;
  monitor_type: "status" | "keyword" | "expected_status_code";
  check_frequency: number; // seconds; free-tier floor is 180
  request_timeout: number; // seconds
  regions: string[]; // subset of ["us","eu","as","au"]
  email: boolean;
  sms: boolean;
  call: boolean;
  push: boolean;
};

const MONITORS: Monitor[] = [
  {
    // Progress readiness probe. `monitor_type: status` treats any 2xx as up, so
    // the endpoint's 503-when-D1-unreachable (see src/worker GET /api/health)
    // trips a real end-to-end outage alert, not just "the Worker booted".
    pronounceable_name: "Progress — API health",
    url: "https://progress.bck.dev/api/health",
    monitor_type: "status",
    check_frequency: 180,
    request_timeout: 15,
    regions: ["us", "eu"],
    email: true,
    sms: false,
    call: false,
    push: false,
  },
];

const MANAGED_FIELDS = [
  "url",
  "monitor_type",
  "check_frequency",
  "request_timeout",
  "regions",
  "email",
  "sms",
  "call",
  "push",
] as const;

const hostOf = (u: string) =>
  u
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...(a as unknown[])].sort()) === JSON.stringify([...(b as unknown[])].sort())
    : a === b;

async function listMonitors(): Promise<any[]> {
  const out: any[] = [];
  let path: string | null = "/monitors";
  while (path) {
    const page = await api("GET", path);
    out.push(...(page.data ?? []));
    const next: string | null = page.pagination?.next ?? null;
    path = next ? next.replace(BASE, "") : null;
  }
  return out;
}

// Fields in `want` that differ from the existing monitor's attributes.
function diff(want: Monitor, attrs: any): Partial<Monitor> {
  const patch: Record<string, unknown> = {};
  for (const f of MANAGED_FIELDS) {
    if (!sameValue((want as any)[f], attrs?.[f])) patch[f] = (want as any)[f];
  }
  return patch as Partial<Monitor>;
}

async function main() {
  const existing = await listMonitors();
  console.log(`Better Stack: ${existing.length} existing monitor(s).${DRY ? "  [dry run]" : ""}`);

  for (const want of MONITORS) {
    const byName = existing.find(
      (m) => m.attributes?.pronounceable_name === want.pronounceable_name,
    );
    // One-time adoption: no name match, but exactly one monitor already lives on
    // this host (e.g. the onboarding sample) — repoint it rather than duplicate.
    const sameHost = existing.filter((m) => hostOf(m.attributes?.url ?? "") === hostOf(want.url));
    const target = byName ?? (sameHost.length === 1 ? sameHost[0] : undefined);

    if (!target) {
      console.log(`+ CREATE  "${want.pronounceable_name}"  → ${want.url}`);
      if (!DRY) await api("POST", "/monitors", want);
      continue;
    }

    const patch = diff(want, target.attributes);
    // Adopt: also (re)name it to our stable key when we matched by host, not name.
    if (!byName) (patch as any).pronounceable_name = want.pronounceable_name;

    if (Object.keys(patch).length === 0) {
      console.log(`= OK      "${want.pronounceable_name}"  (id ${target.id}, already in sync)`);
    } else {
      const verb = byName ? "UPDATE" : "ADOPT ";
      console.log(
        `~ ${verb}  "${want.pronounceable_name}"  (id ${target.id})  ${JSON.stringify(patch)}`,
      );
      if (!DRY) await api("PATCH", `/monitors/${target.id}`, patch);
    }
  }

  if (!DRY) {
    const after = await listMonitors();
    console.log("\nMonitors now in Better Stack:");
    for (const m of after) {
      const a = m.attributes ?? {};
      console.log(
        `  - ${JSON.stringify(a.pronounceable_name)}  ${a.url}  [${a.status}]  every ${a.check_frequency}s`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
