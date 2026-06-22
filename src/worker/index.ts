import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  activity,
  arcs,
  comments,
  commitLinks,
  initiatives,
  ISSUE_ESTIMATES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issueKeyAliases,
  issues,
  issueTags,
  prLinks,
  products,
  repos,
  tags,
  users,
  type IssuePriority,
  type IssueStatus,
  type PrState,
} from "../db/schema";
import { tagColor } from "../shared/constants";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SECONDS,
  authConfigured,
  redirectUri,
  isAllowed,
  googleAuthUrl,
  exchangeCodeForIdentity,
  signSession,
  verifySession,
  signState,
  verifyState,
  type AuthEnv,
} from "./auth";

type Bindings = AuthEnv & {
  DB: D1Database;
  // Shared secret for GitHub webhook HMAC verification (SPEC §5). Local dev:
  // .dev.vars; production: `wrangler secret put GITHUB_WEBHOOK_SECRET`.
  GITHUB_WEBHOOK_SECRET?: string;
};

// Per-request identity set by the auth middleware (PROG-34): the logged-in
// user's id (session cookie), or the owner for the automation bearer token and
// the local-dev fallback.
type Variables = { userId: string };

// The owner row the seed guarantees (D13). Still the actor for the automation
// bearer token, the webhook (no interactive user), and the local-dev fallback.
const OWNER_ID = "usr_owner";

// Constant-time string compare for the API bearer token (same shape as the
// webhook's HMAC compare below).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

// Local-dev detection for the unconfigured-auth fallback below. Only a loopback
// origin may run unauthenticated-as-owner; any real (deployed) hostname without
// configured auth must fail CLOSED. Without this, a production deploy that lost
// its OAuth/session secrets would silently serve the entire write API as the
// owner instead of returning 401.
function isLoopbackHost(requestUrl: string): boolean {
  const host = new URL(requestUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// Due dates (SPEC v2 §5) are wall-calendar days stored as ISO `YYYY-MM-DD`
// text — timezone-safe by design. Accept the canonical form only, and reject
// impossible dates (e.g. 2026-13-40) by round-tripping through UTC: parsing at
// midnight UTC and re-serializing must reproduce the input exactly.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDueDate = (s: string): boolean => {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Without this, an uncaught throw became a bare "Internal Server Error" with
// nothing in the logs — which is exactly why a production /api/workspace 500
// was undiagnosable. Log the full error server-side (visible in `wrangler
// tail`); keep the response body generic so the Access-bypassed webhook path
// can't be used to read internals.
app.onError((err, c) => {
  console.error("worker error:", c.req.method, c.req.path, err);
  return c.json({ error: "internal_error" }, 500);
});

// ---------- authentication (PROG-34, supersedes the Cloudflare Access gate D12) ----------
//
// Gate every /api route except health, the OAuth dance itself, and the GitHub
// webhook (HMAC-authenticated, no interactive user). Identity comes from, in
// order: the automation bearer token (→ owner), a valid session cookie, or —
// when auth is unconfigured AND the request is to a loopback origin (local
// dev) — a fallback to the owner so `bun run dev` and tests never hit a login
// wall. A deployed origin with unconfigured auth fails closed. Otherwise 401.
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/api/health" ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/webhooks/")
  )
    return next();

  const env = c.env;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (env.PROGRESS_API_TOKEN && safeEqual(token, env.PROGRESS_API_TOKEN)) {
      c.set("userId", OWNER_ID);
      return next();
    }
    return c.json({ error: "unauthenticated" }, 401);
  }

  if (env.SESSION_SECRET) {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) {
      const session = await verifySession(cookie, env.SESSION_SECRET);
      if (session) {
        c.set("userId", session.uid);
        return next();
      }
    }
  }

  if (!authConfigured(env) && isLoopbackHost(c.req.url)) {
    c.set("userId", OWNER_ID);
    return next();
  }
  return c.json({ error: "unauthenticated" }, 401);
});

// Begin the OAuth flow: stash a signed state nonce in a short-lived cookie and
// bounce to Google's consent screen.
app.get("/api/auth/login", async (c) => {
  const env = c.env;
  if (!authConfigured(env)) return c.json({ error: "auth not configured" }, 503);
  const secure = new URL(c.req.url).protocol === "https:";
  const state = await signState(env.SESSION_SECRET!);
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  return c.redirect(googleAuthUrl(env, state, redirectUri(env, c.req.url)));
});

