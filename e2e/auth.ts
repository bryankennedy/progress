import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { SESSION_COOKIE, signSession } from "../src/worker/auth";

// Shared e2e sign-in. When local auth is configured (real OAuth creds in
// .dev.vars), the worker's owner fallback is off and every /api/* call would
// 401, so we mint the owner a signed session cookie — exactly what a logged-in
// user carries. The session email must be one the worker authorizes (D44:
// super-admin or D1 allowlist), so we use the configured super-admin email; the
// uid stays usr_owner, the real owner row. With auth unconfigured (CI / fresh
// checkout) there's no secret and the worker falls back to the owner, so this is
// a no-op.

// Read a key from the gitignored .dev.vars (KEY=value lines), if present.
export function devVar(key: string): string | undefined {
  try {
    const txt = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim();
    }
  } catch {
    /* no .dev.vars → auth unconfigured, worker falls back to owner */
  }
  return undefined;
}

export async function signInAsOwner(context: BrowserContext): Promise<void> {
  const secret = devVar("SESSION_SECRET");
  if (!secret) return; // auth unconfigured → owner fallback handles it
  // An email the worker will authorize: the configured super-admin (D44).
  const email =
    (devVar("SUPER_ADMIN_EMAILS") ?? devVar("ALLOWED_EMAILS") ?? "owner@example.com")
      .split(",")[0]!
      .trim();
  const token = await signSession("usr_owner", email, secret);
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
  ]);
}
