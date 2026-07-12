// The Progress MCP toolset (SPEC §11.3, PROG-18) — transport-agnostic. Both
// servers register the same eight tools through this module:
//
//   - `src/mcp/server.ts`  — local stdio, fetches the production API directly
//   - `src/worker/mcp.ts`  — hosted on the Worker at /api/mcp (Streamable HTTP),
//                            dispatching back into the same Hono app
//
// The tools are a CLIENT of the authenticated API (injected as `ApiFetch`),
// not a second copy of the domain logic, so the Worker stays the single source
// of truth (the "rigid simplicity" rule). Nothing here may touch process.env,
// node APIs, or Workers bindings — transports own their environments.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ACTION_ESTIMATES, ACTION_PRIORITIES, ACTION_STATUSES } from "../shared/constants";

// Issues an authenticated request against the Progress API. Each transport
// supplies its own: stdio adds the bearer from env and fetches production;
// the Worker forwards the caller's credentials into a self-dispatch.
export type ApiFetch = (method: string, path: string, body?: unknown) => Promise<Response>;

async function apiJson(api: ApiFetch, method: string, path: string, body?: unknown): Promise<any> {
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
// resolve both forms off one snapshot, the same way the Worker does.

type Snapshot = {
  focuses: any[];
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
  arc: any | null;
  key: string;
};

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
// Tool registration (SPEC §11.3)
// ---------------------------------------------------------------------------

const KEY = z.string().describe("Action key like PROG-18 (retired/alias keys resolve too)");

export function registerProgressTools(server: McpServer, api: ApiFetch): void {
  async function snapshot(): Promise<Snapshot> {
    return (await apiJson(api, "GET", "/api/snapshot")) as Snapshot;
  }

  async function resolve(rawKey: string): Promise<Resolved> {
    const ws = await snapshot();
    const action = findActionByKey(ws, rawKey);
    if (!action) throw new Error(`No action found for key ${normalizeKey(rawKey)}.`);
    const focus = ws.focuses.find((p) => p.id === action.focusId) ?? null;
    const arc = action.arcId ? (ws.arcs.find((a) => a.id === action.arcId) ?? null) : null;
    return { ws, action, focus, arc, key: liveKey(ws, action) };
  }

  server.registerTool(
    "get_bundle",
    {
      title: "Get action bundle",
      description:
        "Fetch the deterministic Markdown work-order for an action — title, status, full lineage " +
        "(focus with optional gitUrl → arc), comments, linked PRs/commits, and a report-back " +
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
        focusGitUrl: r.focus?.gitUrl ?? null,
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
        "(key, title, status, priority, arc, tags). Use this for 'my todo in focus X' queries.",
      inputSchema: {
        status: z.enum(ACTION_STATUSES).optional().describe("Exact status filter"),
        focusKey: z.string().optional().describe("Focus key prefix, e.g. PROG"),
        arc: z.string().optional().describe("Arc name (exact)"),
        tag: z.string().optional().describe("Tag name the action carries"),
        query: z.string().optional().describe("Case-insensitive substring of title or description"),
        limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)"),
      },
    },
    async ({ status, focusKey, arc, tag, query, limit }) => {
      const ws = await snapshot();
      const focusId = focusKey
        ? ws.focuses.find((p) => p.keyPrefix.toUpperCase() === focusKey.toUpperCase())?.id
        : undefined;
      if (focusKey && !focusId) throw new Error(`No focus with key prefix ${focusKey}.`);
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
        "Create a new action in a focus. arc is referenced by name and must belong to that " +
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
        dueDate: z.string().optional().describe("Optional due date as YYYY-MM-DD (calendar day)"),
      },
    },
    async ({ focusKey, title, description, status, priority, estimate, arc, dueDate }) => {
      const ws = await snapshot();
      const focus = ws.focuses.find((p) => p.keyPrefix.toUpperCase() === focusKey.toUpperCase());
      if (!focus) throw new Error(`No focus with key prefix ${focusKey}.`);
      let arcId: string | null = null;
      if (arc) {
        const found = ws.arcs.find((a) => a.name === arc && a.focusId === focus.id);
        if (!found) throw new Error(`No arc named "${arc}" in ${focus.keyPrefix}.`);
        arcId = found.id;
      }
      const { action } = await apiJson(api, "POST", "/api/actions", {
        focusId: focus.id,
        title,
        description: description ?? "",
        status,
        priority,
        estimate: estimate ?? null,
        arcId,
        dueDate: dueDate ?? null,
      });
      return text(
        `Created ${focus.keyPrefix}-${action.number}: ${action.title} (${action.status}).`,
      );
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
      await apiJson(api, "PATCH", `/api/actions/${r.action.id}`, { status });
      return text(`${r.key}: ${r.action.status} → ${status}.`);
    },
  );

  server.registerTool(
    "set_due_date",
    {
      title: "Set or clear an action's due date",
      description:
        "Set an action's due date to a calendar day (YYYY-MM-DD), or clear it with null. Due " +
        "dates are wall-calendar days (timezone-safe) and drive the Agenda view.",
      inputSchema: {
        key: KEY,
        dueDate: z.string().nullable().describe("YYYY-MM-DD, or null to clear"),
      },
    },
    async ({ key, dueDate }) => {
      const r = await resolve(key);
      await apiJson(api, "PATCH", `/api/actions/${r.action.id}`, { dueDate });
      return text(dueDate ? `${r.key} due ${dueDate}.` : `${r.key} due date cleared.`);
    },
  );

  server.registerTool(
    "comment",
    {
      title: "Comment on an action",
      description:
        "Post a Markdown comment — the report-back channel for progress notes. Mention the " +
        "action key in branches/commits/PRs for automatic linking instead.",
      inputSchema: { key: KEY, body: z.string().min(1) },
    },
    async ({ key, body }) => {
      const r = await resolve(key);
      await apiJson(api, "POST", `/api/actions/${r.action.id}/comments`, { body });
      return text(`Comment posted on ${r.key}.`);
    },
  );

  server.registerTool(
    "move_action",
    {
      title: "Move action to another focus",
      description:
        "Move an action to a different focus. The move re-keys the action and retires the old " +
        "key as a permanent alias.",
      inputSchema: {
        key: KEY,
        toFocusKey: z.string().describe("Destination focus key prefix"),
      },
    },
    async ({ key, toFocusKey }) => {
      const r = await resolve(key);
      const target = r.ws.focuses.find(
        (p) => p.keyPrefix.toUpperCase() === toFocusKey.toUpperCase(),
      );
      if (!target) throw new Error(`No focus with key prefix ${toFocusKey}.`);
      const { action } = await apiJson(api, "POST", `/api/actions/${r.action.id}/move`, {
        focusId: target.id,
      });
      const newKey = `${target.keyPrefix}-${action.number}`;
      return text(`Moved ${r.key} → ${newKey} (old key now redirects).`);
    },
  );
}
