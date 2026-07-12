import * as Sentry from "@sentry/cloudflare";
import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  activity,
  allowedEmails,
  arcs,
  comments,
  commitLinks,
  images,
  workspaces,
  ACTION_ESTIMATES,
  ACTION_PRIORITIES,
  ACTION_STATUSES,
  actionKeyAliases,
  actions,
  actionTags,
  prLinks,
  focuses,
  tags,
  users,
  type ActionPriority,
  type ActionStatus,
  type PrState,
} from "../db/schema";
import { CLOSED_ACTION_STATUSES, tagColor } from "../shared/constants";
import { isValidRank, rankAfter } from "../shared/rank";
import { log } from "./log";
import {
  commentSnippet,
  escapeLike,
  hasMorePages,
  parseOffset,
  SEARCH_CAP,
} from "./searchComments";
import { renderArcBundle, renderBundle, type ArcActionData } from "./bundle";
import { handleMcpRequest } from "./mcp";
import { notAuthorizedPage } from "./pages";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SECONDS,
  authConfigured,
  redirectUri,
  isSuperAdmin,
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
  // Blob storage for pasted/uploaded images (PROG-42). Served through the Worker
  // behind the /api auth gate; resized at the edge via cf.image when available.
  IMAGES: R2Bucket;
  // Shared secret for GitHub webhook HMAC verification (SPEC §5). Local dev:
  // .dev.vars; production: `wrangler secret put GITHUB_WEBHOOK_SECRET`.
  GITHUB_WEBHOOK_SECRET?: string;
  // Sentry error tracking (PROG-60). Unset → the SDK is a no-op, so local dev
  // and tests never send. Production: `wrangler secret put SENTRY_DSN`.
  SENTRY_DSN?: string;
  // Tags events so prod errors are separable from any local testing. Defaults
  // to "production"; the DSN being unset already keeps dev silent.
  SENTRY_ENVIRONMENT?: string;
};

// Per-request identity set by the auth middleware (PROG-34): the logged-in
// user's id (session cookie), or the owner for the automation bearer token and
// the local-dev fallback. `userEmail` + `isSuperAdmin` (D44) back the Admin
// allowlist gate without a second user lookup in handlers.
type Variables = {
  userId: string;
  userEmail: string;
  isSuperAdmin: boolean;
  requestId: string;
};

// The owner row the seed guarantees (D13). Still the actor for the automation
// bearer token, the webhook (no interactive user), and the local-dev fallback.
const OWNER_ID = "usr_owner";

// True if `email` may use the app (D44): a super-admin (env secret) or a row
// in the runtime allowlist. Lowercased compare; the allowlist stores lowercase.
async function isEmailAllowed(
  db: ReturnType<typeof drizzle>,
  env: AuthEnv,
  email: string | undefined,
): Promise<boolean> {
  if (!email) return false;
  if (isSuperAdmin(email, env)) return true;
  const [row] = await db
    .select({ id: allowedEmails.id })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, email.trim().toLowerCase()))
    .limit(1);
  return Boolean(row);
}

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

// Legacy API paths from before the PROG-98 noun rename. External callers —
// MCP servers on old checkouts, agent work orders already in flight, saved
// scripts — still speak the v1/v2 nouns; rewrite the path and re-dispatch
// through the full stack (auth included) so both vocabularies hit the same
// handlers. Registered first so a legacy request runs the middleware chain
// once, on the rewritten path. `/api/workspace` (the old load-everything
// payload) is an exact match — `/api/workspaces` is a live route.
const LEGACY_API_PREFIXES: [string, string][] = [
  ["/api/initiatives", "/api/workspaces"],
  ["/api/products", "/api/focuses"],
  ["/api/issues", "/api/actions"],
];
app.use("/api/*", async (c, next) => {
  const url = new URL(c.req.url);
  let rewritten: string | null = null;
  if (url.pathname === "/api/workspace") rewritten = "/api/snapshot";
  else
    for (const [from, to] of LEGACY_API_PREFIXES)
      if (url.pathname === from || url.pathname.startsWith(`${from}/`)) {
        rewritten = to + url.pathname.slice(from.length);
        break;
      }
  if (rewritten === null) return next();
  url.pathname = rewritten;
  return app.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
});

// Security headers on everything the Worker serves — the /api/* JSON, the image
// blobs (PROG-42), and the standalone not-authorized page (PROG-57). These
// complement public/_headers, which carries the CSP for the statically-served
// SPA document/assets the Worker never sees (run_worker_first is /api/* only).
// CSP is deliberately *not* set here: the not-authorized page relies on inline
// styles + Google Fonts, and the JSON API needs no CSP. nosniff is the key one
// for /api/images, whose stored content-type is client-asserted — it stops a
// browser from MIME-sniffing a mislabeled upload into something executable.
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

