# DRY and abstraction fit

Judge DRY in **both directions**. Duplication is a cost; the wrong abstraction
is a bigger one. Code should be *engineered enough* — neither hacky nor
over-abstracted.

## Reuse audit: same concept, or coincidentally similar?

Two code paths deserve one abstraction only when they are the **same concept**
— when a future change to one *must* apply to the other. Coincidental
similarity (same shape today, different reasons to change) should stay
duplicated.

**Flag as duplication (same concept):**

```ts
// pages/Agenda.tsx and pages/Home.tsx each reimplement "is this action overdue"
const overdue = action.dueDate !== null && action.dueDate < todayStr();
```

→ One rule of the domain, two copies that must never diverge. Extract to
`src/shared/` (e.g. `isOverdue(action, today)`), next to the other date rules.

**Do NOT flag (coincidentally similar):**

```ts
// Board groups actions by status; Agenda groups by due-date bucket.
// Both are "group an array into a Map" — but the grouping keys, ordering,
// and empty-group rules differ and will evolve independently.
```

→ A shared `groupBy` bought here couples two views that change for different
reasons. Leave both inline.

## Premature abstraction

An abstraction with **one caller** is a bet, not a savings. Apply the rule of
three: extract on the third occurrence, not the first, unless the concept is
already clearly domain-level (a status rule, a rank invariant).

**Before (speculative):**

```ts
// Only the action endpoint uses this — the options exist for callers
// that don't exist yet.
async function fetchEntity(kind: string, id: string, opts?: {
  includeArchived?: boolean;
  withComments?: boolean;
  format?: "full" | "summary";
}) { /* ... */ }
```

**After:**

```ts
async function fetchAction(id: string) { /* exactly what the one caller needs */ }
```

**Parameter sprawl** is the late stage of the same disease — one function bent
to serve unrelated callers:

```ts
// Before: a boolean per caller. Each new view added a flag.
function actionRows(actions: Action[], forBoard: boolean, forAgenda: boolean,
                   hideDone: boolean, groupByArc: boolean) { /* ... */ }
```

→ When flags select disjoint behavior, the callers aren't sharing a concept.
Split into `boardRows(actions)` / `agendaRows(actions)`, sharing only the genuine
common core (if any).

## Wrong-shaped abstractions

An abstraction that forces its callers to know its internals — or couples
modules that should not know each other — is worse than the duplication it
removed.

```ts
// Before: "reusable" hook that hard-codes two views' concerns together.
function useActionList(view: "board" | "agenda") {
  const actions = useStore((s) => s.actions);
  return view === "board" ? orderForBoard(actions) : bucketByDue(actions);
}
```

→ The `view` switch means every new view edits this hook. Give each view its
own selector; share the store access, not the branching.

## No-op and redundant updates

Flag work that provably changes nothing: writing a field to its current value,
re-sorting an already-sorted list on every render, a state setter called with
the same object identity, a migration that recreates an existing index. These
are usually leftovers of a refactor — the fix is deletion.

## When duplication is cheaper

Prefer duplication when: the copies are small (a few lines), the unifying
abstraction would need flags/generics to cover both, or the two sites belong
to different layers (client vs. worker — shared logic belongs in `src/shared/`
only when it is genuinely wire-level or domain-level, not to save three lines).