// OAuth redirect target: verify state, exchange the code, enforce the email
// allowlist, upsert the user by email (preserving the existing owner row), and
// set the session cookie.
app.get("/api/auth/callback", async (c) => {
  const env = c.env;
  if (!authConfigured(env)) return c.json({ error: "auth not configured" }, 503);
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stateCookie = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  if (
    !code ||
    !state ||
    !stateCookie ||
    !safeEqual(state, stateCookie) ||
    !(await verifyState(state, env.SESSION_SECRET!))
  )
    return c.json({ error: "invalid oauth state" }, 400);

  let identity;
  try {
    identity = await exchangeCodeForIdentity(env, code, redirectUri(env, c.req.url));
  } catch (e) {
    console.error("oauth callback:", e);
    return c.json({ error: "authentication failed" }, 400);
  }
  if (!isAllowed(identity.email, env)) return c.json({ error: "not authorized" }, 403);

  const db = drizzle(env.DB);
  const email = identity.email.toLowerCase();
  const now = new Date();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: string;
  if (existing) {
    userId = existing.id;
    if (identity.name && identity.name !== existing.name)
      await db.update(users).set({ name: identity.name }).where(eq(users.id, existing.id));
  } else {
    userId = newId("usr");
    await db.insert(users).values({ id: userId, name: identity.name, email, createdAt: now });
  }

  const session = await signSession(userId, email, env.SESSION_SECRET!);
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect("/");
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Readiness, not just liveness: a trivial round-trip to D1 so the check fails
// (503) when the database binding is unreachable, instead of reporting healthy
// just because the Worker booted. Kept cheap — `SELECT 1`, no table access.
app.get("/api/health", async (c) => {
  try {
    await drizzle(c.env.DB).run(sql`select 1`);
    return c.json({ ok: true, db: "ok" });
  } catch (e) {
    console.error("health: D1 probe failed:", e);
    return c.json({ ok: false, db: "error" }, 503);
  }
});

// The single "load everything" endpoint that feeds the client store
// (SPEC §8.2: fetch the full workspace up front, render from memory after).
// Comments and activity are deliberately excluded — they're the only
// unbounded-growth data and aren't needed to render boards/lists; the issue
// page loads them per issue.
app.get("/api/workspace", async (c) => {
  const db = drizzle(c.env.DB);
  const [
    allUsers,
    allInitiatives,
    allProducts,
    allRepos,
    allArcs,
    allIssues,
    allTags,
    allIssueTags,
    allKeyAliases,
  ] = await Promise.all([
    // These nine reads are independent and need no transaction, so they run as
    // parallel queries rather than a single D1 `db.batch` (an implicit
    // transaction). The batch form 500'd on production D1 while working under
    // local Miniflare; Promise.all is the Cloudflare-recommended shape for
    // independent reads and removes that runtime difference. See DECISIONS D31.
    db.select().from(users),
    db.select().from(initiatives),
    db.select().from(products),
    db.select().from(repos),
    db.select().from(arcs),
    db.select().from(issues),
    db.select().from(tags),
    db.select().from(issueTags),
    db.select().from(issueKeyAliases),
  ]);
  return c.json({
    // The authenticated identity, so the client can render who's signed in and
    // attribute "mine" without a second round trip (PROG-34).
    me: allUsers.find((u) => u.id === c.get("userId")) ?? null,
    users: allUsers,
    initiatives: allInitiatives,
    products: allProducts,
    repos: allRepos,
    arcs: allArcs,
    issues: allIssues,
    tags: allTags,
    issueTags: allIssueTags,
    issueKeyAliases: allKeyAliases,
  });
});

// ---------- container CRUD (D26) ----------

type ContainerBody = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  initiativeId?: unknown;
  productId?: unknown;
  keyPrefix?: unknown;
  gitUrl?: unknown;
  archived?: unknown;
};

// Letters only: a digit in the prefix would break PREFIX-n key parsing.
const KEY_PREFIX_RE = /^[A-Z]{2,8}$/;

const badName = (name: unknown) => typeof name !== "string" || name.trim() === "";

// Container ids may be client-generated (D26: the store creates the row
// optimistically and navigates to /type/:id immediately, so the id must not
// change on reconcile). Anything malformed falls back to a server id.
const idOr = (id: unknown, prefix: string) =>
  typeof id === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id) ? id : newId(prefix);

// Shared PATCH fields for all four container types; archive/unarchive is the
// `archived` boolean mapped onto archivedAt (SPEC §3: no hard deletes).
function containerPatchSet(body: ContainerBody): { set: Record<string, unknown>; error?: string } {
  const set: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (badName(body.name)) return { set, error: "name must be a non-empty string" };
    set.name = (body.name as string).trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { set, error: "description must be a string" };
    set.description = body.description;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return { set, error: "archived must be a boolean" };
    set.archivedAt = body.archived ? new Date() : null;
  }
  return { set };
}