// Assign a request id to every request and emit one structured access line when
// it completes. Reuse Cloudflare's `cf-ray` when present (so a log line ties
// back to the dashboard's request trace) and fall back to a uuid in local dev.
// The id is echoed as `x-request-id` for client-side correlation and stashed on
// the context so any error logged mid-request carries the same id (see log.ts).
// Health checks are skipped to keep uptime-monitor polling out of the logs.
app.use("*", async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  const start = Date.now();
  await next();
  if (c.req.path.startsWith("/api/") && c.req.path !== "/api/health") {
    log("info", "request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  }
});

// Without this, an uncaught throw became a bare "Internal Server Error" with
// nothing in the logs — which is exactly why a production /api/snapshot 500
// was undiagnosable. Log the full error server-side (visible in Workers Logs /
// `wrangler tail`, correlatable by requestId); keep the response body generic so
// the webhook path can't be used to read internals.
app.onError((err, c) => {
  const requestId = c.get("requestId");
  log("error", "unhandled_error", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    error: err,
  });
  // Hono catches the throw and returns below, so it never propagates out of the
  // fetch handler for `withSentry` to auto-capture — report it explicitly.
  // `requestId` ties the Sentry issue back to the matching Workers Logs line.
  Sentry.captureException(err, {
    tags: { requestId },
    extra: { method: c.req.method, path: c.req.path },
  });
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
  if (path === "/api/health" || path.startsWith("/api/auth/") || path.startsWith("/api/webhooks/"))
    return next();

  const env = c.env;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (env.PROGRESS_API_TOKEN && safeEqual(token, env.PROGRESS_API_TOKEN)) {
      // Automation acts as the owner — fully privileged, treated as super-admin.
      c.set("userId", OWNER_ID);
      c.set("userEmail", "");
      c.set("isSuperAdmin", true);
      return next();
    }
    return c.json({ error: "unauthenticated" }, 401);
  }

  if (env.SESSION_SECRET) {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) {
      const session = await verifySession(cookie, env.SESSION_SECRET);
      if (session) {
        // Re-check access every request (D44) so removing someone from the
        // allowlist revokes their live session within seconds rather than on its
        // 30-day expiry. Drop the cookie and 401 so the client bounces to
        // sign-in (→ the friendly not-authorized page on re-auth).
        if (!(await isEmailAllowed(drizzle(env.DB), env, session.email))) {
          deleteCookie(c, SESSION_COOKIE, { path: "/" });
          return c.json({ error: "unauthenticated" }, 401);
        }
        c.set("userId", session.uid);
        c.set("userEmail", session.email);
        c.set("isSuperAdmin", isSuperAdmin(session.email, env));
        return next();
      }
    }
  }

  if (!authConfigured(env) && isLoopbackHost(c.req.url)) {
    // Local-dev owner fallback — full privileges including the Admin page.
    c.set("userId", OWNER_ID);
    c.set("userEmail", "");
    c.set("isSuperAdmin", true);
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
    const requestId = c.get("requestId");
    log("error", "oauth_callback_failed", { requestId, error: e });
    // The catch returns a handled 400, so this never reaches `onError`/`withSentry`
    // on its own — report it explicitly so auth-exchange failures surface in Sentry's
    // alert/triage layer, with the same requestId that finds the Workers Logs line (PROG-60).
    Sentry.captureException(e, { tags: { requestId }, extra: { path: c.req.path } });
    return c.json({ error: "authentication failed" }, 400);
  }
  // Defense-in-depth (PROG-65): only honor a Google-verified email. The
  // allowlist is the real gate, but matching an entry on an *unverified* address
  // must never grant access — reject before the allowlist is even consulted.
  if (!identity.emailVerified) {
    const requestId = c.get("requestId");
    log("warn", "email_unverified", { requestId, email: identity.email });
    return c.html(notAuthorizedPage(), 403);
  }

  const db = drizzle(env.DB);
  // Allowed = super-admin (env secret) OR a row in the runtime allowlist (D44).
  // Not allowed → the friendly not-authorized page (PROG-57); the callback is a
  // full-page navigation, so a raw JSON 403 would read as a bug.
  if (!(await isEmailAllowed(db, env, identity.email))) {
    // A completed Google login (not bot noise) rejected by the allowlist — a
    // low-volume, security-relevant signal. Promote to Sentry at warning level
    // so it's distinct from real errors; requestId ties it to the Logs line.
    const requestId = c.get("requestId");
    log("warn", "not_authorized", { requestId, email: identity.email });
    Sentry.captureMessage("not_authorized: allowlist-rejected login", {
      level: "warning",
      tags: { requestId },
      extra: { email: identity.email },
    });
    return c.html(notAuthorizedPage(), 403);
  }

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
    const requestId = c.get("requestId");
    log("error", "health_d1_probe_failed", { requestId, error: e });
    // DB unreachable is a true critical condition — promote to Sentry. The probe
    // returns a handled 503, so it never reaches onError; capture it explicitly.
    Sentry.captureException(e, { tags: { requestId }, extra: { probe: "d1" } });
    return c.json({ ok: false, db: "error" }, 503);
  }
});

// The single "load everything" endpoint that feeds the client store
// (SPEC §8.2: fetch the full snapshot up front, render from memory after).
// Comments and activity are deliberately excluded — they're the only
// unbounded-growth data and aren't needed to render boards/lists; the action
// page loads them per action.
app.get("/api/snapshot", async (c) => {
  const db = drizzle(c.env.DB);
  const [
    allUsers,
    allWorkspaces,
    allFocuses,
    allArcs,
    allActions,
    allTags,
    allActionTags,
    allKeyAliases,
  ] = await Promise.all([
    // These eight reads are independent and need no transaction, so they run as
    // parallel queries rather than a single D1 `db.batch` (an implicit
    // transaction). The batch form 500'd on production D1 while working under
    // local Miniflare; Promise.all is the Cloudflare-recommended shape for
    // independent reads and removes that runtime difference. See DECISIONS D31.
    db.select().from(users),
    db.select().from(workspaces),
    db.select().from(focuses),
    db.select().from(arcs),
    db.select().from(actions),
    db.select().from(tags),
    db.select().from(actionTags),
    db.select().from(actionKeyAliases),
  ]);
  // The runtime allowlist is sensitive (who has access) and only the Admin page
  // needs it, so fetch + ship it to super-admins only (D44).
  const isSuper = c.get("isSuperAdmin");
  const allAllowedEmails = isSuper
    ? await db.select().from(allowedEmails).orderBy(asc(allowedEmails.email))
    : [];
  return c.json({
    // The authenticated identity, so the client can render who's signed in and
    // attribute "mine" without a second round trip (PROG-34).
    me: allUsers.find((u) => u.id === c.get("userId")) ?? null,
    // Whether the signed-in user may manage the allowlist (gates the Admin nav
    // link + page; the API enforces independently).
    isSuperAdmin: isSuper,
    allowedEmails: allAllowedEmails,
    users: allUsers,
    workspaces: allWorkspaces,
    focuses: allFocuses,
    arcs: allArcs,
    actions: allActions,
    tags: allTags,
    actionTags: allActionTags,
    actionKeyAliases: allKeyAliases,
  });
});

