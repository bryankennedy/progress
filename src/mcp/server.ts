#!/usr/bin/env bun
// Progress MCP server (SPEC §11.3, PROG-18). A local stdio MCP server that wraps
// the production Progress API and authenticates with the Progress API token
// (PROG-34) — sent as an `Authorization: Bearer` header, the same non-interactive
// path the dogfood scripts and `progress work` CLI use. It is a CLIENT of the
// authenticated API, not a second copy of the domain logic, so the Worker stays
// the single source of truth (the "rigid simplicity" rule).
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
import { z } from "zod";
import { ACTION_ESTIMATES, ACTION_PRIORITIES, ACTION_STATUSES } from "../shared/constants";

// ---------------------------------------------------------------------------
// Config + API client
// ---------------------------------------------------------------------------

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

const accessHeaders: Record<string, string> = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: accessHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 401) {
    throw new Error(
      `${method} ${path} → 401 unauthenticated — PROGRESS_API_TOKEN is missing or wrong.`,
    );
  }
  return res;
}

async function apiJson(method: string, path: string, body?: unknown): Promise<any> {
  const res = await api(method, path, body);
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Snapshot + alias-aware key resolution
// ---------------------------------------------------------------------------
// Action keys are derived (PREFIX-number), never stored, and a cross-focus move
// retires the old key into actionKeyAliases as a permanent redirect (D18). We
// resolve both forms off one snapshot snapshot, the same way the Worker does.

type Snapshot = {
  focuses: any[];
  repos: any[];
  arcs: any[];
  actions: any[];
  tags: any[];
  actionTags: any[];
  actionKeyAliases: any[];
};

type Resolved = {
  ws: Snapshot;
  action: any;
  focus: any;
  repo: any | null;
  arc: any | null;
  key: string;
};

async function snapshot(): Promise<Snapshot> {
  return (await apiJson("GET", "/api/snapshot")) as Snapshot;
}

function prefixOf(ws: Snapshot, focusId: string): string {
  return ws.focuses.find((p) => p.id === focusId)?.keyPrefix ?? "???";
}

function liveKey(ws: Snapshot, action: any): string {
  return `${prefixOf(ws, action.focusId)}-${action.number}`;
}

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
}

// key → action, honoring current keys first then retired aliases.
function findActionByKey(ws: Snapshot, rawKey: string): any | null {
  const key = normalizeKey(rawKey);
  const live = ws.actions.find((i) => liveKey(ws, i) === key);
  if (live) return live;
  const alias = ws.actionKeyAliases.find((a) => a.key.toUpperCase() === key);
  if (alias) return ws.actions.find((i) => i.id === alias.actionId) ?? null;
  return null;
}

async function resolve(rawKey: string): Promise<Resolved> {
  const ws = await snapshot();
  const action = findActionByKey(ws, rawKey);
  if (!action) throw new Error(`No action found for key ${normalizeKey(rawKey)}.`);
  const focus = ws.focuses.find((p) => p.id === action.focusId) ?? null;
  const repo = action.repoId ? (ws.repos.find((r) => r.id === action.repoId) ?? null) : null;
  const arc = action.arcId ? (ws.arcs.find((a) => a.id === action.arcId) ?? null) : null;
  return { ws, action, focus, repo, arc, key: liveKey(ws, action) };
}

function tagNamesFor(ws: Snapshot, actionId: string): string[] {
  const ids = new Set(ws.actionTags.filter((t) => t.actionId === actionId).map((t) => t.tagId));
  return ws.tags
    .filter((t) => ids.has(t.id))
    .map((t) => t.name)
    .sort();
}

// Compact, agent-friendly view of an action (keys, not opaque ids).
function summarize(ws: Snapshot, action: any) {
  return {
    key: liveKey(ws, action),
    title: action.title,
    status: action.status,
    priority: action.priority,
    estimate: action.estimate,
    dueDate: action.dueDate ?? null,
    focus: prefixOf(ws, action.focusId),
    repo: action.repoId ? (ws.repos.find((r) => r.id === action.repoId)?.name ?? null) : null,
    arc: action.arcId ? (ws.arcs.find((a) => a.id === action.arcId)?.name ?? null) : null,
    tags: tagNamesFor(ws, action.id),
  };
}

// ---------------------------------------------------------------------------
// MCP tool result helpers
// ---------------------------------------------------------------------------

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

// ---------------------------------------------------------------------------
// Server + tools (SPEC §11.3)
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "progress", version: "0.1.0" });

