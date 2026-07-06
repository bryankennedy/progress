### PROG-51 — auto-save drafts + write-failure resilience for comments & descriptions

Motivated by a real incident: a transient D1 "storage operation exceeded
timeout which caused object to be reset" error surfaced on `POST
/api/issues/:id/comments`, yet the comment had actually **committed** server-side
before the error returned (confirmed in prod). Two problems exposed: (1) typed
text is lost on a failed save (the composer cleared the draft before the server
confirmed), and (2) a naive auto-retry would **duplicate** a comment that
already landed, because the comment id was generated server-side.

**Decisions:**

- **Comment POST becomes idempotent via a client-supplied id.** The client now
  generates the `cmt_…` id (it already did for the optimistic row) and sends it
  in the body; the server validates the shape (`^cmt_[0-9a-f]{32}$`) and, if the
  id already exists, returns the existing row as success **only when it belongs
  to the same `authorId` and `issueId`** — otherwise `409`. This is the
  user-scoping guard (single-tenant trust model notwithstanding, D-security): a
  retry can never attach to, or reveal, another allowlisted user's comment. No
  migration — `id` is already the PK; the conflict is handled by a
  select-before-insert (safe at single-user, sequential-retry rates).
- **Drafts persist to localStorage, namespaced by the signed-in user.** Key
  shape `progress:draft:<kind>:<meId>:<targetId>` (kind = `comment` |
  `description`), written debounced as you type and cleared only on a
  server-confirmed save. Survives tab close / reload / accidental navigation.
  User-namespacing keeps drafts from leaking across allowlisted accounts that
  share a browser profile.
- **Failed writes auto-retry with backoff, then surface a persistent toast with
  a Retry action.** Comment sends retry ~2× (idempotent, so safe); on exhaustion
  the optimistic row is removed, the draft is preserved (and repopulated into the
  live composer if still mounted), and a non-auto-dismissing toast offers Retry
  (re-sends the same id → no duplicate). This extends the previously
  failure-only, auto-dismiss toast with an optional action + sticky variant.
- **Restored description drafts carry a subtle "unsaved draft" indicator.** A
  description draft is unsent text shown in place of the saved value, so silent
  restore could be mistaken for a saved edit; the editor reopens with the draft
  plus a small "Unsaved draft — discard" affordance. Description PATCH is already
  idempotent, so it needs no id key — only the draft + retry/Retry-toast
  treatment.

*Review hardening (PROG-51, same session):*

- **The composer clears on success only when the field still holds the sent
  text.** A second comment typed while the first (slow/retried) send was in
  flight was being wiped by the success handler — the exact silent loss this
  issue targets. `sendComment` now compares a live `draftRef` against the sent
  body and leaves a newly-typed comment untouched.
- **Container descriptions (product/repo/arc) get the same drafts + retry.** The
  shared `EditableMarkdown` was built for both issue and container descriptions,
  but `ContainerPage` hadn't opted in; it now passes `draftScope`, and
  `updateContainer` mirrors `updateIssue` (retry + returns confirmation +
  `toastOnError` opt-out) so the editor clears the draft only on a confirmed
  save.
- **The comment insert is race-safe via `onConflictDoNothing` + re-SELECT.** The
  earlier select-before-insert could let two same-id POSTs both pass the check
  and the loser hit a PK violation → unhandled 500 + Sentry noise. The insert now
  tolerates the conflict and, on an empty result, re-SELECTs and re-applies the
  author+issue ownership check to return a clean 200/409. A concurrent same-id
  race yields one 201 + one 200 and a single row.
- **Sticky Retry toasts dedupe by source key.** `toastAction` takes an optional
  `key` (`comment:<issueId>`, `description:<targetId>`); a repeat failure from the
  same composer replaces its toast rather than stacking duplicates on a
  retry-storm.
- **Two retry-backoff profiles.** A failed comment post shows nothing wrong on
  screen, so it retries harder (`[400, 1200]`) to recover transparently; a failed
  *field* mutation (status/priority/rename/rank/description) leaves the wrong
  value visible, so it retries once quickly (`[300]`) to cap that window, then
  reverts + Retry-toasts. The success path stays instant either way.
