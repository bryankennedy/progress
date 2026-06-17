#!/usr/bin/env bun
// Progress MCP server (SPEC §11.3, PROG-18). A local stdio MCP server that wraps
// the production Progress API and authenticates with a Cloudflare Access service
// token (§11.4) — the same bypass pattern the webhook uses with HMAC. It is a
// CLIENT of the Access-protected API, not a second copy of the domain logic, so
// the Worker stays the single source of truth (the "rigid simplicity" rule).
//
// Run:   bun src/mcp/server.ts   (or `bun run mcp`)
// Env:   PROGRESS_BASE_URL                 (default: production URL below)
//        CF_ACCESS_CLIENT_ID  / CF_ACCESS_CLIENT_SECRET   (the service token)
//          — falls back to PROD_CF_ACCESS_CLIENT_ID/SECRET so the same .env the
//            dogfood scripts use just works.
//
// Register in Claude Code (see docs/SETUP.md §7):
//   claude mcp add progress -- bun /abs/path/to/src/mcp/server.ts
// with the service-token env vars in scope.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ISSUE_ESTIMATES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
} from "../shared/constants";

// ---------------------------------------------------------------------------
// Config + API client
// ---------------------------------------------------------------------------

const BASE = (process.env.PROGRESS_BASE_URL ?? "https://progress.bryan-22c.workers.dev").replace(
  /\/+$/,
  "",
);
const CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? process.env.PROD_CF_ACCESS_CLIENT_ID;
const CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? process.env.PROD_CF_ACCESS_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "[progress-mcp] Missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (or PROD_* fallbacks).\n" +
      "Create a Cloudflare Access service token and grant it via the Service Auth policy\n" +
      "on the Progress app (docs/SETUP.md §6/§7), then expose those vars to this server.",
  );
  process.exit(1);
}

