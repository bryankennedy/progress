// In-app Google authentication (PROG-34, supersedes the Cloudflare Access gate
// of D12). The Worker runs the OAuth 2.0 Authorization Code flow itself, mints a
// stateless signed session cookie, and reads identity per request — so every
// write is attributed to the authenticated user instead of a hardcoded owner.
//
// Why no id_token signature verification: the id_token is received directly from
// Google's token endpoint over TLS (server-to-server, never through the browser),
// which is exactly the case Google's docs say does not require local signature
// verification. We still validate the issuer / audience / expiry claims. This
// keeps the module dependency-free (no JWKS fetch, no RS256) — see also the
// HMAC-only webhook auth in index.ts.

import { sign, verify } from "hono/jwt";

export const SESSION_COOKIE = "progress_session";
export const STATE_COOKIE = "progress_oauth_state";

// 30 days; this is the only writer of its own data, so a long-lived session is
// fine and avoids a refresh-token dance (out of scope, PROG-34).
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const STATE_TTL_SECONDS = 60 * 10;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

// Cap on the server-to-server token exchange. Without it, a hung Google endpoint
// would hold the OAuth callback request open indefinitely; abort and surface a
// 4xx instead so the user can simply retry sign-in.
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

// The subset of Worker bindings auth needs. Optional so the unconfigured path
// (local dev) can be detected by their absence.
export type AuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PROGRESS_API_TOKEN?: string;
  // Super-admins: comma-separated emails that may manage the runtime allowlist
  // and are always allowed to sign in (D43). `ALLOWED_EMAILS` is the old
  // name, read only as a transitional fallback so a deploy that hasn't set the
  // renamed secret yet doesn't lock everyone out; remove once secrets are cut.
  SUPER_ADMIN_EMAILS?: string;
  /** @deprecated superseded by SUPER_ADMIN_EMAILS; kept as a fallback only. */
  ALLOWED_EMAILS?: string;
  APP_BASE_URL?: string;
};

// Auth is "configured" only when both the OAuth client and the cookie-signing
// secret are present. When it isn't (local dev), index.ts falls back to the
// owner so `bun run dev` and tests never hit a login wall.
export function authConfigured(env: AuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

// The redirect_uri must match exactly between /login and /callback and be
// registered on the Google OAuth client. Default to the request's own origin so
// the same build works on localhost and production without extra config.
export function redirectUri(env: AuthEnv, requestUrl: string): string {
  const base = (env.APP_BASE_URL ?? new URL(requestUrl).origin).replace(/\/+$/, "");
  return `${base}/api/auth/callback`;
}

// Super-admins are env-defined (the secret). They manage the D1 allowlist and
// are always allowed to sign in — the actual "may use the app" check
// (super-admin OR allowlisted) lives in index.ts where D1 is available.
export function isSuperAdmin(email: string | undefined, env: AuthEnv): boolean {
  if (!email) return false;
  const allow = (env.SUPER_ADMIN_EMAILS ?? env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

export function googleAuthUrl(env: AuthEnv, state: string, redirect: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    // Always show the account chooser — avoids silently re-using a wrong
    // Google session on a shared browser.
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string };

// Exchange the authorization code for tokens and return the verified-by-claims
// identity. Throws on any failure; the caller maps that to a 4xx.
export async function exchangeCodeForIdentity(
  env: AuthEnv,
  code: string,
  redirect: string,
): Promise<GoogleIdentity> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirect,
        grant_type: "authorization_code",
      }),
      // Abort rather than hang forever if Google's token endpoint stalls.
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
      throw new Error("google token exchange timed out");
    throw err;
  }
  if (!res.ok) throw new Error(`google token exchange failed: HTTP ${res.status}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("google token response had no id_token");

  const claims = decodeJwtClaims(tokens.id_token);
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) throw new Error("unexpected id_token issuer");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("id_token audience mismatch");
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now())
    throw new Error("id_token expired");
  if (typeof claims.email !== "string") throw new Error("id_token had no email");

  return {
    sub: String(claims.sub ?? ""),
    email: claims.email,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name : claims.email,
  };
}

// ---- session cookie (HS256 via hono/jwt) ----

export type SessionPayload = { uid: string; email: string; exp: number };

export async function signSession(uid: string, email: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return sign({ uid, email, exp }, secret, "HS256");
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const payload = (await verify(token, secret, "HS256")) as unknown as SessionPayload;
    if (!payload?.uid) return null;
    return payload;
  } catch {
    return null;
  }
}

// Short-lived signed token used as the OAuth `state` (CSRF guard). Reusing the
// session secret is fine — it's HMAC over a random nonce with a 10-min expiry.
export async function signState(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  return sign({ n: crypto.randomUUID(), exp }, secret, "HS256");
}

export async function verifyState(token: string, secret: string): Promise<boolean> {
  try {
    await verify(token, secret, "HS256");
    return true;
  } catch {
    return false;
  }
}

// ---- helpers ----

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("malformed id_token");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(atob(b64)) as Record<string, unknown>;
}
