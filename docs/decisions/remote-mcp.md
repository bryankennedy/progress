### remote-mcp — Hosted MCP endpoint: Streamable HTTP from the Worker, stateless, self-dispatching

**Date:** 2026-07-12 · **Status:** accepted

**Context.** The MCP server (PROG-18/D34) was local-stdio only: every machine
that wanted the tools needed this repo checked out, Bun installed, and the
`.env` token wired through `--env-file`. That blocks the actual use case —
an agent working in an **unrelated codebase** (or a cloud machine) updating
the action it was handed as a prompt.

**Decision.** Serve the same toolset from the Worker at `POST /api/mcp` using
the MCP SDK's `WebStandardStreamableHTTPServerTransport`. Configuration
anywhere is one line: URL + the existing `PROGRESS_API_TOKEN` bearer header.

Shape choices, and why:

- **One toolset, two transports.** The eight tool registrations moved verbatim
  from `src/mcp/server.ts` into a transport-agnostic `src/mcp/tools.ts`,
  parameterized by an `ApiFetch` (method, path, body) → Response. The stdio
  server keeps its production-fetch client; the Worker handler
  (`src/worker/mcp.ts`) supplies a self-dispatch client. No tool behavior
  changed; the toolset stays a *client of the API*, never a second copy of the
  domain logic (D34's rule, kept).
- **`/api/mcp`, not `/mcp`.** `run_worker_first` is `/api/*` only — anything
  else goes to the SPA asset handler in production — and mounting under
  `/api/*` puts the endpoint behind the existing auth middleware with zero new
  gate code. MCP clients take a full URL, so the path spelling costs nothing.
- **Stateless.** Fresh `McpServer` + transport per POST, `sessionIdGenerator`
  unset, `enableJsonResponse: true`; GET/DELETE are refused 405 **before** the
  transport (a stateless GET would otherwise open a standalone SSE stream that
  idles the Worker for nothing). Sessions/resumability would need Durable
  Objects or KV for a toolset where every call is already an independent
  request/response — not worth it. Recurring/streaming needs can revisit.
- **Self-dispatch with the caller's credentials.** Tool API calls go back
  through `app.fetch(new Request(...))` — the same pattern as the PROG-98
  legacy-path rewrite and PROG-42 image resizing — forwarding the incoming
  `Authorization`/`Cookie` headers rather than injecting an ambient elevated
  token. The API handlers stay the single enforcement point: whatever the MCP
  caller may do is exactly what its own credential may do.
- **No new secret.** The endpoint authenticates with the existing
  `PROGRESS_API_TOKEN` (PROG-34), which already means "automation acting as
  the owner". A per-agent token scheme is a separate decision if ever needed.

**Consequences.** Any MCP-capable agent on any machine reaches Progress with
`claude mcp add --transport http progress https://progress.bck.dev/api/mcp
--header "Authorization: Bearer <token>"` (SETUP §7). The stdio server remains
for local/offline-ish use and for pointing at `bun run dev` via
`PROGRESS_BASE_URL`. The Worker bundle now includes the MCP SDK + zod (already
a dependency). Tests: `src/worker/mcp.test.ts` covers the stateless handshake,
alias-aware reads, credential forwarding on writes, in-band tool errors, and
the GET refusal.
