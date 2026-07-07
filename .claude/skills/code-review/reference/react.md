# React (SPA: React 19 + wouter + react-query + client store)

This is a client-rendered SPA — no server components, no Next.js. The whole
snapshot loads into a client store up front, and **instant UI is a hard
requirement**: mutations are optimistic; a user-visible spinner on interaction
is a `blocking` finding, not a style choice.

## Needless re-renders — and needless memoization

Both directions are findings. Re-render cost matters here because views render
lists of hundreds of actions (5k in the scale seed).

**Flag: broad subscriptions in list-rendering paths.**

```tsx
// Before: every action change re-renders the whole board
const store = useStore(); // subscribes to everything
const column = store.actions.filter((i) => i.status === status);
```

→ Subscribe to the narrowest slice the component needs (a selector per
column/row), so unrelated mutations don't cascade.

**Flag the opposite too: reflexive memoization.**

```tsx
// useMemo wrapping a cheap expression with unstable deps anyway
const label = useMemo(() => `${action.key} ${action.title}`, [action]);
```

→ Memoization is for measured hot paths (list sorts/groupings over the full
action set), not string concatenation. `useMemo`/`memo` with no demonstrated
cost is a `nit`; missing memoization on a full-snapshot sort re-run per
keystroke is `important`.

## Effect misuse

Most `useEffect`s in app code are one of two mistakes:

**Derived state in an effect:**

```tsx
// Before: render → effect → setState → render again
const [overdue, setOverdue] = useState<Action[]>([]);
useEffect(() => { setOverdue(actions.filter(isOverdue)); }, [actions]);
// After: it's just a computation
const overdue = actions.filter(isOverdue);
```

**Event logic in an effect:**

```tsx
// Before: effect watches a flag that a click handler set
useEffect(() => { if (submitted) navigate(`/action/${key}`); }, [submitted]);
// After: do it where the event happens
async function onSubmit() { await createAction(...); navigate(`/action/${key}`); }
```

Legitimate effects synchronize with something **outside React**: document
title, `addEventListener`, focus, subscriptions. Those pass — check cleanup.

## Optimistic mutations

The store pattern is: apply the change locally first, then fire the API call,
then reconcile/rollback on failure. Findings:

- A mutation that awaits the server before updating the UI: **blocking**
  (violates instant UI).
- An optimistic update with no rollback path on failure: **important** — the
  store silently diverges from the database.
- Rollback that restores a stale snapshot over interleaved edits:
  **important**; prefer inverse-operation or refetch-on-error.

## Key stability

Keys must be stable identities, not positions:

```tsx
// Before: reorder = every row remounts, focus/drafts lost
{actions.map((action, i) => <Row key={i} action={action} />)}
// After
{actions.map((action) => <Row key={action.id} action={action} />)}
```

Index keys in a static, never-reordered list are a `nit`; in anything sortable
or filterable (boards, agenda, search results) they're `important`.

## Boundaries

- Routing is wouter: route params flow in as props/hooks; components shouldn't
  parse `location` by hand when a route pattern can capture it.
- Data fetching belongs in the store/query layer, not sprinkled through
  components as raw `fetch` — a component doing its own `fetch` for snapshot
  data bypasses the load-everything model and usually signals a missing store
  selector.
- Error/Suspense boundaries: errors thrown in event handlers don't hit error
  boundaries — user-triggered failures need explicit handling (toast + revert),
  see `reference/error-and-async.md`.