// Comment search (PROG-130). Comments are the only searchable text excluded
// from the snapshot payload (D20), so they're the one thing the client can't
// search in memory — this endpoint covers them; title/description search stays
// client-side. Matching is case-insensitive substring (SQLite LIKE), AND'd
// across whitespace-separated terms — the same predictable substring semantics
// the client uses, and a better fit than FTS5, which is token-based and
// wouldn't match mid-word (e.g. "ozzie" inside a longer token). The owner is a
// single user over a bounded comment set, so a LIKE scan is plenty; revisit if
// it ever isn't. Pure helpers (escaping, snippet) live in ./searchComments.
app.get("/api/search", async (c) => {
  // Lowercased so terms match the lowercased body comparison; SQLite LIKE is
  // already case-insensitive for ASCII, but we also build snippets in JS.
  const raw = (c.req.query("q") ?? "").trim().toLowerCase();
  const terms = raw.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return c.json({ hits: [], truncated: false });
  // Pagination (PROG-78): ?offset= skips past pages. Offset-based is fine here —
  // single owner, most-recent-first ordering, bounded comment set (see the LIKE
  // rationale above); a comment posted mid-scroll shifting the window by one is
  // an acceptable artifact at this scale.
  const offset = parseOffset(c.req.query("offset"));

  const db = drizzle(c.env.DB);
  // One LIKE per term, AND'd — a comment matches only if every term appears.
  const predicate = and(
    ...terms.map((t) => sql`lower(${comments.body}) LIKE ${`%${escapeLike(t)}%`} ESCAPE '\\'`),
  );
  // Most-recent first; pull one extra to detect whether more pages exist.
  const rows = await db
    .select({ id: comments.id, actionId: comments.actionId, body: comments.body })
    .from(comments)
    .where(predicate)
    .orderBy(desc(comments.createdAt))
    .limit(SEARCH_CAP + 1)
    .offset(offset);

  const truncated = hasMorePages(rows.length, offset);
  const hits = rows.slice(0, SEARCH_CAP).map((r) => ({
    commentId: r.id,
    actionId: r.actionId,
    snippet: commentSnippet(r.body, terms),
  }));
  return c.json({ hits, truncated });
});

// ---------- admin: sign-in allowlist CRUD (D44) ----------
//
// Super-admins (env secret) manage who else may use the app. Every route is
// gated on the per-request `isSuperAdmin` flag set by the auth middleware; the
// client also hides the page, but the server is the real boundary.

// Minimal, permissive email shape check — we only need to reject obvious junk,
// not RFC-5322-validate (Google already vouched for real sign-ins).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireSuperAdmin(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  return c.get("isSuperAdmin") ? null : c.json({ error: "forbidden" }, 403);
}

app.post("/api/admin/allowlist", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json()) as { email?: unknown; note?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return c.json({ error: "a valid email is required" }, 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const db = drizzle(c.env.DB);
  const [existing] = await db
    .select()
    .from(allowedEmails)
    .where(eq(allowedEmails.email, email))
    .limit(1);
  if (existing) return c.json({ error: "that email is already on the list" }, 409);

  const [row] = await db
    .insert(allowedEmails)
    .values({
      id: newId("ael"),
      email,
      note,
      addedByEmail: c.get("userEmail"),
      createdAt: new Date(),
    })
    .returning();
  return c.json({ allowedEmail: row }, 201);
});

app.patch("/api/admin/allowlist/:id", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json()) as { note?: unknown };
  if (typeof body.note !== "string") return c.json({ error: "note must be a string" }, 400);
  const db = drizzle(c.env.DB);
  const [row] = await db
    .update(allowedEmails)
    .set({ note: body.note.trim() })
    .where(eq(allowedEmails.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ allowedEmail: row });
});

app.delete("/api/admin/allowlist/:id", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const db = drizzle(c.env.DB);
  await db.delete(allowedEmails).where(eq(allowedEmails.id, c.req.param("id")));
  return c.json({ ok: true });
});

// ---------- images: paste/upload to R2, serve auth-gated (PROG-42) ----------
//
// Blobs live in R2; a D1 `images` row authorizes + attributes them. Both routes
// sit behind the /api auth gate, so an image is viewable by any signed-in
// (allowlisted) user or the bearer token — never the public internet. Markdown
// in descriptions/comments references them as `/api/images/<id>`.

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB — generous for screenshots.

app.post("/api/images", async (c) => {
  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(contentType))
    return c.json({ error: `unsupported image type: ${contentType || "none"}` }, 400);

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return c.json({ error: "empty body" }, 400);
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    return c.json({ error: `image too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)` }, 400);

  const id = newId("img");
  const r2Key = `img/${id}`;
  await c.env.IMAGES.put(r2Key, bytes, { httpMetadata: { contentType } });

  const db = drizzle(c.env.DB);
  await db.insert(images).values({
    id,
    r2Key,
    contentType,
    size: bytes.byteLength,
    uploaderId: c.get("userId"),
    createdAt: new Date(),
  });
  return c.json({ image: { id, url: `/api/images/${id}` } }, 201);
});

app.get("/api/images/:id", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [row] = await db.select().from(images).where(eq(images.id, id)).limit(1);
  if (!row) return c.json({ error: "image not found" }, 404);

  const url = new URL(c.req.url);
  const width = Number(url.searchParams.get("w"));
  const wantResize = Number.isFinite(width) && width > 0;
  // Immutable: an image id is content the client never reuses for new bytes.
  const cacheControl = "private, max-age=31536000, immutable";

  // Resize at the edge via a cf.image subrequest to our own raw variant. We only
  // do this on a deployed origin (cf.image is a no-op off-edge, and a self-fetch
  // to localhost would loop under Miniflare); locally and without a token we just
  // stream the original. The subrequest carries the bearer so it clears the gate.
  if (
    wantResize &&
    url.searchParams.get("raw") !== "1" &&
    !isLoopbackHost(c.req.url) &&
    c.env.PROGRESS_API_TOKEN
  ) {
    const rawUrl = `${url.origin}/api/images/${id}?raw=1`;
    const resized = await fetch(
      new Request(rawUrl, { headers: { Authorization: `Bearer ${c.env.PROGRESS_API_TOKEN}` } }),
      { cf: { image: { width: Math.min(width, 2400), fit: "scale-down", quality: 85 } } },
    );
    if (resized.ok) {
      const out = new Response(resized.body, resized);
      out.headers.set("Cache-Control", cacheControl);
      return out;
    }
    // Resizing unavailable (feature off, etc.) → fall through to the original.
  }

  const obj = await c.env.IMAGES.get(row.r2Key);
  if (!obj) return c.json({ error: "image blob missing" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": row.contentType, "Cache-Control": cacheControl },
  });
});

// ---------- container CRUD (D26) ----------

