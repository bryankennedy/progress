// Synthetic workspace at SPEC §8.2 upper-bound scale, for the client-store
// latency spike (DECISIONS.md, open question #4). Generates SQL into
// scripts/seed-scale.generated.sql (gitignored) and applies it to the local
// D1 via wrangler. Idempotent (INSERT OR IGNORE, deterministic PRNG → stable
// ids and content across runs).
//
// Run: bun run db:seed:scale
// Reset to the real dogfood seed: delete .wrangler/state, then
// `bun run db:migrate && bun run db:seed`.

const COUNTS = {
  initiatives: 3,
  products: 10,
  repos: 25,
  arcs: 50,
  tags: 30,
  issues: 5000,
};

// Deterministic PRNG (mulberry32) so re-runs generate identical rows.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260611);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// Weighted pick: [value, weight] pairs.
function weighted<T>(pairs: readonly (readonly [T, number])[]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1]![0];
}

const ADJECTIVES = ["flaky", "stale", "slow", "broken", "missing", "duplicate", "responsive", "optimistic", "batched", "cached", "inline", "global", "empty", "archived", "draggable", "keyboard", "mobile", "offline", "paginated", "normalized"];
const NOUNS = ["board", "filter", "issue card", "status column", "command palette", "arc page", "tag picker", "key redirect", "webhook", "activity feed", "comment thread", "estimate field", "priority menu", "search index", "issue list", "container page", "markdown editor", "toast", "sidebar", "session"];
const VERBS = ["Fix", "Polish", "Investigate", "Refactor", "Speed up", "Simplify", "Wire up", "Design", "Prototype", "Harden", "Document", "Debounce", "Virtualize", "Cache", "Validate"];

const STATUS = weightedTable([
  ["backlog", 45],
  ["todo", 20],
  ["in_progress", 5],
  ["in_review", 3],
  ["done", 25],
  ["canceled", 2],
] as const);
const PRIORITY = weightedTable([
  ["none", 40],
  ["low", 20],
  ["medium", 20],
  ["high", 15],
  ["urgent", 5],
] as const);
function weightedTable<T>(pairs: readonly (readonly [T, number])[]) {
  return () => weighted(pairs);
}

const PALETTE = ["#06A7E0", "#F08B23", "#F2C42E", "#ED6245", "#546EB4", "#BA94C4", "#D4569F"];
const ESTIMATES = [0, 1, 2, 3, 5, 8];
const NOW = Math.floor(Date.now() / 1000);
const YEAR = 365 * 24 * 3600;

const esc = (s: string) => s.replace(/'/g, "''");
const lines: string[] = [];

// The seed user must exist for FK integrity even on a fresh database.
lines.push(
  `INSERT OR IGNORE INTO users (id, name, email, created_at) VALUES ('usr_owner', 'Owner', 'owner@example.com', ${NOW});`,
);

type Row = string;
function insertChunked(table: string, columns: string, rows: Row[], chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    lines.push(
      `INSERT OR IGNORE INTO ${table} (${columns}) VALUES\n${rows.slice(i, i + chunk).join(",\n")};`,
    );
  }
}

const iniIds: string[] = [];
const iniRows: Row[] = [];
for (let i = 1; i <= COUNTS.initiatives; i++) {
  const id = `ini_syn${i}`;
  iniIds.push(id);
  const t = NOW - int(0, YEAR);
  iniRows.push(`('${id}', 'Synthetic Initiative ${i}', '', 'usr_owner', ${t}, ${t})`);
}
insertChunked("initiatives", "id, name, description, creator_id, created_at, updated_at", iniRows);

// Product rows are rendered after issues are distributed (the
// next_issue_number counter depends on it) but inserted before repos/arcs/
// issues for FK order — hence the placeholder slot in `lines`.
const productSlot = lines.length;
const productIds: string[] = [];
const productMeta = new Map<string, { initiative: string; prefix: string; t: number }>();
for (let i = 1; i <= COUNTS.products; i++) {
  const id = `prd_syn${i}`;
  productIds.push(id);
  productMeta.set(id, {
    initiative: pick(iniIds),
    prefix: `SYN${String.fromCharCode(64 + i)}`,
    t: NOW - int(0, YEAR),
  });
}

const repoIdsByProduct = new Map<string, string[]>(productIds.map((p) => [p, []]));
const repoRows: Row[] = [];
for (let i = 1; i <= COUNTS.repos; i++) {
  const id = `rep_syn${i}`;
  const product = pick(productIds);
  repoIdsByProduct.get(product)!.push(id);
  const t = NOW - int(0, YEAR);
  repoRows.push(`('${id}', '${product}', 'synthetic-repo-${i}', '', NULL, 'usr_owner', ${t}, ${t})`);
}
insertChunked("repos", "id, product_id, name, description, git_url, creator_id, created_at, updated_at", repoRows);

