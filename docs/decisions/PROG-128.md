### PROG-128 — Cross-session freshness via a polled change cursor, not push or blind refetch

**Context.** The store's "load once, never refetch" model (D21) assumed this
client was the only writer. Agent sessions writing through the API/MCP broke
that: actions created elsewhere stayed invisible until a hard reload, even
across route changes.

**Decision.** Poll a tiny `GET /api/snapshot/version` probe and refetch the
full snapshot only when its change cursor moved.

- **Cursor, not payload.** The probe returns two opaque strings (snapshot /
  timeline halves) built from per-table `count(*)` + `max(updated_at)`
  aggregates in one `SELECT` (`src/worker/syncCursors.ts`). Counts catch
  creates/deletes, timestamps catch edits; append-only tables contribute count
  alone. An idle tab costs one cheap aggregate query per poll instead of
  re-shipping a multi-hundred-KB snapshot to learn nothing changed —
  the "lightweight" requirement in the action.
- **Triggers**: route change (where the owner most expects freshness), window
  focus/online, and a 60 s visible-tab interval, all throttled to one probe
  per 10 s. No polling in hidden tabs.
- **Race-safe baseline.** The snapshot payload embeds `syncCursors` computed
  *before* its own table reads, so a write landing mid-request leaves data
  newer than the cursor — the next poll refetches harmlessly rather than
  missing the change. The client adopts cursors from every payload it loads.
- **Optimistic writes win.** Every store mutation's server sync is wrapped in
  `trackedWrite`: while any write is in flight a changed cursor is *not*
  applied (the stale local cursor re-detects it later), and starting a write
  cancels an in-flight background refetch (the fetch is now abortable). The
  local cursor advances only when fresh data actually lands
  (`dataUpdatedAt` moved), so canceled/failed refreshes self-heal.
- **Timelines too.** A moved timeline cursor invalidates `['action', …]`
  queries — the open action page refetches its comments in the background,
  closed ones refetch on next mount.

**Alternatives rejected.** Push (SSE/WebSocket) needs a Durable Object and
always-open connections — heavy for a single-user tracker where a ≤60 s /
next-navigation delay is fine. React Query `staleTime`/`refetchOnWindowFocus`
would blindly re-ship the full snapshot on every trigger and has no guard
against clobbering optimistic writes.

**Accepted costs.** Own writes also move the cursor, so local edits are
followed by at most one redundant background snapshot refetch per interval
(structural sharing keeps re-renders scoped to changed rows). `updated_at` has
second granularity, so two edits to the *same row* within the same second can
be missed until the next write anywhere — negligible at this scale. A 401 on
the probe is ignored (never bounce a working session to the sign-in screen
from a background poll).