type ContainerBody = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  workspaceId?: unknown;
  focusId?: unknown;
  keyPrefix?: unknown;
  gitUrl?: unknown;
  archived?: unknown;
  rank?: unknown;
};

// Letters only: a digit in the prefix would break PREFIX-n key parsing.
const KEY_PREFIX_RE = /^[A-Z]{2,8}$/;

// gitUrl is an optional field on the focus (PROG-102) rendered as a clickable
// link in the client, so it must be a real web URL (PROG-65). Without this, a
// `javascript:` (or `data:`) value would be a stored XSS vector the moment
// someone clicks it.
function isValidGitUrl(s: string): boolean {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  return u.protocol === "http:" || u.protocol === "https:";
}

const badName = (name: unknown) => typeof name !== "string" || name.trim() === "";

// Container ids may be client-generated (D26: the store creates the row
// optimistically and navigates to /type/:id immediately, so the id must not
// change on reconcile). Anything malformed falls back to a server id.
const idOr = (id: unknown, prefix: string) =>
  typeof id === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id) ? id : newId(prefix);

// Shared PATCH fields for the three container types (Workspace/Focus/Arc);
// archive/unarchive is the `archived` boolean mapped onto archivedAt (SPEC §3:
// no hard deletes). `opts.rank` opts a route into the manual outline order
// (PROG-87) — the client-computed fractional key, validated like the action
// board rank.
function containerPatchSet(
  body: ContainerBody,
  opts?: { rank?: boolean },
): { set: Record<string, unknown>; error?: string } {
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
  if (opts?.rank && body.rank !== undefined) {
    if (!isValidRank(body.rank)) return { set, error: `invalid rank: ${String(body.rank)}` };
    set.rank = body.rank;
  }
  return { set };
}

