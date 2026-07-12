// Worker-hosted Progress MCP endpoint (Streamable HTTP) — the zero-checkout
// counterpart to the local stdio server (`src/mcp/server.ts`). Any agent on any
// machine can register the same eight tools with just a URL + bearer token:
//
//   claude mcp add --transport http progress https://progress.bck.dev/api/mcp \
//     --header "Authorization: Bearer <token>"
//
// The endpoint lives under /api/* deliberately: run_worker_first routes it to
// the Worker (not the SPA asset handler), and the /api auth middleware gates it
// before this handler ever runs. Tool calls dispatch back into the same Hono
// app via self-fetch — the exact pattern the legacy-path rewrite and image
// resizing already use — forwarding the caller's own credentials, so the API
// handlers stay the single enforcement point and single source of truth.
//
// Stateless mode: each POST builds a fresh McpServer + transport and tears it
// down after the response. That trades session features (server-initiated
// messages, resumability) for zero Durable-Object/state plumbing — the right
// trade for a toolset where every call is an independent request/response.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerProgressTools, type ApiFetch } from "../mcp/tools";

export async function handleMcpRequest(
  req: Request,
  selfFetch: (req: Request) => Promise<Response>,
): Promise<Response> {
  // Stateless: only POST carries JSON-RPC. GET would open a standalone SSE
  // stream (a server→client channel we never use) that idles the Worker; and
  // with no sessions there is nothing for DELETE to end. Refuse both up front.
  if (req.method !== "POST") {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed — POST JSON-RPC messages here." },
        id: null,
      },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const origin = new URL(req.url).origin;

  // Forward the caller's own credentials (bearer header, or session cookie for
  // a signed-in browser client) so internal calls carry exactly the authority
  // the MCP request arrived with — never an ambient elevated token.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const cookie = req.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;

  const api: ApiFetch = (method, path, body) =>
    selfFetch(
      new Request(`${origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  const server = new McpServer({ name: "progress", version: "0.2.0" });
  registerProgressTools(server, api);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // No session id generator → stateless: initialize/list/call all work as
    // independent POSTs; GET (SSE resume) and DELETE answer 405/404 per spec.
    sessionIdGenerator: undefined,
    // Plain JSON responses instead of SSE streams — simpler through proxies,
    // and nothing here streams.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } finally {
    // Per-request lifecycle: close so nothing leaks across requests.
    void transport.close();
  }
}