app.post("/api/initiatives", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  const now = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .insert(initiatives)
    .values({
      id: idOr(body.id, "ini"),
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      creatorId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/products", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
    return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
  const keyPrefix = body.keyPrefix.toUpperCase();
  if (typeof body.initiativeId !== "string")
    return c.json({ error: "initiativeId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [initiative] = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, body.initiativeId))
    .limit(1);
  if (!initiative) return c.json({ error: "initiative not found" }, 400);
  const [clash] = await db.select().from(products).where(eq(products.keyPrefix, keyPrefix)).limit(1);
  if (clash) return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);

  const now = new Date();
  const [container] = await db
    .insert(products)
    .values({
      id: idOr(body.id, "prd"),
      initiativeId: body.initiativeId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      keyPrefix,
      creatorId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/repos", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.productId !== "string") return c.json({ error: "productId is required" }, 400);
  const gitUrl = body.gitUrl ?? null;
  if (gitUrl !== null && typeof gitUrl !== "string")
    return c.json({ error: "gitUrl must be a string or null" }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);

  const now = new Date();
  const [container] = await db
    .insert(repos)
    .values({
      id: idOr(body.id, "rep"),
      productId: body.productId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      gitUrl,
      creatorId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.post("/api/arcs", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.productId !== "string") return c.json({ error: "productId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db.select().from(products).where(eq(products.id, body.productId)).limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);

  const now = new Date();
  const [container] = await db
    .insert(arcs)
    .values({
      id: idOr(body.id, "arc"),
      productId: body.productId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      creatorId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.patch("/api/initiatives/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(initiatives)
    .set(set)
    .where(eq(initiatives.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "initiative not found" }, 404);
  return c.json({ container });
});

app.patch("/api/products/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  const db = drizzle(c.env.DB);
  if (body.keyPrefix !== undefined) {
    if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
      return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
    const keyPrefix = body.keyPrefix.toUpperCase();
    const [clash] = await db.select().from(products).where(eq(products.keyPrefix, keyPrefix)).limit(1);
    if (clash && clash.id !== id) return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);
    // Safe rename: issue keys are derived from the prefix, never stored (D18).
    set.keyPrefix = keyPrefix;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const [container] = await db.update(products).set(set).where(eq(products.id, id)).returning();
  if (!container) return c.json({ error: "product not found" }, 404);
  return c.json({ container });
});

app.patch("/api/repos/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (body.gitUrl !== undefined) {
    if (body.gitUrl !== null && typeof body.gitUrl !== "string")
      return c.json({ error: "gitUrl must be a string or null" }, 400);
    set.gitUrl = body.gitUrl;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(repos)
    .set(set)
    .where(eq(repos.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "repo not found" }, 404);
  return c.json({ container });
});

app.patch("/api/arcs/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body);
  if (error) return c.json({ error }, 400);
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(arcs)
    .set(set)
    .where(eq(arcs.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "arc not found" }, 404);
  return c.json({ container });
});

// ---------- tags (D27) ----------

// Assign a tag: by tagId for an existing tag, or by name (create-or-get,
// then assign) so the client's "create tag and add it" is one atomic call.
app.post("/api/issues/:id/tags", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { tagId?: unknown; name?: unknown; id?: unknown };
  const db = drizzle(c.env.DB);
  const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id)).limit(1);
  if (!issue) return c.json({ error: "issue not found" }, 404);

  let tag;
  if (typeof body.tagId === "string") {
    [tag] = await db.select().from(tags).where(eq(tags.id, body.tagId)).limit(1);
    if (!tag) return c.json({ error: "tag not found" }, 400);
  } else if (typeof body.name === "string" && body.name.trim() !== "") {
    const name = body.name.trim();
    [tag] = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
    if (!tag) {
      [tag] = await db
        .insert(tags)
        .values({ id: idOr(body.id, "tag"), name, color: tagColor(name), createdAt: new Date() })
        .returning();
    }
  } else {
    return c.json({ error: "tagId or name is required" }, 400);
  }

  await db.insert(issueTags).values({ issueId: id, tagId: tag!.id }).onConflictDoNothing();
  return c.json({ tag, link: { issueId: id, tagId: tag!.id } }, 201);
});

app.delete("/api/issues/:id/tags/:tagId", async (c) => {
  const db = drizzle(c.env.DB);
  await db
    .delete(issueTags)
    .where(
      and(eq(issueTags.issueId, c.req.param("id")), eq(issueTags.tagId, c.req.param("tagId"))),
    );
  return c.json({ ok: true });
});

type IssueCreateBody = {
  title?: unknown;
  productId?: unknown;
  repoId?: unknown;
  arcId?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  estimate?: unknown;
  dueDate?: unknown;
};

// Issue creation (SPEC §3): the issue number comes from the product's
// next_issue_number sequence (D18), allocated with an atomic increment. A
// crash between allocation and insert leaves a number gap, which is harmless.
app.post("/api/issues", async (c) => {
  const body = (await c.req.json()) as IssueCreateBody;
  if (typeof body.title !== "string" || body.title.trim() === "")
    return c.json({ error: "title must be a non-empty string" }, 400);
  if (typeof body.productId !== "string")
    return c.json({ error: "productId is required" }, 400);
  const repoId = body.repoId ?? null;
  if (repoId !== null && typeof repoId !== "string")
    return c.json({ error: "repoId must be a string or null" }, 400);
  const arcId = body.arcId ?? null;
  if (arcId !== null && typeof arcId !== "string")
    return c.json({ error: "arcId must be a string or null" }, 400);
  const description = body.description ?? "";
  if (typeof description !== "string")
    return c.json({ error: "description must be a string" }, 400);
  const status = (body.status ?? "backlog") as IssueStatus;
  if (!ISSUE_STATUSES.includes(status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  const priority = (body.priority ?? "none") as IssuePriority;
  if (!ISSUE_PRIORITIES.includes(priority))
    return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
  const estimate = (body.estimate ?? null) as number | null;
  if (estimate !== null && !(ISSUE_ESTIMATES as readonly number[]).includes(estimate))
    return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);
  const dueDate = (body.dueDate ?? null) as string | null;
  if (dueDate !== null && (typeof dueDate !== "string" || !isValidDueDate(dueDate)))
    return c.json({ error: `invalid dueDate: ${String(body.dueDate)} (expected YYYY-MM-DD)` }, 400);

  const db = drizzle(c.env.DB);
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);
  if (!product) return c.json({ error: "product not found" }, 400);
  // The invariants SQLite can't express (D17): repo and arc must belong to
  // the issue's product.
  if (repoId !== null) {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo || repo.productId !== product.id)
      return c.json({ error: "repo not found in that product" }, 400);
  }
  if (arcId !== null) {
    const [arc] = await db.select().from(arcs).where(eq(arcs.id, arcId)).limit(1);
    if (!arc || arc.productId !== product.id)
      return c.json({ error: "arc not found in that product" }, 400);
  }

  const [seq] = await db
    .update(products)
    .set({ nextIssueNumber: sql`${products.nextIssueNumber} + 1` })
    .where(eq(products.id, product.id))
    .returning({ next: products.nextIssueNumber });
  const now = new Date();
  const [issue] = await db
    .insert(issues)
    .values({
      id: newId("iss"),
      productId: product.id,
      repoId,
      arcId,
      number: seq!.next - 1,
      title: body.title.trim(),
      description,
      status,
      priority,
      estimate,
      dueDate,
      creatorId: c.get("userId"),
      assigneeId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
    })
    .returning();
  return c.json({ issue }, 201);
});

type IssueMoveBody = { productId?: unknown; repoId?: unknown };

// Issue movement (SPEC §3): within a product the key (and arc) survive; a
// cross-product move re-keys from the target's sequence, clears the arc, and
// retires the old key into issue_key_aliases as a permanent redirect (D18).
app.post("/api/issues/:id/move", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as IssueMoveBody;
  if (typeof body.productId !== "string")
    return c.json({ error: "productId is required" }, 400);
  const repoId = body.repoId ?? null;
  if (repoId !== null && typeof repoId !== "string")
    return c.json({ error: "repoId must be a string or null" }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);
  const [target] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);
  if (!target) return c.json({ error: "product not found" }, 400);
  if (repoId !== null) {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo || repo.productId !== target.id)
      return c.json({ error: "repo not found in that product" }, 400);
  }
  if (existing.productId === target.id && existing.repoId === repoId)
    return c.json({ error: "issue is already in that container" }, 400);

  const now = new Date();
  const moveData = {
    fromProductId: existing.productId,
    fromRepoId: existing.repoId,
    toProductId: target.id,
    toRepoId: repoId,
  };

  if (existing.productId === target.id) {
    // Within-product move: key and arc are kept.
    const [updated] = await db.batch([
      db.update(issues).set({ repoId, updatedAt: now }).where(eq(issues.id, id)).returning(),
      db.insert(activity).values({
        id: newId("act"),
        issueId: id,
        actorId: c.get("userId"),
        type: "moved",
        data: moveData,
        createdAt: now,
      }),
    ]);
    return c.json({ issue: updated[0] });
  }

  const [oldProduct] = await db
    .select()
    .from(products)
    .where(eq(products.id, existing.productId))
    .limit(1);
  const oldKey = `${oldProduct!.keyPrefix}-${existing.number}`;
  const [seq] = await db
    .update(products)
    .set({ nextIssueNumber: sql`${products.nextIssueNumber} + 1` })
    .where(eq(products.id, target.id))
    .returning({ next: products.nextIssueNumber });
  const number = seq!.next - 1;
  const [updated] = await db.batch([
    db
      .update(issues)
      .set({ productId: target.id, repoId, arcId: null, number, updatedAt: now })
      .where(eq(issues.id, id))
      .returning(),
    db.insert(issueKeyAliases).values({ key: oldKey, issueId: id, createdAt: now }),
    db.insert(activity).values({
      id: newId("act"),
      issueId: id,
      actorId: c.get("userId"),
      type: "moved",
      data: { ...moveData, fromKey: oldKey, toKey: `${target.keyPrefix}-${number}` },
      createdAt: now,
    }),
  ]);
  return c.json({ issue: updated[0] });
});

type IssuePatchBody = Partial<{
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  estimate: number | null;
  arcId: string | null;
  dueDate: string | null;
}>;

// Generalized issue field update — the server side of the optimistic-mutation
// template. Validates per field; a status change also appends an activity
// event (the issue page's timeline interleaves these with comments).
app.patch("/api/issues/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as IssuePatchBody;
  const set: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim() === "")
      return c.json({ error: "title must be a non-empty string" }, 400);
    set.title = body.title.trim();
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string")
      return c.json({ error: "description must be a string" }, 400);
    set.description = body.description;
  }
  if (body.status !== undefined && !ISSUE_STATUSES.includes(body.status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  if (body.priority !== undefined) {
    if (!ISSUE_PRIORITIES.includes(body.priority))
      return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
    set.priority = body.priority;
  }
  if (body.estimate !== undefined) {
    if (body.estimate !== null && !(ISSUE_ESTIMATES as readonly number[]).includes(body.estimate))
      return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);
    set.estimate = body.estimate;
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && (typeof body.dueDate !== "string" || !isValidDueDate(body.dueDate)))
      return c.json({ error: `invalid dueDate: ${String(body.dueDate)} (expected YYYY-MM-DD)` }, 400);
    set.dueDate = body.dueDate;
  }

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(issues).where(eq(issues.id, id)).limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);

  // Arc must belong to the issue's product (SPEC §3) — validated against the
  // loaded row, hence after the existence check.
  if (body.arcId !== undefined) {
    if (body.arcId !== null) {
      if (typeof body.arcId !== "string") return c.json({ error: "arcId must be a string or null" }, 400);
      const [arc] = await db.select().from(arcs).where(eq(arcs.id, body.arcId)).limit(1);
      if (!arc || arc.productId !== existing.productId)
        return c.json({ error: "arc not found in this issue's product" }, 400);
    }
    set.arcId = body.arcId;
  }

  const now = new Date();
  const statusChanged = body.status !== undefined && body.status !== existing.status;
  if (body.status !== undefined) {
    set.status = body.status;
    set.completedAt = body.status === "done" ? now : null;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = now;

  const update = db.update(issues).set(set).where(eq(issues.id, id)).returning();
  if (statusChanged) {
    const [updated] = await db.batch([
      update,
      db.insert(activity).values({
        id: newId("act"),
        issueId: id,
        actorId: c.get("userId"),
        type: "status_changed",
        data: { from: existing.status, to: body.status },
        createdAt: now,
      }),
    ]);
    return c.json({ issue: updated[0] });
  }
  const [updated] = await update;
  return c.json({ issue: updated });
});