app.post("/api/workspaces", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  const now = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .insert(workspaces)
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

app.post("/api/focuses", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  if (badName(body.name)) return c.json({ error: "name must be a non-empty string" }, 400);
  if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
    return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
  const keyPrefix = body.keyPrefix.toUpperCase();
  if (typeof body.workspaceId !== "string")
    return c.json({ error: "workspaceId is required" }, 400);
  // Optional git repo mirrored by this focus (PROG-102).
  const gitUrl = body.gitUrl ?? null;
  if (gitUrl !== null && (typeof gitUrl !== "string" || !isValidGitUrl(gitUrl)))
    return c.json({ error: "gitUrl must be an http(s) URL or null" }, 400);

  const db = drizzle(c.env.DB);
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, body.workspaceId))
    .limit(1);
  if (!workspace) return c.json({ error: "workspace not found" }, 400);
  const [clash] = await db.select().from(focuses).where(eq(focuses.keyPrefix, keyPrefix)).limit(1);
  if (clash) return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);

  const now = new Date();
  const [container] = await db
    .insert(focuses)
    .values({
      id: idOr(body.id, "prd"),
      workspaceId: body.workspaceId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      gitUrl,
      keyPrefix,
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
  if (typeof body.focusId !== "string") return c.json({ error: "focusId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [focus] = await db.select().from(focuses).where(eq(focuses.id, body.focusId)).limit(1);
  if (!focus) return c.json({ error: "focus not found" }, 400);

  const now = new Date();
  const [container] = await db
    .insert(arcs)
    .values({
      id: idOr(body.id, "arc"),
      focusId: body.focusId,
      name: (body.name as string).trim(),
      description: typeof body.description === "string" ? body.description : "",
      creatorId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ container }, 201);
});

app.patch("/api/workspaces/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body, { rank: true });
  if (error) return c.json({ error }, 400);
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const db = drizzle(c.env.DB);
  const [container] = await db
    .update(workspaces)
    .set(set)
    .where(eq(workspaces.id, c.req.param("id")))
    .returning();
  if (!container) return c.json({ error: "workspace not found" }, 404);
  return c.json({ container });
});

app.patch("/api/focuses/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body, { rank: true });
  if (error) return c.json({ error }, 400);
  const db = drizzle(c.env.DB);
  if (body.keyPrefix !== undefined) {
    if (typeof body.keyPrefix !== "string" || !KEY_PREFIX_RE.test(body.keyPrefix.toUpperCase()))
      return c.json({ error: "keyPrefix must be 2–8 letters" }, 400);
    const keyPrefix = body.keyPrefix.toUpperCase();
    const [clash] = await db
      .select()
      .from(focuses)
      .where(eq(focuses.keyPrefix, keyPrefix))
      .limit(1);
    if (clash && clash.id !== id)
      return c.json({ error: `key prefix ${keyPrefix} is already in use` }, 409);
    // Safe rename: action keys are derived from the prefix, never stored (D18).
    set.keyPrefix = keyPrefix;
  }
  // Optional git repo mirrored by this focus (PROG-102).
  if (body.gitUrl !== undefined) {
    if (body.gitUrl !== null && (typeof body.gitUrl !== "string" || !isValidGitUrl(body.gitUrl)))
      return c.json({ error: "gitUrl must be an http(s) URL or null" }, 400);
    set.gitUrl = body.gitUrl;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = new Date();
  const [container] = await db.update(focuses).set(set).where(eq(focuses.id, id)).returning();
  if (!container) return c.json({ error: "focus not found" }, 404);
  return c.json({ container });
});

app.patch("/api/arcs/:id", async (c) => {
  const body = (await c.req.json()) as ContainerBody;
  const { set, error } = containerPatchSet(body, { rank: true });
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
app.post("/api/actions/:id/tags", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { tagId?: unknown; name?: unknown; id?: unknown };
  const db = drizzle(c.env.DB);
  const [action] = await db
    .select({ id: actions.id })
    .from(actions)
    .where(eq(actions.id, id))
    .limit(1);
  if (!action) return c.json({ error: "action not found" }, 404);

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

  await db.insert(actionTags).values({ actionId: id, tagId: tag!.id }).onConflictDoNothing();
  return c.json({ tag, link: { actionId: id, tagId: tag!.id } }, 201);
});

app.delete("/api/actions/:id/tags/:tagId", async (c) => {
  const db = drizzle(c.env.DB);
  await db
    .delete(actionTags)
    .where(
      and(eq(actionTags.actionId, c.req.param("id")), eq(actionTags.tagId, c.req.param("tagId"))),
    );
  return c.json({ ok: true });
});

type ActionCreateBody = {
  title?: unknown;
  focusId?: unknown;
  arcId?: unknown;
  parentActionId?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  estimate?: unknown;
  dueDate?: unknown;
  tagIds?: unknown;
};

// Action creation (SPEC §3): the action number comes from the focus's
// next_action_number sequence (D18), allocated with an atomic increment. A
// crash between allocation and insert leaves a number gap, which is harmless.
app.post("/api/actions", async (c) => {
  const body = (await c.req.json()) as ActionCreateBody;
  if (typeof body.title !== "string" || body.title.trim() === "")
    return c.json({ error: "title must be a non-empty string" }, 400);
  if (typeof body.focusId !== "string") return c.json({ error: "focusId is required" }, 400);
  const arcId = body.arcId ?? null;
  if (arcId !== null && typeof arcId !== "string")
    return c.json({ error: "arcId must be a string or null" }, 400);
  const parentActionId = body.parentActionId ?? null;
  if (parentActionId !== null && typeof parentActionId !== "string")
    return c.json({ error: "parentActionId must be a string or null" }, 400);
  const description = body.description ?? "";
  if (typeof description !== "string")
    return c.json({ error: "description must be a string" }, 400);
  const status = (body.status ?? "backlog") as ActionStatus;
  if (!ACTION_STATUSES.includes(status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  const priority = (body.priority ?? "none") as ActionPriority;
  if (!ACTION_PRIORITIES.includes(priority))
    return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
  const estimate = (body.estimate ?? null) as number | null;
  if (estimate !== null && !(ACTION_ESTIMATES as readonly number[]).includes(estimate))
    return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);
  const dueDate = (body.dueDate ?? null) as string | null;
  if (dueDate !== null && (typeof dueDate !== "string" || !isValidDueDate(dueDate)))
    return c.json({ error: `invalid dueDate: ${String(body.dueDate)} (expected YYYY-MM-DD)` }, 400);
  // Tag links may ride the create (PROG-89b: the Agenda quick-add inherits the
  // active Tag filter). Optional; existence is checked below with the other
  // db-backed validations.
  const rawTagIds = body.tagIds ?? [];
  if (!Array.isArray(rawTagIds) || rawTagIds.some((t) => typeof t !== "string"))
    return c.json({ error: "tagIds must be an array of tag ids" }, 400);
  const tagIds = [...new Set(rawTagIds as string[])];

  const db = drizzle(c.env.DB);
  const [focus] = await db.select().from(focuses).where(eq(focuses.id, body.focusId)).limit(1);
  if (!focus) return c.json({ error: "focus not found" }, 400);
  // The invariant SQLite can't express (D17): arc must belong to the action's
  // focus.
  if (arcId !== null) {
    const [arc] = await db.select().from(arcs).where(eq(arcs.id, arcId)).limit(1);
    if (!arc || arc.focusId !== focus.id)
      return c.json({ error: "arc not found in that focus" }, 400);
  }
  // Step parent (PROG-124): must be an existing action in the same focus.
  // A brand-new action can't create a cycle, so no chain walk is needed here.
  if (parentActionId !== null) {
    const [parent] = await db.select().from(actions).where(eq(actions.id, parentActionId)).limit(1);
    if (!parent || parent.focusId !== focus.id)
      return c.json({ error: "parent action not found in that focus" }, 400);
  }
  // Every inherited tag must exist — rejected before the number is allocated,
  // so the client's all-or-nothing rollback stays simple (PROG-89b).
  if (tagIds.length > 0) {
    const found = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds));
    if (found.length !== tagIds.length) return c.json({ error: "tag not found" }, 400);
  }

  const [seq] = await db
    .update(focuses)
    .set({ nextActionNumber: sql`${focuses.nextActionNumber} + 1` })
    .where(eq(focuses.id, focus.id))
    .returning({ next: focuses.nextActionNumber });
  // Board rank (PROG-43): append after the current last action so a new card
  // lands at the bottom of its column. Ranks are a single global order; sorting
  // only ever compares cards within one column, so being globally last places
  // it last among its column's members.
  const [{ maxRank } = { maxRank: null }] = await db
    .select({ maxRank: max(actions.rank) })
    .from(actions);
  const now = new Date();
  const [action] = await db
    .insert(actions)
    .values({
      id: newId("acn"),
      focusId: focus.id,
      arcId,
      parentActionId,
      number: seq!.next - 1,
      title: body.title.trim(),
      description,
      status,
      priority,
      estimate,
      dueDate,
      rank: rankAfter(maxRank ?? null),
      creatorId: c.get("userId"),
      assigneeId: c.get("userId"),
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
    })
    .returning();
  if (tagIds.length > 0)
    await db.insert(actionTags).values(tagIds.map((tagId) => ({ actionId: action!.id, tagId })));
  return c.json({ action }, 201);
});

type ActionMoveBody = { focusId?: unknown };

// Action movement (SPEC §3, PROG-102): a move now only changes the focus (the
// sole container). It re-keys from the target's sequence, clears the arc, and
// retires the old key into action_key_aliases as a permanent redirect (D18).
app.post("/api/actions/:id/move", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as ActionMoveBody;
  if (typeof body.focusId !== "string") return c.json({ error: "focusId is required" }, 400);

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  if (!existing) return c.json({ error: "action not found" }, 404);
  const [target] = await db.select().from(focuses).where(eq(focuses.id, body.focusId)).limit(1);
  if (!target) return c.json({ error: "focus not found" }, 400);
  if (existing.focusId === target.id)
    return c.json({ error: "action is already in that focus" }, 400);

  const now = new Date();
  const moveData = {
    fromFocusId: existing.focusId,
    toFocusId: target.id,
  };

  const [oldFocus] = await db
    .select()
    .from(focuses)
    .where(eq(focuses.id, existing.focusId))
    .limit(1);
  const oldKey = `${oldFocus!.keyPrefix}-${existing.number}`;
  const [seq] = await db
    .update(focuses)
    .set({ nextActionNumber: sql`${focuses.nextActionNumber} + 1` })
    .where(eq(focuses.id, target.id))
    .returning({ next: focuses.nextActionNumber });
  const number = seq!.next - 1;
  const [updated] = await db.batch([
    db
      .update(actions)
      // arcId and parentActionId reference the old focus, so a cross-focus
      // move clears both — the action lands at the top level of the target
      // (PROG-124). Any children keep pointing here and are detached below.
      .set({
        focusId: target.id,
        arcId: null,
        parentActionId: null,
        number,
        updatedAt: now,
      })
      .where(eq(actions.id, id))
      .returning(),
    db.insert(actionKeyAliases).values({ key: oldKey, actionId: id, createdAt: now }),
    // Detach any steps of the moved action: they stay in the old focus,
    // so they can't keep a now-cross-focus parent (PROG-124, same-focus
    // invariant). They become top-level actions in their original focus.
    db
      .update(actions)
      .set({ parentActionId: null, updatedAt: now })
      .where(eq(actions.parentActionId, id)),
    db.insert(activity).values({
      id: newId("act"),
      actionId: id,
      actorId: c.get("userId"),
      type: "moved",
      data: { ...moveData, fromKey: oldKey, toKey: `${target.keyPrefix}-${number}` },
      createdAt: now,
    }),
  ]);
  return c.json({ action: updated[0] });
});

