// One-time rank heal (PROG-129): renumber every action's fractional-index
// `rank` to short, evenly spaced keys while preserving the current global
// order exactly — so no view visibly reorders.
//
// Why: action creates always append after the GLOBAL max rank, and the old
// rankBetween append case bisected toward the alphabet ceiling, so real keys
// degraded into 38-char "zzzz…" walls — and racing creates minted exact
// duplicate keys, which crashed any drag that landed between them (the
// PROG-129 blank page). The client now heals ties on drop, but this resets
// the whole key space in one pass and pulls the global max back down.
//
// Run:  bun --env-file=.env scripts/heal-ranks.ts          (dry run — prints the plan)
//       bun --env-file=.env scripts/heal-ranks.ts --apply  (writes via the live API)
// Needs PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.
// Idempotent: re-running after a completed pass finds nothing to change.

const BASE = process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev";

const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;
if (!API_TOKEN) {
  console.error("Missing PROGRESS_API_TOKEN / PROD_PROGRESS_API_TOKEN in .env.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" };

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// The rank alphabet (src/shared/rank.ts): base-62 in ASCII order.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// n as a fixed-width base-62 key; +1 on a trailing zero keeps keys canonical
// (rankBetween's no-trailing-"0" rule) — safe because the spacing step is ≥ 62.
function key(n: number, width: number): string {
  if (n % 62 === 0) n += 1;
  let s = "";
  for (let i = 0; i < width; i++) {
    s = ALPHABET[n % 62]! + s;
    n = Math.floor(n / 62);
  }
  return s;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const ws = await api("GET", "/api/snapshot");
  // The one global order every view slices: rank, then number, then id — the
  // client's byRankThenNumber with id as a final determinism tiebreak.
  const actions = [...ws.actions].sort(
    (a: any, b: any) =>
      (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
      a.number - b.number ||
      (a.id < b.id ? -1 : 1),
  );

  // Smallest width whose key space spreads N actions ≥ 62 apart, so every new
  // key ends non-zero after the +1 nudge and leaves room for years of inserts.
  const n = actions.length;
  let width = 1;
  while (62 ** width < (n + 2) * 62) width++;
  const step = Math.floor(62 ** width / (n + 1));

  const updates = actions
    .map((a: any, i: number) => ({ a, rank: key(step * (i + 1), width) }))
    .filter(({ a, rank }: any) => a.rank !== rank);
  console.log(
    `${n} actions, key width ${width}, step ${step} — ${updates.length} rank rewrites` +
      (apply ? "" : " (dry run; pass --apply to write)"),
  );
  for (const { a, rank } of updates) {
    console.log(`  ${a.rank} → ${rank}  ${a.title.slice(0, 60)}`);
    if (apply) await api("PATCH", `/api/actions/${a.id}`, { rank });
  }
  if (apply) console.log("Done.");
}

await main();