const arcIdsByProduct = new Map<string, string[]>(productIds.map((p) => [p, []]));
const arcRows: Row[] = [];
for (let i = 1; i <= COUNTS.arcs; i++) {
  const id = `arc_syn${i}`;
  const product = pick(productIds);
  arcIdsByProduct.get(product)!.push(id);
  const t = NOW - int(0, YEAR);
  arcRows.push(`('${id}', '${product}', 'Synthetic Arc ${i}', '', 'usr_owner', ${t}, ${t})`);
}
insertChunked("arcs", "id, product_id, name, description, creator_id, created_at, updated_at", arcRows);

const tagIds: string[] = [];
const tagRows: Row[] = [];
for (let i = 1; i <= COUNTS.tags; i++) {
  const id = `tag_syn${i}`;
  tagIds.push(id);
  tagRows.push(`('${id}', 'syn-tag-${i}', '${PALETTE[i % PALETTE.length]}', ${NOW})`);
}
insertChunked("tags", "id, name, color, created_at", tagRows);

const nextNumber = new Map<string, number>(productIds.map((p) => [p, 1]));
const issueRows: Row[] = [];
const issueTagRows: Row[] = [];
for (let i = 1; i <= COUNTS.issues; i++) {
  const id = `iss_syn${i}`;
  const product = pick(productIds);
  const number = nextNumber.get(product)!;
  nextNumber.set(product, number + 1);

  const repos = repoIdsByProduct.get(product)!;
  const repo = repos.length > 0 && rand() < 0.7 ? pick(repos) : null;
  const arcs = arcIdsByProduct.get(product)!;
  const arc = arcs.length > 0 && rand() < 0.5 ? pick(arcs) : null;

  const status = STATUS();
  const priority = PRIORITY();
  const estimate = rand() < 0.3 ? "NULL" : pick(ESTIMATES);
  const assignee =
    status === "in_progress" || status === "in_review" || rand() < 0.3 ? "'usr_owner'" : "NULL";
  const created = NOW - int(0, YEAR);
  const updated = created + int(0, NOW - created);
  const completed = status === "done" ? updated : "NULL";
  const title = esc(`${pick(VERBS)} the ${pick(ADJECTIVES)} ${pick(NOUNS)}`);

  issueRows.push(
    `('${id}', '${product}', ${repo ? `'${repo}'` : "NULL"}, ${arc ? `'${arc}'` : "NULL"}, ${number}, '${title}', '', '${status}', '${priority}', ${estimate}, 'usr_owner', ${assignee}, ${created}, ${updated}, ${completed})`,
  );

  const tagCount = weighted([[0, 40], [1, 35], [2, 20], [3, 5]] as const);
  const chosen = new Set<string>();
  while (chosen.size < tagCount) chosen.add(pick(tagIds));
  for (const tag of chosen) issueTagRows.push(`('${id}', '${tag}')`);
}
insertChunked(
  "issues",
  "id, product_id, repo_id, arc_id, number, title, description, status, priority, estimate, creator_id, assignee_id, created_at, updated_at, completed_at",
  issueRows,
);
insertChunked("issue_tags", "issue_id, tag_id", issueTagRows);

// Render products into their reserved slot, now that counters are final.
const prodRows = productIds.map((id, i) => {
  const m = productMeta.get(id)!;
  return `('${id}', '${m.initiative}', 'Synthetic Product ${i + 1}', '', '${m.prefix}', ${nextNumber.get(id)}, 'usr_owner', ${m.t}, ${m.t})`;
});
lines.splice(
  productSlot,
  0,
  `INSERT OR IGNORE INTO products (id, initiative_id, name, description, key_prefix, next_issue_number, creator_id, created_at, updated_at) VALUES\n${prodRows.join(",\n")};`,
);

const outPath = new URL("./seed-scale.generated.sql", import.meta.url).pathname;
await Bun.write(outPath, lines.join("\n\n") + "\n");
console.log(`wrote ${lines.length} statements (${COUNTS.issues} issues) to ${outPath}`);

const proc = Bun.spawnSync(
  ["bunx", "wrangler", "d1", "execute", "progress-db", "--local", `--file=${outPath}`],
  { stdout: "inherit", stderr: "inherit" },
);
process.exit(proc.exitCode ?? 1);
