# Errors and async

The failure modes that matter here: a Worker request that dies half-done, an
optimistic client whose store silently diverges from the database, and errors
that vanish instead of reaching Sentry (worker) or a toast (client).

## Swallowed errors and empty catches

An empty or log-only `catch` erases the failure and lets the program continue
in an unknown state.

```ts
// Before — the save failed and nobody will ever know
try {
  await api.updateIssue(id, patch);
} catch {}

// After — client: revert the optimistic change and tell the user
try {
  await api.updateIssue(id, patch);
} catch (err) {
  store.revert(snapshot);
  toast.error(`Save failed: ${message(err)}`);
}
```

A deliberate swallow (fire-and-forget analytics, best-effort cache warm) is
fine **with a comment saying why**. Uncommented, it's `important`.

## Error context preservation

Catching and rethrowing must keep the chain — `throw new Error("save failed")`
amputates the stack and the original cause.

```ts
// After
catch (err) {
  throw new Error(`import failed for ${key}`, { cause: err });
}
```

In Hono handlers, prefer letting unexpected errors propagate to the Sentry
wrapper / `onError` over per-route try/catch that converts everything to a
generic 500 — centralized handling keeps context; scattered handling loses it.

## Floating promises

An unawaited promise whose rejection has no handler crashes nothing and fixes
nothing — the work may not happen and the error is lost. In Workers it's
worse: the runtime may kill the request before the promise settles.

```ts
// Before — may never run to completion after the response is returned
logActivity(db, issueId, "status", from, to);
return c.json(updated);

// After — either await it, or explicitly hand it to the runtime:
c.executionCtx.waitUntil(logActivity(db, issueId, "status", from, to));
```

On the client, a floating promise in an event handler needs a `.catch` (toast
+ revert). Deliberate fire-and-forget gets `void` + a comment.

## Cancellation and cleanup

- Effects that subscribe (listeners, timers, observers) must return a cleanup;
  a missing cleanup is `important` (leaks + double-fire under StrictMode).
- A fetch whose result lands after the user navigated away or retyped
  (search-as-you-type) needs staleness protection — `AbortController` or a
  request-id check — otherwise stale results overwrite fresh ones:
  `important` on interactive paths.

## Validation at trust boundaries

Every place untrusted input enters gets validated **once, at the edge**, then
flows as typed data:

- API request bodies/params: zod-parse in the route handler before any db
  call. A handler reading `await c.req.json()` fields unchecked is
  `important`, `blocking` if the value reaches a write or a query.
- Webhook payloads (GitHub): verify signature first, then parse.
- `localStorage`/drafts: parse defensively — corrupt local state must not
  crash the app; fall back to defaults.

Don't demand validation between internal layers that already share types —
that's noise, not safety.