// Per-issue timeline (D20: not part of the workspace payload). Carries the
// issue's git links too — same load moment, same growth profile.
app.get("/api/issues/:id/timeline", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [issueComments, issueActivity, issuePrs, issueCommits] = await db.batch([
    db.select().from(comments).where(eq(comments.issueId, id)).orderBy(asc(comments.createdAt)),
    db.select().from(activity).where(eq(activity.issueId, id)).orderBy(asc(activity.createdAt)),
    db.select().from(prLinks).where(eq(prLinks.issueId, id)).orderBy(asc(prLinks.createdAt)),
    db
      .select()
      .from(commitLinks)
      .where(eq(commitLinks.issueId, id))
      .orderBy(asc(commitLinks.createdAt)),
  ]);
  return c.json({
    comments: issueComments,
    activity: issueActivity,
    pullRequests: issuePrs,
    commits: issueCommits,
  });
});

// Context bundle (SPEC §11.1, PROG-17): a deterministic Markdown "work order"
// for an issue and its surroundings — lineage (with the arc description, where
// epic-level intent lives), comments, and linked PRs/commits — ending in a
// stable report-back preamble. The shared foundation for the agent-integration
// surfaces (MCP server, "Work on this" kickoff) and a "copy as prompt" button
// for manual use. Looked up by KEY (alias-aware via resolveIssueKeys), not the
// internal id, so a retired key still resolves and renders the current key.
app.get("/api/issues/:key/bundle", async (c) => {
  const key = c.req.param("key").toUpperCase();
  if (!/^[A-Z]{2,8}-\d+$/.test(key)) return c.json({ error: "malformed issue key" }, 400);
  const db = drizzle(c.env.DB);

  const resolved = await resolveIssueKeys(db, [key]);
  const issueId = resolved.get(key);
  if (!issueId) return c.json({ error: `no issue for key ${key}` }, 404);

  const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!issue) return c.json({ error: `no issue for key ${key}` }, 404);

  // Independent reads (no transaction needed) — Promise.all per D31.
  const [product, repo, arc, tagRows, commentRows, prRows, commitRows] = await Promise.all([
    db.select().from(products).where(eq(products.id, issue.productId)).limit(1),
    issue.repoId
      ? db.select().from(repos).where(eq(repos.id, issue.repoId)).limit(1)
      : Promise.resolve([]),
    issue.arcId
      ? db.select().from(arcs).where(eq(arcs.id, issue.arcId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ name: tags.name })
      .from(issueTags)
      .innerJoin(tags, eq(issueTags.tagId, tags.id))
      .where(eq(issueTags.issueId, issueId))
      .orderBy(asc(tags.name)),
    db
      .select({ body: comments.body, createdAt: comments.createdAt, author: users.name })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.issueId, issueId))
      .orderBy(asc(comments.createdAt)),
    db.select().from(prLinks).where(eq(prLinks.issueId, issueId)).orderBy(asc(prLinks.createdAt)),
    db
      .select()
      .from(commitLinks)
      .where(eq(commitLinks.issueId, issueId))
      .orderBy(asc(commitLinks.createdAt)),
  ]);

  const md = renderBundle({
    // Canonical current key (normalizes an alias request), from the product
    // prefix + issue number — keys are derived, never stored (D18).
    key: `${product[0]!.keyPrefix}-${issue.number}`,
    issue,
    product: product[0]!,
    repo: repo[0] ?? null,
    arc: arc[0] ?? null,
    tags: tagRows.map((t) => t.name),
    comments: commentRows,
    pullRequests: prRows,
    commits: commitRows,
  });
  return c.body(md, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

app.post("/api/issues/:id/comments", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { body?: string };
  if (typeof body.body !== "string" || body.body.trim() === "")
    return c.json({ error: "comment body must be a non-empty string" }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "issue not found" }, 404);

  const now = new Date();
  const [comment] = await db
    .insert(comments)
    .values({
      id: newId("cmt"),
      issueId: id,
      authorId: c.get("userId"),
      body: body.body,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ comment }, 201);
});

