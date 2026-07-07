# Architecture: boundaries, cohesion, dependency direction

This repo has four layers with a deliberate dependency direction:

```
src/client  →  src/shared  ←  src/worker  ←  src/db
   (React SPA)   (wire types,     (Hono API)    (Drizzle schema)
                  domain rules)
```

- `src/shared/` is the only code both sides may import. It holds wire types,
  domain constants, and pure domain rules (ranks, statuses, dates).
- `src/db/schema.ts` is the persistence shape; the worker maps it to wire
  types. The client must never import from `src/db` or `src/worker`.
- `src/mcp/` is a separate consumer of the HTTP API, not of worker internals.

## Dependency direction

Higher-level policy must not depend on lower-level detail. In this repo the
common inversions to catch:

**Before (shared code reaching down into a layer):**

```ts
// src/shared/agenda.ts
import { issues } from "../db/schema"; // shared now depends on Drizzle
export function bucketDue(rows: (typeof issues.$inferSelect)[]) { /* ... */ }
```

**After:**

```ts
// src/shared/agenda.ts — depends only on the wire type it already owns
import type { Issue } from "./types";
export function bucketDue(rows: Issue[]) { /* ... */ }
```

**Before (client importing worker detail):**

```ts
// src/client/store.ts
import type { BundleRow } from "../worker/bundle"; // crosses the wire
```

→ If the client needs the shape, the shape is a wire type: move it to
`src/shared/types.ts` and have both sides import it.

## Cohesion: files and functions doing too much

A module should have one reason to change, statable in one line. Warning signs
worth flagging (as `important` when they actively hurt, `suggestion` when
latent):

- A route handler that parses input, enforces domain rules, runs queries, and
  shapes the response inline for 100+ lines — extract the domain rule or the
  query, keep the handler as orchestration.
- A component that owns data fetching, local UI state, keyboard handling, and
  rendering for several distinct regions — split by region, not by "smart vs.
  dumb" dogma.
- A "utils" file accumulating unrelated helpers — each helper should live next
  to its concept (`dates.ts`, `rank.ts`), not in a junk drawer.

Do **not** flag size alone. A 500-line file with one responsibility and a
clear internal order can be healthier than five 100-line files with tangled
imports.

## Leaky abstractions

An abstraction leaks when callers must know its internals to use it safely.

```ts
// Before: caller must know the store keeps issues unsorted and must re-sort
const issues = store.issuesByArc(arcId);
const sorted = [...issues].sort(byRank); // every caller repeats this
```

→ If every caller sorts, ordering is part of the contract: sort inside
`issuesByArc` and document it, or expose `issuesByArcRanked`.

## Circular dependencies

Two modules importing each other (directly or via a chain) usually means a
concept is missing or misplaced. Fix by extracting the shared piece downward
(often into `src/shared/`), not with lazy `import()` tricks.

## SOLID, where it earns its place

This is a single-user app with rigid simplicity as a hard requirement. Apply
SOLID as a diagnostic, not a target: interface-segregation and dependency
direction catch real problems here; don't demand strategy patterns, DI
containers, or plugin seams the product will never need. A concrete `switch`
over the five fixed statuses is correct — the status set is deliberately
closed (see `CLAUDE.md`).