type ActionPatchBody = Partial<{
  title: string;
  description: string;
  status: ActionStatus;
  priority: ActionPriority;
  estimate: number | null;
  arcId: string | null;
  parentActionId: string | null;
  dueDate: string | null;
  rank: string;
}>;

// Generalized action field update — the server side of the optimistic-mutation
// template. Validates per field; a status change also appends an activity
// event (the action page's timeline interleaves these with comments).
app.patch("/api/actions/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as ActionPatchBody;
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
  if (body.status !== undefined && !ACTION_STATUSES.includes(body.status))
    return c.json({ error: `invalid status: ${String(body.status)}` }, 400);
  if (body.priority !== undefined) {
    if (!ACTION_PRIORITIES.includes(body.priority))
      return c.json({ error: `invalid priority: ${String(body.priority)}` }, 400);
    set.priority = body.priority;
  }
  if (body.estimate !== undefined) {
    if (body.estimate !== null && !(ACTION_ESTIMATES as readonly number[]).includes(body.estimate))
      return c.json({ error: `invalid estimate: ${String(body.estimate)}` }, 400);
    set.estimate = body.estimate;
  }
  if (body.dueDate !== undefined) {
    if (
      body.dueDate !== null &&
      (typeof body.dueDate !== "string" || !isValidDueDate(body.dueDate))
    )
      return c.json(
        { error: `invalid dueDate: ${String(body.dueDate)} (expected YYYY-MM-DD)` },
        400,
      );
    set.dueDate = body.dueDate;
  }
  if (body.rank !== undefined) {
    // The client computes the new fractional-index key (it knows the neighbors);
    // the server only checks it's well-formed (PROG-43).
    if (!isValidRank(body.rank))
      return c.json({ error: `invalid rank: ${String(body.rank)}` }, 400);
    set.rank = body.rank;
  }

  const db = drizzle(c.env.DB);
  const [existing] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  if (!existing) return c.json({ error: "action not found" }, 404);

  // Arc must belong to the action's focus (SPEC §3) — validated against the
  // loaded row, hence after the existence check.
  if (body.arcId !== undefined) {
    if (body.arcId !== null) {
      if (typeof body.arcId !== "string")
        return c.json({ error: "arcId must be a string or null" }, 400);
      const [arc] = await db.select().from(arcs).where(eq(arcs.id, body.arcId)).limit(1);
      if (!arc || arc.focusId !== existing.focusId)
        return c.json({ error: "arc not found in this action's focus" }, 400);
    }
    set.arcId = body.arcId;
  }

  // Step reparent (PROG-124): parent must be in the same focus, not the
  // action itself, and must not introduce a cycle. Walking up from the proposed
  // parent and stopping if we reach `id` catches cycles at any depth; the chain
  // is shallow in practice and bounded by a guard against malformed data.
  if (body.parentActionId !== undefined) {
    if (body.parentActionId !== null) {
      if (typeof body.parentActionId !== "string")
        return c.json({ error: "parentActionId must be a string or null" }, 400);
      if (body.parentActionId === id)
        return c.json({ error: "an action cannot be its own parent" }, 400);
      const [parent] = await db
        .select()
        .from(actions)
        .where(eq(actions.id, body.parentActionId))
        .limit(1);
      if (!parent || parent.focusId !== existing.focusId)
        return c.json({ error: "parent action not found in this action's focus" }, 400);
      // Cycle check: follow parent pointers upward; reaching `id` means the
      // proposed parent is a descendant of this action.
      let cursor: string | null = parent.parentActionId;
      for (let hops = 0; cursor !== null && hops < 1000; hops++) {
        if (cursor === id) return c.json({ error: "that move would create a cycle" }, 400);
        const [next]: { parentActionId: string | null }[] = await db
          .select({ parentActionId: actions.parentActionId })
          .from(actions)
          .where(eq(actions.id, cursor))
          .limit(1);
        cursor = next?.parentActionId ?? null;
      }
    }
    set.parentActionId = body.parentActionId;
  }

  const now = new Date();
  const statusChanged = body.status !== undefined && body.status !== existing.status;
  if (body.status !== undefined) {
    set.status = body.status;
    set.completedAt = body.status === "done" ? now : null;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "no valid fields in patch" }, 400);
  set.updatedAt = now;

  const update = db.update(actions).set(set).where(eq(actions.id, id)).returning();
  if (statusChanged) {
    const [updated] = await db.batch([
      update,
      db.insert(activity).values({
        id: newId("act"),
        actionId: id,
        actorId: c.get("userId"),
        type: "status_changed",
        data: { from: existing.status, to: body.status },
        createdAt: now,
      }),
    ]);
    return c.json({ action: updated[0] });
  }
  const [updated] = await update;
  return c.json({ action: updated });
});

// Per-action timeline (D20: not part of the snapshot payload). Carries the
// action's git links too — same load moment, same growth profile.
app.get("/api/actions/:id/timeline", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);
  const [actionComments, actionActivity, actionPrs, actionCommits] = await db.batch([
    db.select().from(comments).where(eq(comments.actionId, id)).orderBy(asc(comments.createdAt)),
    db.select().from(activity).where(eq(activity.actionId, id)).orderBy(asc(activity.createdAt)),
    db.select().from(prLinks).where(eq(prLinks.actionId, id)).orderBy(asc(prLinks.createdAt)),
    db
      .select()
      .from(commitLinks)
      .where(eq(commitLinks.actionId, id))
      .orderBy(asc(commitLinks.createdAt)),
  ]);
  return c.json({
    comments: actionComments,
    activity: actionActivity,
    pullRequests: actionPrs,
    commits: actionCommits,
  });
});