// ---------- GitHub webhook (SPEC §5, D29) ----------

// HMAC SHA-256 of the raw body, hex, constant-time compared against the
// `sha256=<hex>` header GitHub sends. The route bypasses Cloudflare Access
// in production, so this signature is its only authentication.
async function verifyGitHubSignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length).toLowerCase();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Magic words: anything shaped like an issue key. Resolution decides whether
// a candidate is real, so prose like "UTF-8" can't false-positive.
const ISSUE_KEY_RE = /\b([A-Za-z]{2,8}-\d{1,7})\b/g;

function extractIssueKeys(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(ISSUE_KEY_RE)) keys.add(match[1]!.toUpperCase());
  }
  return [...keys];
}

// Key → issue id, checking current keys first and then the permanent
// aliases, mirroring the client's findIssueByKey (SPEC §3: references in
// commits and notes never break).
async function resolveIssueKeys(
  db: ReturnType<typeof drizzle>,
  candidates: string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (candidates.length === 0) return resolved;
  const allProducts = await db
    .select({ id: products.id, keyPrefix: products.keyPrefix })
    .from(products);
  const productByPrefix = new Map(allProducts.map((p) => [p.keyPrefix.toUpperCase(), p.id]));

  const aliasCandidates: string[] = [];
  for (const key of candidates) {
    const [prefix, num] = key.split("-");
    const productId = productByPrefix.get(prefix!);
    if (productId) {
      const [issue] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.productId, productId), eq(issues.number, Number(num))))
        .limit(1);
      if (issue) {
        resolved.set(key, issue.id);
        continue;
      }
    }
    aliasCandidates.push(key);
  }
  if (aliasCandidates.length > 0) {
    const aliasRows = await db
      .select()
      .from(issueKeyAliases)
      .where(inArray(issueKeyAliases.key, aliasCandidates));
    for (const row of aliasRows) resolved.set(row.key, row.issueId);
  }
  return resolved;
}