const KEY = z.string().describe("Action key like PROG-18 (retired/alias keys resolve too)");

server.registerTool(
  "get_bundle",
  {
    title: "Get action bundle",
    description:
      "Fetch the deterministic Markdown work-order for an action — title, status, full lineage " +
      "(focus → repo with gitUrl → arc), comments, linked PRs/commits, and a report-back " +
      "preamble. This is the canonical context to start work on an action.",
    inputSchema: { key: KEY },
  },
  async ({ key }) => {
    const res = await api("GET", `/api/actions/${normalizeKey(key)}/bundle`);
    const body = await res.text();
    if (!res.ok) throw new Error(`get_bundle ${normalizeKey(key)} → ${res.status}: ${body}`);
    return text(body);
  },
);

server.registerTool(
  "get_action",
  {
    title: "Get action",
    description: "Get one action as structured JSON (key, fields, lineage names, tags).",
    inputSchema: { key: KEY },
  },
  async ({ key }) => {
    const r = await resolve(key);
    return json({
      ...summarize(r.ws, r.action),
      description: r.action.description,
      focusName: r.focus?.name ?? null,
      repoGitUrl: r.repo?.gitUrl ?? null,
      arcDescription: r.arc?.description ?? null,
    });
  },
);

server.registerTool(
  "list_actions",
  {
    title: "List / filter actions",
    description:
      "List actions with optional filters. All filters AND together. Returns compact summaries " +
      "(key, title, status, priority, repo, arc, tags). Use this for 'my todo in repo X' queries.",
    inputSchema: {
      status: z.enum(ACTION_STATUSES).optional().describe("Exact status filter"),
      focusKey: z.string().optional().describe("Focus key prefix, e.g. PROG"),
      repo: z.string().optional().describe("Repo name (exact)"),
      arc: z.string().optional().describe("Arc name (exact)"),
      tag: z.string().optional().describe("Tag name the action carries"),
      query: z.string().optional().describe("Case-insensitive substring of title or description"),
      limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)"),
    },
  },
  async ({ status, focusKey, repo, arc, tag, query, limit }) => {
    const ws = await snapshot();
    const focusId = focusKey
      ? ws.focuses.find((p) => p.keyPrefix.toUpperCase() === focusKey.toUpperCase())?.id
      : undefined;
    if (focusKey && !focusId) throw new Error(`No focus with key prefix ${focusKey}.`);
    const repoId = repo ? ws.repos.find((r) => r.name === repo)?.id : undefined;
    if (repo && !repoId) throw new Error(`No repo named "${repo}".`);
    const arcId = arc ? ws.arcs.find((a) => a.name === arc)?.id : undefined;
    if (arc && !arcId) throw new Error(`No arc named "${arc}".`);
    const tagId = tag ? ws.tags.find((t) => t.name === tag)?.id : undefined;
    if (tag && !tagId) throw new Error(`No tag named "${tag}".`);
    const taggedActionIds = tagId
      ? new Set(ws.actionTags.filter((t) => t.tagId === tagId).map((t) => t.actionId))
      : null;
    const q = query?.toLowerCase();

    const matches = ws.actions
      .filter((i) => (status ? i.status === status : true))
      .filter((i) => (focusId ? i.focusId === focusId : true))
      .filter((i) => (repoId ? i.repoId === repoId : true))
      .filter((i) => (arcId ? i.arcId === arcId : true))
      .filter((i) => (taggedActionIds ? taggedActionIds.has(i.id) : true))
      .filter((i) =>
        q
          ? i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)
          : true,
      );

    const total = matches.length;
    const capped = matches.slice(0, limit ?? 50).map((i) => summarize(ws, i));
    return json({ total, returned: capped.length, actions: capped });
  },
);