// Context bundle (SPEC §11.1, PROG-17): a deterministic Markdown "work order"
// for an action and its surroundings — lineage (with the arc description, where
// epic-level intent lives), comments, and linked PRs/commits — ending in a
// stable report-back preamble. The shared foundation for the agent-integration
// surfaces (MCP server, "Work on this" kickoff) and a "copy as prompt" button
// for manual use. Looked up by KEY (alias-aware via resolveActionKeys), not the
// internal id, so a retired key still resolves and renders the current key.
app.get("/api/actions/:key/bundle", async (c) => {
  const key = c.req.param("key").toUpperCase();
  if (!/^[A-Z]{2,8}-\d+$/.test(key)) return c.json({ error: "malformed action key" }, 400);
  const db = drizzle(c.env.DB);

  const resolved = await resolveActionKeys(db, [key]);
  const actionId = resolved.get(key);
  if (!actionId) return c.json({ error: `no action for key ${key}` }, 404);

  const [action] = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  if (!action) return c.json({ error: `no action for key ${key}` }, 404);

  // Independent reads (no transaction needed) — Promise.all per D31.
  const [focus, arc, tagRows, commentRows, prRows, commitRows] = await Promise.all([
    db.select().from(focuses).where(eq(focuses.id, action.focusId)).limit(1),
    action.arcId
      ? db.select().from(arcs).where(eq(arcs.id, action.arcId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ name: tags.name })
      .from(actionTags)
      .innerJoin(tags, eq(actionTags.tagId, tags.id))
      .where(eq(actionTags.actionId, actionId))
      .orderBy(asc(tags.name)),
    db
      .select({ body: comments.body, createdAt: comments.createdAt, author: users.name })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.actionId, actionId))
      .orderBy(asc(comments.createdAt)),
    db.select().from(prLinks).where(eq(prLinks.actionId, actionId)).orderBy(asc(prLinks.createdAt)),
    db
      .select()
      .from(commitLinks)
      .where(eq(commitLinks.actionId, actionId))
      .orderBy(asc(commitLinks.createdAt)),
  ]);

  const md = renderBundle({
    // Canonical current key (normalizes an alias request), from the focus
    // prefix + action number — keys are derived, never stored (D18).
    key: `${focus[0]!.keyPrefix}-${action.number}`,
    action,
    focus: focus[0]!,
    arc: arc[0] ?? null,
    tags: tagRows.map((t) => t.name),
    comments: commentRows,
    pullRequests: prRows,
    commits: commitRows,
    baseUrl: new URL(c.req.url).origin,
  });
  return c.body(md, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// Arc-level work order (PROG: arc "copy as prompt"): a single deterministic
// Markdown prompt covering every OPEN action in an arc (done/canceled dropped),
// each rendered in the same shape as the per-action bundle, ending in
// combined-PR orchestration that fans the actions out to sub-agents and lands
// them in one PR. Looked up by the arc's internal id (the arc page has it).
app.get("/api/arcs/:id/bundle", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [arc] = await db.select().from(arcs).where(eq(arcs.id, id)).limit(1);
  if (!arc) return c.json({ error: `no arc with id ${id}` }, 404);

  const [focus] = await db.select().from(focuses).where(eq(focuses.id, arc.focusId)).limit(1);
  if (!focus) return c.json({ error: `arc ${id} has no focus` }, 500);

  // Open actions only — drop terminal (done/canceled). Pre-sort by status order
  // then number so the render is deterministic (mirrors the arc page's default
  // "status" sort intent; status enum is stored, so sort in JS below).
  const openActions = await db
    .select()
    .from(actions)
    .where(and(eq(actions.arcId, id), notInArray(actions.status, [...CLOSED_ACTION_STATUSES])));
  const statusRank = new Map(ACTION_STATUSES.map((s, i) => [s, i]));
  openActions.sort(
    (a, b) => statusRank.get(a.status)! - statusRank.get(b.status)! || a.number - b.number,
  );

  const baseUrl = new URL(c.req.url).origin;
  // Per-action context (tags, comments, PRs, commits), gathered in parallel
  // across actions — independent reads, no transaction (D31).
  const actionData: ArcActionData[] = await Promise.all(
    openActions.map(async (action): Promise<ArcActionData> => {
      const [tagRows, commentRows, prRows, commitRows] = await Promise.all([
        db
          .select({ name: tags.name })
          .from(actionTags)
          .innerJoin(tags, eq(actionTags.tagId, tags.id))
          .where(eq(actionTags.actionId, action.id))
          .orderBy(asc(tags.name)),
        db
          .select({ body: comments.body, createdAt: comments.createdAt, author: users.name })
          .from(comments)
          .innerJoin(users, eq(comments.authorId, users.id))
          .where(eq(comments.actionId, action.id))
          .orderBy(asc(comments.createdAt)),
        db
          .select()
          .from(prLinks)
          .where(eq(prLinks.actionId, action.id))
          .orderBy(asc(prLinks.createdAt)),
        db
          .select()
          .from(commitLinks)
          .where(eq(commitLinks.actionId, action.id))
          .orderBy(asc(commitLinks.createdAt)),
      ]);
      return {
        key: `${focus.keyPrefix}-${action.number}`,
        action,
        tags: tagRows.map((t) => t.name),
        comments: commentRows,
        pullRequests: prRows,
        commits: commitRows,
      };
    }),
  );

  const md = renderArcBundle({ arc, focus, actions: actionData, baseUrl });
  return c.body(md, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// Hosted MCP endpoint (Streamable HTTP, stateless — see src/worker/mcp.ts).
// Under /api/* so run_worker_first routes it here and the auth middleware
// gates it; the handler then self-dispatches tool calls back into this app
// with the caller's own credentials (same pattern as the legacy-path rewrite
// above). `app.all` — the MCP spec speaks POST for messages plus GET/DELETE
// for session management, which the transport answers per-method.
app.all("/api/mcp", (c) =>
  handleMcpRequest(c.req.raw, async (req) => app.fetch(req, c.env, c.executionCtx)),
);

app.post("/api/actions/:id/comments", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { id?: string; body?: string };
  if (typeof body.body !== "string" || body.body.trim() === "")
    return c.json({ error: "comment body must be a non-empty string" }, 400);

  // Optional client-supplied id = idempotency key (PROG-51). The client already
  // mints this `cmt_…` id for its optimistic row; sending it lets a client
  // safely retry a comment whose write may have committed *before* the response
  // failed (a D1 storage-reset timeout did exactly this in prod). Validate the
  // shape so it can't be abused to probe arbitrary ids.
  const clientId = body.id;
  if (clientId !== undefined && !/^cmt_[0-9a-f]{32}$/.test(clientId))
    return c.json({ error: "invalid comment id" }, 400);

  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const [existing] = await db
    .select({ id: actions.id })
    .from(actions)
    .where(eq(actions.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "action not found" }, 404);

  // Insert with the supplied id (or a fresh one), tolerating a pre-existing row
  // so a retry — or two same-id requests racing — never throws a PK violation
  // (→ unhandled 500 + Sentry noise). `onConflictDoNothing` returns no row when
  // the id already exists; that path is the idempotent retry / race loser.
  const commentId = clientId ?? newId("cmt");
  const now = new Date();
  const [comment] = await db
    .insert(comments)
    .values({
      id: commentId,
      actionId: id,
      authorId: userId,
      body: body.body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (comment) return c.json({ comment }, 201);

  // Conflict: the id already exists. Treat it as success only when the existing
  // row belongs to the same author *and* action — never return another user's row
  // and never silently re-home it onto a different action (the user-scoping guard
  // PROG-51). Anything else is a genuine conflict.
  const [prior] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  if (prior && prior.authorId === userId && prior.actionId === id)
    return c.json({ comment: prior }, 200);
  return c.json({ error: "comment id already exists" }, 409);
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

// Magic words: anything shaped like an action key. Resolution decides whether
// a candidate is real, so prose like "UTF-8" can't false-positive.
const ACTION_KEY_RE = /\b([A-Za-z]{2,8}-\d{1,7})\b/g;

function extractActionKeys(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(ACTION_KEY_RE)) keys.add(match[1]!.toUpperCase());
  }
  return [...keys];
}

// Key → action id, checking current keys first and then the permanent
// aliases, mirroring the client's findActionByKey (SPEC §3: references in
// commits and notes never break).
async function resolveActionKeys(
  db: ReturnType<typeof drizzle>,
  candidates: string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (candidates.length === 0) return resolved;
  const allFocuses = await db
    .select({ id: focuses.id, keyPrefix: focuses.keyPrefix })
    .from(focuses);
  const focusByPrefix = new Map(allFocuses.map((p) => [p.keyPrefix.toUpperCase(), p.id]));

  const aliasCandidates: string[] = [];
  for (const key of candidates) {
    const [prefix, num] = key.split("-");
    const focusId = focusByPrefix.get(prefix!);
    if (focusId) {
      const [action] = await db
        .select({ id: actions.id })
        .from(actions)
        .where(and(eq(actions.focusId, focusId), eq(actions.number, Number(num))))
        .limit(1);
      if (action) {
        resolved.set(key, action.id);
        continue;
      }
    }
    aliasCandidates.push(key);
  }
  if (aliasCandidates.length > 0) {
    const aliasRows = await db
      .select()
      .from(actionKeyAliases)
      .where(inArray(actionKeyAliases.key, aliasCandidates));
    for (const row of aliasRows) resolved.set(row.key, row.actionId);
  }
  return resolved;
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
  const branchKeys = extractActionKeys(branch);
  const pushCommits = payload.commits ?? [];

  const allKeys = new Set(branchKeys);
  for (const commit of pushCommits)
    for (const key of extractActionKeys(commit.message)) allKeys.add(key);
  const resolved = await resolveActionKeys(db, [...allKeys]);
  if (resolved.size === 0) return { ok: true, linked: 0 };

  const now = new Date();
  let linked = 0;
  for (const commit of pushCommits) {
    if (!commit.id) continue;
    const keys = [...branchKeys, ...extractActionKeys(commit.message)];
    const actionIds = new Set(
      keys.map((key) => resolved.get(key)).filter((id): id is string => id !== undefined),
    );
    const message = (commit.message ?? "").split("\n")[0]!.slice(0, 200);
    for (const actionId of actionIds) {
      const [inserted] = await db
        .insert(commitLinks)
        .values({
          actionId,
          githubRepo,
          sha: commit.id,
          message,
          url: commit.url ?? "",
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue;
      linked++;
      await db.insert(activity).values({
        id: newId("act"),
        actionId,
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
  const resolved = await resolveActionKeys(db, extractActionKeys(pr.title, pr.body, pr.head?.ref));
  if (resolved.size === 0) return { ok: true, linked: 0 };

  const state: PrState = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
  const title = pr.title ?? `#${pr.number}`;
  const url = pr.html_url ?? "";
  const sourceBranch = pr.head?.ref ?? null;
  const now = new Date();
  let linked = 0;

  for (const actionId of new Set(resolved.values())) {
    const [existing] = await db
      .select({ actionId: prLinks.actionId })
      .from(prLinks)
      .where(
        and(
          eq(prLinks.actionId, actionId),
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
            eq(prLinks.actionId, actionId),
            eq(prLinks.githubRepo, githubRepo),
            eq(prLinks.prNumber, pr.number),
          ),
        );
      continue;
    }
    await db.batch([
      db.insert(prLinks).values({
        actionId,
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
        actionId,
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
  // Everything else (ping, actions, etc.): acknowledged, ignored.
  return c.json({ ok: true, ignored: event });
});

// Wrap the Hono app so unhandled throws and explicit `captureException` calls
// reach Sentry (PROG-60). With no `SENTRY_DSN` the wrapper is a no-op, so dev
// and tests are unaffected. `tracesSampleRate: 0` keeps performance/transaction
// volume at zero — error tracking only, so the free tier stays free.
export default Sentry.withSentry(
  (env: Bindings) => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    tracesSampleRate: 0,
    // Don't attach request headers/IP (PII) to events by default.
    sendDefaultPii: false,
  }),
  app,
);