// ---------- context bundle rendering (SPEC §11.1, PROG-17) ----------

type BundleData = {
  key: string;
  issue: typeof issues.$inferSelect;
  product: typeof products.$inferSelect;
  repo: typeof repos.$inferSelect | null;
  arc: typeof arcs.$inferSelect | null;
  tags: string[];
  comments: { body: string; createdAt: Date; author: string }[];
  pullRequests: (typeof prLinks.$inferSelect)[];
  commits: (typeof commitLinks.$inferSelect)[];
};

// Deterministic: every value comes from the row data (no Date.now / locale),
// and collections arrive pre-sorted, so the same issue always renders byte
// for byte the same — important for a "copy as prompt" artifact and for
// diffing what an agent was handed.
function renderBundle(b: BundleData): string {
  const { issue } = b;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const para = (text: string, fallback = "_None._") =>
    text.trim() ? text.trim() : fallback;
  const out: string[] = [];

  out.push(`# ${b.key} — ${issue.title}`, "");
  out.push(`- **Status:** ${issue.status}`);
  out.push(`- **Priority:** ${issue.priority}`);
  out.push(
    `- **Estimate:** ${
      issue.estimate === null ? "unestimated" : `${issue.estimate} point${issue.estimate === 1 ? "" : "s"}`
    }`,
  );
  if (issue.dueDate) out.push(`- **Due:** ${issue.dueDate}`);
  if (b.tags.length) out.push(`- **Tags:** ${b.tags.join(", ")}`);
  out.push("");

  out.push("## Description", "", para(issue.description, "_No description._"), "");

  // Lineage product → repo → arc, descriptions included — the arc description
  // is where epic-level intent ("why") lives, so the agent sees it.
  out.push("## Context", "");
  out.push(`**Product — ${b.product.name}**`, "");
  if (b.product.description.trim()) out.push(b.product.description.trim(), "");
  if (b.repo) {
    out.push(`**Repo — ${b.repo.name}**${b.repo.gitUrl ? ` (git: ${b.repo.gitUrl})` : ""}`, "");
    if (b.repo.description.trim()) out.push(b.repo.description.trim(), "");
  }
  if (b.arc) {
    out.push(`**Arc — ${b.arc.name}**`, "");
    if (b.arc.description.trim()) out.push(b.arc.description.trim(), "");
  }

  out.push(`## Comments (${b.comments.length})`, "");
  if (b.comments.length === 0) out.push("_None._", "");
  else
    for (const cm of b.comments) out.push(`**${cm.author}** · ${day(cm.createdAt)}`, "", para(cm.body), "");

  out.push(`## Linked pull requests (${b.pullRequests.length})`, "");
  if (b.pullRequests.length === 0) out.push("_None._");
  else
    for (const pr of b.pullRequests)
      out.push(`- [${pr.state}] **#${pr.prNumber}** ${pr.title} — ${pr.url} (${pr.githubRepo})`);
  out.push("");

  out.push(`## Linked commits (${b.commits.length})`, "");
  if (b.commits.length === 0) out.push("_None._");
  else
    for (const cm of b.commits)
      out.push(`- \`${cm.sha.slice(0, 10)}\` ${cm.message} — ${cm.url} (${cm.githubRepo})`);
  out.push("");

  // Stable report-back preamble (SPEC §11.1): how an agent feeds work back so
  // it lands on this issue. The git convention works today via the §5 webhook;
  // comment/status report-back rides the API/MCP surface (PROG-18).
  out.push("---", "", "## How to report back", "");
  out.push(
    `You are working on **${b.key}** (${issue.title}).`,
    "",
    `1. Name your branch with the key — e.g. \`iss/${b.key}\` — and mention **${b.key}** in commit messages and the PR title/body. Progress auto-links branches, commits, and PRs that name the key, so the work appears on this issue with no extra step.`,
    `2. Post progress notes as a comment on **${b.key}** and move its status as you go (\`todo\` → \`in_progress\` → \`in_review\` → \`done\`) via the Progress API / MCP tools.`,
    `3. Keep this issue the source of truth — if scope changes, leave a comment rather than silently diverging.`,
    "",
  );
  return out.join("\n");
}

