// Tests for the hosted MCP endpoint (src/worker/mcp.ts). Run with `bun test`.
// Focus: the Streamable HTTP handshake in stateless mode (every POST stands
// alone — the transport is rebuilt per request, so tools/list and tools/call
// must work without a prior initialize on the same instance), and that tool
// calls dispatch into the API via selfFetch with the caller's own credentials
// forwarded — never an ambient token.
import { describe, expect, it } from "bun:test";
import { handleMcpRequest } from "./mcp";

// Minimal snapshot — only the fields the toolset's resolution helpers read.
const SNAPSHOT = {
  focuses: [{ id: "prd_progress", keyPrefix: "PROG", name: "Progress", gitUrl: null }],
  arcs: [],
  actions: [
    {
      id: "act_1",
      focusId: "prd_progress",
      number: 5,
      title: "Fix the thing",
      description: "",
      status: "todo",
      priority: "high",
      estimate: null,
      dueDate: null,
      arcId: null,
    },
  ],
  tags: [],
  actionTags: [],
  actionKeyAliases: [{ key: "OLD-9", actionId: "act_1" }],
};

// Fake API: records every self-dispatched request, serves canned responses.
function fakeApi() {
  const calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];
  const selfFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    calls.push({
      method: req.method,
      path: url.pathname,
      auth: req.headers.get("authorization"),
      body: req.body ? await req.json() : undefined,
    });
    if (req.method === "GET" && url.pathname === "/api/snapshot") return Response.json(SNAPSHOT);
    if (req.method === "PATCH" && url.pathname.startsWith("/api/actions/"))
      return Response.json({ action: SNAPSHOT.actions[0] });
    return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 500 });
  };
  return { calls, selfFetch };
}

// One JSON-RPC POST against a fresh handler invocation — exactly how requests
// arrive in production (stateless: no shared transport between calls).
async function rpc(
  body: unknown,
  selfFetch: (req: Request) => Promise<Response>,
): Promise<Response> {
  const req = new Request("https://progress.test/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer caller-token",
    },
    body: JSON.stringify(body),
  });
  return handleMcpRequest(req, selfFetch);
}

const call = (name: string, args: unknown, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("handleMcpRequest — Streamable HTTP, stateless", () => {
  it("answers initialize with the server identity", async () => {
    const { selfFetch } = fakeApi();
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
      selfFetch,
    );
    expect(res.status).toBe(200);
    const rpcRes = (await res.json()) as any;
    expect(rpcRes.result.serverInfo.name).toBe("progress");
    // Stateless: no session id minted, so clients never need to carry one.
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("lists all eight tools on a fresh transport (no prior initialize)", async () => {
    const { selfFetch } = fakeApi();
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, selfFetch);
    expect(res.status).toBe(200);
    const rpcRes = (await res.json()) as any;
    const names = rpcRes.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      "comment",
      "create_action",
      "get_action",
      "get_bundle",
      "list_actions",
      "move_action",
      "set_due_date",
      "update_status",
    ]);
  });

  it("serves a read tool off the snapshot, resolving alias keys", async () => {
    const { selfFetch } = fakeApi();
    const res = await rpc(call("get_action", { key: "old-9" }), selfFetch);
    const rpcRes = (await res.json()) as any;
    const action = JSON.parse(rpcRes.result.content[0].text);
    // OLD-9 is a retired alias for act_1 — must resolve and render the live key.
    expect(action.key).toBe("PROG-5");
    expect(action.title).toBe("Fix the thing");
  });

  it("dispatches a write tool into the API with the caller's credentials", async () => {
    const { calls, selfFetch } = fakeApi();
    const res = await rpc(
      call("update_status", { key: "PROG-5", status: "in_progress" }),
      selfFetch,
    );
    const rpcRes = (await res.json()) as any;
    expect(rpcRes.result.isError).toBeUndefined();
    expect(rpcRes.result.content[0].text).toBe("PROG-5: todo → in_progress.");

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toEqual({
      method: "PATCH",
      path: "/api/actions/act_1",
      // The caller's own bearer, forwarded — not an ambient elevated token.
      auth: "Bearer caller-token",
      body: { status: "in_progress" },
    });
  });

  it("surfaces API failures as tool errors, not transport failures", async () => {
    const { selfFetch } = fakeApi();
    const res = await rpc(call("update_status", { key: "PROG-404", status: "done" }), selfFetch);
    expect(res.status).toBe(200); // JSON-RPC layer: the error rides in-band
    const rpcRes = (await res.json()) as any;
    expect(rpcRes.result.isError).toBe(true);
    expect(rpcRes.result.content[0].text).toContain("No action found for key PROG-404");
  });

  it("rejects GET — no SSE resume stream in stateless mode", async () => {
    const { selfFetch } = fakeApi();
    const res = await handleMcpRequest(
      new Request("https://progress.test/api/mcp", {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      }),
      selfFetch,
    );
    expect(res.status).toBe(405);
  });
});