server.registerTool(
  "create_action",
  {
    title: "Create action",
    description:
      "Create a new action in a focus. arc/repo are referenced by name and must belong to that " +
      "focus. Returns the new action's key.",
    inputSchema: {
      focusKey: z.string().describe("Focus key prefix, e.g. PROG"),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(ACTION_STATUSES).optional().describe("Default backlog"),
      priority: z.enum(ACTION_PRIORITIES).optional().describe("Default none"),
      estimate: z
        .number()
        .optional()
        .describe(`Points, one of ${ACTION_ESTIMATES.join(", ")}`),
      arc: z.string().optional().describe("Arc name within the focus"),
      repo: z.string().optional().describe("Repo name within the focus"),
      dueDate: z.string().optional().describe("Optional due date as YYYY-MM-DD (calendar day)"),
    },
  },
  async ({ focusKey, title, description, status, priority, estimate, arc, repo, dueDate }) => {
    const ws = await snapshot();
    const focus = ws.focuses.find((p) => p.keyPrefix.toUpperCase() === focusKey.toUpperCase());
    if (!focus) throw new Error(`No focus with key prefix ${focusKey}.`);
    let arcId: string | null = null;
    if (arc) {
      const found = ws.arcs.find((a) => a.name === arc && a.focusId === focus.id);
      if (!found) throw new Error(`No arc named "${arc}" in ${focus.keyPrefix}.`);
      arcId = found.id;
    }
    let repoId: string | null = null;
    if (repo) {
      const found = ws.repos.find((r) => r.name === repo && r.focusId === focus.id);
      if (!found) throw new Error(`No repo named "${repo}" in ${focus.keyPrefix}.`);
      repoId = found.id;
    }
    const { action } = await apiJson("POST", "/api/actions", {
      focusId: focus.id,
      title,
      description: description ?? "",
      status,
      priority,
      estimate: estimate ?? null,
      arcId,
      repoId,
      dueDate: dueDate ?? null,
    });
    return text(`Created ${focus.keyPrefix}-${action.number}: ${action.title} (${action.status}).`);
  },
);

server.registerTool(
  "update_status",
  {
    title: "Update action status",
    description:
      "Move an action through the fixed status set: " +
      ACTION_STATUSES.join(" → ") +
      ". Use as you work (in_progress → in_review → done).",
    inputSchema: { key: KEY, status: z.enum(ACTION_STATUSES) },
  },
  async ({ key, status }) => {
    const r = await resolve(key);
    await apiJson("PATCH", `/api/actions/${r.action.id}`, { status });
    return text(`${r.key}: ${r.action.status} → ${status}.`);
  },
);

server.registerTool(
  "set_due_date",
  {
    title: "Set or clear an action's due date",
    description:
      "Set an action's due date to a calendar day (YYYY-MM-DD), or clear it with null. Due dates " +
      "are wall-calendar days (timezone-safe) and drive the Agenda view.",
    inputSchema: {
      key: KEY,
      dueDate: z.string().nullable().describe("YYYY-MM-DD, or null to clear"),
    },
  },
  async ({ key, dueDate }) => {
    const r = await resolve(key);
    await apiJson("PATCH", `/api/actions/${r.action.id}`, { dueDate });
    return text(dueDate ? `${r.key} due ${dueDate}.` : `${r.key} due date cleared.`);
  },
);

server.registerTool(
  "comment",
  {
    title: "Comment on an action",
    description:
      "Post a Markdown comment — the report-back channel for progress notes. Mention the action " +
      "key in branches/commits/PRs for automatic linking instead.",
    inputSchema: { key: KEY, body: z.string().min(1) },
  },
  async ({ key, body }) => {
    const r = await resolve(key);
    await apiJson("POST", `/api/actions/${r.action.id}/comments`, { body });
    return text(`Comment posted on ${r.key}.`);
  },
);

server.registerTool(
  "move_action",
  {
    title: "Move action to another focus",
    description:
      "Move an action to a different focus (optionally into one of its repos). A cross-focus " +
      "move re-keys the action and retires the old key as a permanent alias.",
    inputSchema: {
      key: KEY,
      toFocusKey: z.string().describe("Destination focus key prefix"),
      repo: z.string().optional().describe("Destination repo name (optional)"),
    },
  },
  async ({ key, toFocusKey, repo }) => {
    const r = await resolve(key);
    const target = r.ws.focuses.find((p) => p.keyPrefix.toUpperCase() === toFocusKey.toUpperCase());
    if (!target) throw new Error(`No focus with key prefix ${toFocusKey}.`);
    let repoId: string | null = null;
    if (repo) {
      const found = r.ws.repos.find((x) => x.name === repo && x.focusId === target.id);
      if (!found) throw new Error(`No repo named "${repo}" in ${target.keyPrefix}.`);
      repoId = found.id;
    }
    const { action } = await apiJson("POST", `/api/actions/${r.action.id}/move`, {
      focusId: target.id,
      repoId,
    });
    const newKey = `${target.keyPrefix}-${action.number}`;
    return text(
      newKey === r.key
        ? `Moved ${r.key} within ${target.keyPrefix} (key unchanged).`
        : `Moved ${r.key} → ${newKey} (old key now redirects).`,
    );
  },
);

// ---------------------------------------------------------------------------

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
