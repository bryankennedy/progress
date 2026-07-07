// Synthetic snapshot at SPEC §8.2 upper-bound scale, for the client-store
// latency spike (DECISIONS.md, open question #4). Generates SQL into
// scripts/seed-scale.generated.sql (gitignored) and applies it to the local
// D1 via wrangler. Idempotent (INSERT OR IGNORE, deterministic PRNG → stable
// ids and content across runs).
//
// Run: bun run db:seed:scale
// Reset to the real dogfood seed: delete .wrangler/state, then
// `bun run db:migrate && bun run db:seed`.

const COUNTS = {
  workspaces: 3,
  focuses: 10,
  repos: 25,
  arcs: 50,
  tags: 30,
  actions: 5000,
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
const NOUNS = ["board", "filter", "action card", "status column", "command palette", "arc page", "tag picker", "key redirect", "webhook", "activity feed", "comment thread", "estimate field", "priority menu", "search index", "action list", "container page", "markdown editor", "toast", "sidebar", "session"];
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
for (let i = 1; i <= COUNTS.workspaces; i++) {
  const id = `ini_syn${i}`;
  iniIds.push(id);
  const t = NOW - int(0, YEAR);
  iniRows.push(`('${id}', 'Synthetic Workspace ${i}', '', 'usr_owner', ${t}, ${t})`);
}
insertChunked("workspaces", "id, name, description, creator_id, created_at, updated_at", iniRows);

// Focus rows are rendered after actions are distributed (the
// next_action_number counter depends on it) but inserted before repos/arcs/
// actions for FK order — hence the placeholder slot in `lines`.
const focusSlot = lines.length;
const focusIds: string[] = [];
const focusMeta = new Map<string, { workspace: string; prefix: string; t: number }>();
for (let i = 1; i <= COUNTS.focuses; i++) {
  const id = `prd_syn${i}`;
  focusIds.push(id);
  focusMeta.set(id, {
    workspace: pick(iniIds),
    prefix: `SYN${String.fromCharCode(64 + i)}`,
    t: NOW - int(0, YEAR),
  });
}

const repoIdsByFocus = new Map<string, string[]>(focusIds.map((p) => [p, []]));
const repoRows: Row[] = [];
for (let i = 1; i <= COUNTS.repos; i++) {
  const id = `rep_syn${i}`;
  const focus = pick(focusIds);
  repoIdsByFocus.get(focus)!.push(id);
  const t = NOW - int(0, YEAR);
  repoRows.push(`('${id}', '${focus}', 'synthetic-repo-${i}', '', NULL, 'usr_owner', ${t}, ${t})`);
}
insertChunked("repos", "id, focus_id, name, description, git_url, creator_id, created_at, updated_at", repoRows);

const arcIdsByFocus = new Map<string, string[]>(focusIds.map((p) => [p, []]));
const arcRows: Row[] = [];
for (let i = 1; i <= COUNTS.arcs; i++) {
  const id = `arc_syn${i}`;
  const focus = pick(focusIds);
  arcIdsByFocus.get(focus)!.push(id);
  const t = NOW - int(0, YEAR);
  arcRows.push(`('${id}', '${focus}', 'Synthetic Arc ${i}', '', 'usr_owner', ${t}, ${t})`);
}
insertChunked("arcs", "id, focus_id, name, description, creator_id, created_at, updated_at", arcRows);

const tagIds: string[] = [];
const tagRows: Row[] = [];
for (let i = 1; i <= COUNTS.tags; i++) {
  const id = `tag_syn${i}`;
  tagIds.push(id);
  tagRows.push(`('${id}', 'syn-tag-${i}', '${PALETTE[i % PALETTE.length]}', ${NOW})`);
}
insertChunked("tags", "id, name, color, created_at", tagRows);

const nextNumber = new Map<string, number>(focusIds.map((p) => [p, 1]));
const actionRows: Row[] = [];
const actionTagRows: Row[] = [];
for (let i = 1; i <= COUNTS.actions; i++) {
  const id = `iss_syn${i}`;
  const focus = pick(focusIds);
  const number = nextNumber.get(focus)!;
  nextNumber.set(focus, number + 1);

  const repos = repoIdsByFocus.get(focus)!;
  const repo = repos.length > 0 && rand() < 0.7 ? pick(repos) : null;
  const arcs = arcIdsByFocus.get(focus)!;
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
  // Board rank (PROG-43): width-12 zero-padded decimal in insertion order,
  // offset by 1 so it never ends in "0" (canonical for src/shared/rank.ts) —
  // same scheme migration 0005 backfills with.
  const rank = String(i * 1000 + 1).padStart(12, "0");

  actionRows.push(
    `('${id}', '${focus}', ${repo ? `'${repo}'` : "NULL"}, ${arc ? `'${arc}'` : "NULL"}, ${number}, '${title}', '', '${status}', '${priority}', ${estimate}, '${rank}', 'usr_owner', ${assignee}, ${created}, ${updated}, ${completed})`,
  );

  const tagCount = weighted([[0, 40], [1, 35], [2, 20], [3, 5]] as const);
  const chosen = new Set<string>();
  while (chosen.size < tagCount) chosen.add(pick(tagIds));
  for (const tag of chosen) actionTagRows.push(`('${id}', '${tag}')`);
}
insertChunked(
  "actions",
  "id, focus_id, repo_id, arc_id, number, title, description, status, priority, estimate, rank, creator_id, assignee_id, created_at, updated_at, completed_at",
  actionRows,
);
insertChunked("action_tags", "action_id, tag_id", actionTagRows);

// Render focuses into their reserved slot, now that counters are final.
const prodRows = focusIds.map((id, i) => {
  const m = focusMeta.get(id)!;
  return `('${id}', '${m.workspace}', 'Synthetic Focus ${i + 1}', '', '${m.prefix}', ${nextNumber.get(id)}, 'usr_owner', ${m.t}, ${m.t})`;
});
lines.splice(
  focusSlot,
  0,
  `INSERT OR IGNORE INTO focuses (id, workspace_id, name, description, key_prefix, next_action_number, creator_id, created_at, updated_at) VALUES\n${prodRows.join(",\n")};`,
);

const outPath = new URL("./seed-scale.generated.sql", import.meta.url).pathname;
await Bun.write(outPath, lines.join("\n\n") + "\n");
console.log(`wrote ${lines.length} statements (${COUNTS.actions} actions) to ${outPath}`);

const proc = Bun.spawnSync(
  ["bunx", "wrangler", "d1", "execute", "progress-db", "--local", `--file=${outPath}`],
  { stdout: "inherit", stderr: "inherit" },
);
process.exit(proc.exitCode ?? 1);