type PushPayload = {
  ref?: string;
  repository?: { full_name?: string };
  commits?: { id?: string; message?: string; url?: string }[];
};

type PullRequestPayload = {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    state?: string;
    merged?: boolean;
    html_url?: string;
    head?: { ref?: string };
  };
};

// Push: keys in the branch name apply to every commit in the push; keys in
// a commit message apply to that commit. Inserts are idempotent (composite
// PK + DO NOTHING), so GitHub redeliveries are safe; only genuinely new
// links get a commit_linked activity row.
async function handlePush(db: ReturnType<typeof drizzle>, payload: PushPayload) {
  const githubRepo = payload.repository?.full_name ?? "unknown";
  const branch = payload.ref?.replace(/^refs\/heads\//, "") ?? "";
  const branchKeys = extractIssueKeys(branch);
  const pushCommits = payload.commits ?? [];

  const allKeys = new Set(branchKeys);
  for (const commit of pushCommits)
    for (const key of extractIssueKeys(commit.message)) allKeys.add(key);
  const resolved = await resolveIssueKeys(db, [...allKeys]);
  if (resolved.size === 0) return { ok: true, linked: 0 };

  const now = new Date();
  let linked = 0;
  for (const commit of pushCommits) {
    if (!commit.id) continue;
    const keys = [...branchKeys, ...extractIssueKeys(commit.message)];
    const issueIds = new Set(
      keys.map((key) => resolved.get(key)).filter((id): id is string => id !== undefined),
    );
    const message = (commit.message ?? "").split("\n")[0]!.slice(0, 200);
    for (const issueId of issueIds) {
      const [inserted] = await db
        .insert(commitLinks)
        .values({ issueId, githubRepo, sha: commit.id, message, url: commit.url ?? "", createdAt: now })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue;
      linked++;
      await db.insert(activity).values({
        id: newId("act"),
        issueId,
        actorId: OWNER_ID,
        type: "commit_linked",
        data: { githubRepo, sha: commit.id, message, url: commit.url ?? "", branch },
        createdAt: now,
      });
    }
  }
  return { ok: true, linked };
}

// Pull request: keys in title, body, or source-branch name link the PR.
// First sight inserts the link + a pr_linked activity row; later events
// (edit, close, merge, reopen) update title/state in place. Links are
// permanent — removing the mention later does not unlink.
async function handlePullRequest(db: ReturnType<typeof drizzle>, payload: PullRequestPayload) {
  const pr = payload.pull_request;
  if (!pr?.number) return { ok: true, linked: 0 };
  const githubRepo = payload.repository?.full_name ?? "unknown";
  const resolved = await resolveIssueKeys(db, extractIssueKeys(pr.title, pr.body, pr.head?.ref));
  if (resolved.size === 0) return { ok: true, linked: 0 };

  const state: PrState = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
  const title = pr.title ?? `#${pr.number}`;
  const url = pr.html_url ?? "";
  const sourceBranch = pr.head?.ref ?? null;
  const now = new Date();
  let linked = 0;

  for (const issueId of new Set(resolved.values())) {
    const [existing] = await db
      .select({ issueId: prLinks.issueId })
      .from(prLinks)
      .where(
        and(
          eq(prLinks.issueId, issueId),
          eq(prLinks.githubRepo, githubRepo),
          eq(prLinks.prNumber, pr.number),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(prLinks)
        .set({ title, state, url, sourceBranch, updatedAt: now })
        .where(
          and(
            eq(prLinks.issueId, issueId),
            eq(prLinks.githubRepo, githubRepo),
            eq(prLinks.prNumber, pr.number),
          ),
        );
      continue;
    }
    await db.batch([
      db.insert(prLinks).values({
        issueId,
        githubRepo,
        prNumber: pr.number,
        title,
        state,
        url,
        sourceBranch,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(activity).values({
        id: newId("act"),
        issueId,
        actorId: OWNER_ID,
        type: "pr_linked",
        data: { githubRepo, prNumber: pr.number, title, url, state },
        createdAt: now,
      }),
    ]);
    linked++;
  }
  return { ok: true, linked };
}

app.post("/api/webhooks/github", async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "webhook secret not configured" }, 503);
  // Raw body first: the signature covers the exact bytes GitHub sent.
  const rawBody = await c.req.text();
  if (!(await verifyGitHubSignature(secret, rawBody, c.req.header("x-hub-signature-256"))))
    return c.json({ error: "invalid signature" }, 401);

  const event = c.req.header("x-github-event") ?? "";
  const db = drizzle(c.env.DB);
  if (event === "push") return c.json(await handlePush(db, JSON.parse(rawBody) as PushPayload));
  if (event === "pull_request")
    return c.json(await handlePullRequest(db, JSON.parse(rawBody) as PullRequestPayload));
  // Everything else (ping, issues, etc.): acknowledged, ignored.
  return c.json({ ok: true, ignored: event });
});

export default app;
