# TypeScript standards

`bun run check` already enforces strict mode, `noUncheckedIndexedAccess`, and
`verbatimModuleSyntax`. Don't re-flag what it catches. Review what it can't:
**lies the type system was told to accept.**

## Unsafe `as` and `any` leakage across boundaries

Every `as` is a promise the compiler can't verify. Inside a module, sometimes
justified (and worth a comment); **across a boundary** (API response, D1 row,
localStorage, `JSON.parse`), it's a hole where runtime data flows in unchecked.

**Before:**

```ts
const res = await fetch("/api/bundle");
const bundle = (await res.json()) as WorkspaceBundle; // trust me
```

**After (trust boundary gets a validator):**

```ts
const bundle = workspaceBundleSchema.parse(await res.json()); // zod, one place
```

For internal hops where zod is overkill, prefer narrowing to casting:

```ts
// Before
const status = row.status as IssueStatus;
// After — the constant array is the source of truth
if (!ISSUE_STATUSES.includes(row.status)) throw new Error(`bad status: ${row.status}`);
```

## `unknown` at trust boundaries

Input from outside the process (request bodies, webhook payloads, env) should
enter as `unknown` and leave as a parsed type. A function signature taking
`any` for "flexible input" is `important`; taking `unknown` and narrowing is
correct.

## Discriminated unions over loose optional bags

When fields only co-occur in certain combinations, encode that:

**Before (illegal states representable):**

```ts
type SaveState = { saving?: boolean; error?: string; savedAt?: string };
```

**After:**

```ts
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; savedAt: string }
  | { kind: "error"; error: string };
```

Pair with exhaustiveness — a `switch` on the discriminant with a `never`
default arm (`const _exhaustive: never = state`) turns "added a variant" into
a compile error instead of a silent fall-through. Flag switches over
`IssueStatus`/`IssuePriority` that silently ignore unhandled members.

## Return-type honesty

A signature should not promise more than every code path delivers.

```ts
// Before: returns undefined on miss but claims Issue
function findIssue(key: string): Issue { return map.get(key)!; }
// After
function findIssue(key: string): Issue | undefined { return map.get(key); }
```

Non-null assertions (`!`) on lookups are the compact form of this lie — each
one needs either a nearby invariant that guarantees presence (fine, maybe
comment it) or a real `undefined` path (finding).

## Severity guide

- Unvalidated external data cast to a domain type: **important** (blocking if
  it guards a write).
- `any`/`as` on an internal seam with an invariant nearby: **nit** or nothing.
- Optional-bag type where a union would prevent a live bug class:
  **suggestion**, or **important** if a bug already lurks.