const accessHeaders: Record<string, string> = {
  "CF-Access-Client-Id": CLIENT_ID,
  "CF-Access-Client-Secret": CLIENT_SECRET,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: accessHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 0) {
    throw new Error(
      `${method} ${path} redirected to the Access login — the service token is not being ` +
        `accepted. Check the Service Auth policy on the Progress app.`,
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
// Workspace + alias-aware key resolution
// ---------------------------------------------------------------------------
// Issue keys are derived (PREFIX-number), never stored, and a cross-product move
// retires the old key into issueKeyAliases as a permanent redirect (D18). We
// resolve both forms off one workspace snapshot, the same way the Worker does.

type Workspace = {
  products: any[];
  repos: any[];
  arcs: any[];
  issues: any[];
  tags: any[];
  issueTags: any[];
  issueKeyAliases: any[];
};

type Resolved = {
  ws: Workspace;
  issue: any;
  product: any;
  repo: any | null;
  arc: any | null;
  key: string;
};

async function workspace(): Promise<Workspace> {
  return (await apiJson("GET", "/api/workspace")) as Workspace;
}

function prefixOf(ws: Workspace, productId: string): string {
  return ws.products.find((p) => p.id === productId)?.keyPrefix ?? "???";
}

function liveKey(ws: Workspace, issue: any): string {
  return `${prefixOf(ws, issue.productId)}-${issue.number}`;
}

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase();
}

// key → issue, honoring current keys first then retired aliases.
function findIssueByKey(ws: Workspace, rawKey: string): any | null {
  const key = normalizeKey(rawKey);
  const live = ws.issues.find((i) => liveKey(ws, i) === key);
  if (live) return live;
  const alias = ws.issueKeyAliases.find((a) => a.key.toUpperCase() === key);
  if (alias) return ws.issues.find((i) => i.id === alias.issueId) ?? null;
  return null;
}

async function resolve(rawKey: string): Promise<Resolved> {
  const ws = await workspace();
  const issue = findIssueByKey(ws, rawKey);
  if (!issue) throw new Error(`No issue found for key ${normalizeKey(rawKey)}.`);
  const product = ws.products.find((p) => p.id === issue.productId) ?? null;
  const repo = issue.repoId ? ws.repos.find((r) => r.id === issue.repoId) ?? null : null;
  const arc = issue.arcId ? ws.arcs.find((a) => a.id === issue.arcId) ?? null : null;
  return { ws, issue, product, repo, arc, key: liveKey(ws, issue) };
}

function tagNamesFor(ws: Workspace, issueId: string): string[] {
  const ids = new Set(ws.issueTags.filter((t) => t.issueId === issueId).map((t) => t.tagId));
  return ws.tags
    .filter((t) => ids.has(t.id))
    .map((t) => t.name)
    .sort();
}

// Compact, agent-friendly view of an issue (keys, not opaque ids).
function summarize(ws: Workspace, issue: any) {
  return {
    key: liveKey(ws, issue),
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    estimate: issue.estimate,
    product: prefixOf(ws, issue.productId),
    repo: issue.repoId ? ws.repos.find((r) => r.id === issue.repoId)?.name ?? null : null,
    arc: issue.arcId ? ws.arcs.find((a) => a.id === issue.arcId)?.name ?? null : null,
    tags: tagNamesFor(ws, issue.id),
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

const KEY = z.string().describe("Issue key like PROG-18 (retired/alias keys resolve too)");

server.registerTool(
  "get_bundle",
  {
    title: "Get issue bundle",
    description:
      "Fetch the deterministic Markdown work-order for an issue — title, status, full lineage " +
      "(product → repo with gitUrl → arc), comments, linked PRs/commits, and a report-back " +
      "preamble. This is the canonical context to start work on an issue.",
    inputSchema: { key: KEY },
  },
  async ({ key }) => {
    const res = await api("GET", `/api/issues/${normalizeKey(key)}/bundle`);
    const body = await res.text();
    if (!res.ok) throw new Error(`get_bundle ${normalizeKey(key)} → ${res.status}: ${body}`);
    return text(body);
  },
);

server.registerTool(
  "get_issue",
  {
    title: "Get issue",
    description: "Get one issue as structured JSON (key, fields, lineage names, tags).",
    inputSchema: { key: KEY },
  },
  async ({ key }) => {
    const r = await resolve(key);
    return json({
      ...summarize(r.ws, r.issue),
      description: r.issue.description,
      productName: r.product?.name ?? null,
      repoGitUrl: r.repo?.gitUrl ?? null,
      arcDescription: r.arc?.description ?? null,
    });
  },
);

server.registerTool(
  "list_issues",
  {
    title: "List / filter issues",
    description:
      "List issues with optional filters. All filters AND together. Returns compact summaries " +
      "(key, title, status, priority, repo, arc, tags). Use this for 'my todo in repo X' queries.",
    inputSchema: {
      status: z.enum(ISSUE_STATUSES).optional().describe("Exact status filter"),
      productKey: z.string().optional().describe("Product key prefix, e.g. PROG"),
      repo: z.string().optional().describe("Repo name (exact)"),
      arc: z.string().optional().describe("Arc name (exact)"),
      tag: z.string().optional().describe("Tag name the issue carries"),
      query: z.string().optional().describe("Case-insensitive substring of title or description"),
      limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)"),
    },
  },
  async ({ status, productKey, repo, arc, tag, query, limit }) => {
    const ws = await workspace();
    const productId = productKey
      ? ws.products.find((p) => p.keyPrefix.toUpperCase() === productKey.toUpperCase())?.id
      : undefined;
    if (productKey && !productId) throw new Error(`No product with key prefix ${productKey}.`);
    const repoId = repo ? ws.repos.find((r) => r.name === repo)?.id : undefined;
    if (repo && !repoId) throw new Error(`No repo named "${repo}".`);
    const arcId = arc ? ws.arcs.find((a) => a.name === arc)?.id : undefined;
    if (arc && !arcId) throw new Error(`No arc named "${arc}".`);
    const tagId = tag ? ws.tags.find((t) => t.name === tag)?.id : undefined;
    if (tag && !tagId) throw new Error(`No tag named "${tag}".`);
    const taggedIssueIds = tagId
      ? new Set(ws.issueTags.filter((t) => t.tagId === tagId).map((t) => t.issueId))
      : null;
    const q = query?.toLowerCase();

    const matches = ws.issues
      .filter((i) => (status ? i.status === status : true))
      .filter((i) => (productId ? i.productId === productId : true))
      .filter((i) => (repoId ? i.repoId === repoId : true))
      .filter((i) => (arcId ? i.arcId === arcId : true))
      .filter((i) => (taggedIssueIds ? taggedIssueIds.has(i.id) : true))
      .filter((i) =>
        q
          ? i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)
          : true,
      );

    const total = matches.length;
    const capped = matches.slice(0, limit ?? 50).map((i) => summarize(ws, i));
    return json({ total, returned: capped.length, issues: capped });
  },
);

server.registerTool(
  "create_issue",
  {
    title: "Create issue",
    description:
      "Create a new issue in a product. arc/repo are referenced by name and must belong to that " +
      "product. Returns the new issue's key.",
    inputSchema: {
      productKey: z.string().describe("Product key prefix, e.g. PROG"),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(ISSUE_STATUSES).optional().describe("Default backlog"),
      priority: z.enum(ISSUE_PRIORITIES).optional().describe("Default none"),
      estimate: z
        .number()
        .optional()
        .describe(`Points, one of ${ISSUE_ESTIMATES.join(", ")}`),
      arc: z.string().optional().describe("Arc name within the product"),
      repo: z.string().optional().describe("Repo name within the product"),
    },
  },
  async ({ productKey, title, description, status, priority, estimate, arc, repo }) => {
    const ws = await workspace();
    const product = ws.products.find((p) => p.keyPrefix.toUpperCase() === productKey.toUpperCase());
    if (!product) throw new Error(`No product with key prefix ${productKey}.`);
    let arcId: string | null = null;
    if (arc) {
      const found = ws.arcs.find((a) => a.name === arc && a.productId === product.id);
      if (!found) throw new Error(`No arc named "${arc}" in ${product.keyPrefix}.`);
      arcId = found.id;
    }
    let repoId: string | null = null;
    if (repo) {
      const found = ws.repos.find((r) => r.name === repo && r.productId === product.id);
      if (!found) throw new Error(`No repo named "${repo}" in ${product.keyPrefix}.`);
      repoId = found.id;
    }
    const { issue } = await apiJson("POST", "/api/issues", {
      productId: product.id,
      title,
      description: description ?? "",
      status,
      priority,
      estimate: estimate ?? null,
      arcId,
      repoId,
    });
    return text(`Created ${product.keyPrefix}-${issue.number}: ${issue.title} (${issue.status}).`);
  },
);

server.registerTool(
  "update_status",
  {
    title: "Update issue status",
    description:
      "Move an issue through the fixed status set: " +
      ISSUE_STATUSES.join(" → ") +
      ". Use as you work (in_progress → in_review → done).",
    inputSchema: { key: KEY, status: z.enum(ISSUE_STATUSES) },
  },
  async ({ key, status }) => {
    const r = await resolve(key);
    await apiJson("PATCH", `/api/issues/${r.issue.id}`, { status });
    return text(`${r.key}: ${r.issue.status} → ${status}.`);
  },
);

server.registerTool(
  "comment",
  {
    title: "Comment on an issue",
    description:
      "Post a Markdown comment — the report-back channel for progress notes. Mention the issue " +
      "key in branches/commits/PRs for automatic linking instead.",
    inputSchema: { key: KEY, body: z.string().min(1) },
  },
  async ({ key, body }) => {
    const r = await resolve(key);
    await apiJson("POST", `/api/issues/${r.issue.id}/comments`, { body });
    return text(`Comment posted on ${r.key}.`);
  },
);

server.registerTool(
  "move_issue",
  {
    title: "Move issue to another product",
    description:
      "Move an issue to a different product (optionally into one of its repos). A cross-product " +
      "move re-keys the issue and retires the old key as a permanent alias.",
    inputSchema: {
      key: KEY,
      toProductKey: z.string().describe("Destination product key prefix"),
      repo: z.string().optional().describe("Destination repo name (optional)"),
    },
  },
  async ({ key, toProductKey, repo }) => {
    const r = await resolve(key);
    const target = r.ws.products.find(
      (p) => p.keyPrefix.toUpperCase() === toProductKey.toUpperCase(),
    );
    if (!target) throw new Error(`No product with key prefix ${toProductKey}.`);
    let repoId: string | null = null;
    if (repo) {
      const found = r.ws.repos.find((x) => x.name === repo && x.productId === target.id);
      if (!found) throw new Error(`No repo named "${repo}" in ${target.keyPrefix}.`);
      repoId = found.id;
    }
    const { issue } = await apiJson("POST", `/api/issues/${r.issue.id}/move`, {
      productId: target.id,
      repoId,
    });
    const newKey = `${target.keyPrefix}-${issue.number}`;
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
