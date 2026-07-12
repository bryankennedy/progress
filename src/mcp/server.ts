#!/usr/bin/env bun
// Progress MCP server (SPEC §11.3, PROG-18) — the local stdio transport. It
// wraps the production Progress API and authenticates with the Progress API
// token (PROG-34) — sent as an `Authorization: Bearer` header, the same
// non-interactive path the dogfood scripts and `progress work` CLI use. The
// tools themselves live in `src/mcp/tools.ts`, shared with the Worker-hosted
// Streamable HTTP endpoint at /api/mcp (`src/worker/mcp.ts`), which is the
// zero-checkout way to reach the same toolset from any machine.
//
// Run:   bun src/mcp/server.ts   (or `bun run mcp`)
// Env:   PROGRESS_BASE_URL                 (default: production URL below)
//        PROGRESS_API_TOKEN                (the bearer token)
//          — falls back to PROD_PROGRESS_API_TOKEN so the same .env the dogfood
//            scripts use just works.
//
// Register in Claude Code (see docs/SETUP.md §7):
//   claude mcp add progress -- bun /abs/path/to/src/mcp/server.ts
// with PROGRESS_API_TOKEN in scope.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProgressTools, type ApiFetch } from "./tools";

const BASE = (process.env.PROGRESS_BASE_URL ?? "https://progress.bck.dev").replace(/\/+$/, "");
const API_TOKEN = process.env.PROGRESS_API_TOKEN ?? process.env.PROD_PROGRESS_API_TOKEN;

if (!API_TOKEN) {
  console.error(
    "[progress-mcp] Missing PROGRESS_API_TOKEN (or PROD_PROGRESS_API_TOKEN fallback).\n" +
      "Set it to the Progress API token (the value behind `wrangler secret put\n" +
      "PROGRESS_API_TOKEN`; see docs/SETUP.md §6/§7), then expose it to this server.",
  );
  process.exit(1);
}

const api: ApiFetch = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 401) {
    throw new Error(
      `${method} ${path} → 401 unauthenticated — PROGRESS_API_TOKEN is missing or wrong.`,
    );
  }
  return res;
};

const server = new McpServer({ name: "progress", version: "0.2.0" });
registerProgressTools(server, api);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP JSON-RPC channel.
  console.error(`[progress-mcp] connected to ${BASE}`);
}

main().catch((err) => {
  console.error("[progress-mcp] fatal:", err);
  process.exit(1);
});
