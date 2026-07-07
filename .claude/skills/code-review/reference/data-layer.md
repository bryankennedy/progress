# Data layer (Drizzle + D1/SQLite)

D1 is SQLite over the network from the Worker's perspective: each round trip
has real latency, and there are no long-lived connections. The shape of the
query plan matters more than micro-syntax.

## N+1 and query-in-loop

The classic finding. Any `await` on a query inside a loop over rows is a
candidate; with D1's per-query latency it's `important` at small n and
`blocking` on hot paths (bundle load, list endpoints).

**Before:**

```ts
const arcRows = await db.select().from(arcs).where(eq(arcs.productId, productId));
for (const arc of arcRows) {
  const issueRows = await db.select().from(issues).where(eq(issues.arcId, arc.id));
  result.push({ ...arc, issues: issueRows });
}
```

**After (one query per table, join in memory):**

```ts
const arcRows = await db.select().from(arcs).where(eq(arcs.productId, productId));
const issueRows = await db.select().from(issues)
  .where(inArray(issues.arcId, arcRows.map((a) => a.id)));
const byArc = Map.groupBy(issueRows, (i) => i.arcId);
```

Mind `inArray` with an **empty array** — Drizzle renders `IN ()` which SQLite
rejects; guard `if (ids.length === 0)` before the query.

## Transactions and batching

D1 has no interactive transactions; the primitive is `db.batch([...])` —
statements run atomically. Findings:

- Two dependent writes as separate awaits (e.g. insert issue + insert activity
  row): a crash between them corrupts history → **important**, use `batch`.
- A read-modify-write sequence (read max rank → write rank) is racy in
  principle; single-user makes it low stakes, so flag as `suggestion` unless
  the value is an invariant (unique keys) — then `important`.

## Parameterized queries only

Drizzle's query builder parameterizes automatically. The finding is any
`sql.raw(...)` or string interpolation into `sql` templates with
request-derived input:

```ts
// Before — injection, blocking
db.all(sql.raw(`SELECT * FROM issues WHERE title LIKE '%${q}%'`));
// After — sql template params are bound, and LIKE wildcards in user input
// are escaped so % and _ match literally
const escaped = q.replaceAll(/[\\%_]/g, "\\$&");
db.select().from(issues).where(sql`${issues.title} LIKE ${"%" + escaped + "%"} ESCAPE '\\'`);
```

## Index awareness on hot paths

Filters/sorts the app runs constantly (issues by status, by arc, by due date,
ranked ordering) should be backed by an index in `src/db/schema.ts`. A new
frequently-run `WHERE`/`ORDER BY` on an unindexed column is a `suggestion` at
this data scale (5k issues), `important` if it's in the per-request path of
every load.

## Logic in the right layer

- **Business logic leaking into queries:** a domain rule expressed only as SQL
  (`CASE WHEN status IN (...)`) can't be unit-tested or reused by the client.
  Domain rules live in `src/shared/`; queries fetch, then rules apply.
- **Query logic leaking upward:** a route handler assembling rows from three
  tables with bespoke maps that another handler duplicates — extract a named
  query function in the worker, keep handlers as orchestration.
- The worker maps DB rows to wire types at the edge (one place per entity);
  handlers returning raw `$inferSelect` shapes to the client couple the wire
  format to the schema — `important` when it leaks columns the client
  shouldn't see.

## Migrations

Migrations in `drizzle/` are append-only and must match `schema.ts` (generated
via `bun run db:generate`, not hand-edited unless necessary — and then
commented). A schema change without a migration, or a migration that rewrites
history, is `blocking`.
