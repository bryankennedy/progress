---
name: verify
description: Build, run, and drive this app in a headless browser to verify a UI change end-to-end. Use before committing nontrivial client/worker changes.
---

# Verify a change in the running app

## Launch

- `bun run dev` serves API + client on **:8000** (background it; logs are JSON lines).
- **Fresh checkout gotcha:** the local D1 database starts empty and every
  `/api/*` call 500s (`Failed query … from "workspaces"`). Fix:
  `bun run db:migrate && bun run db:seed` (or `db:seed:scale` for 5k actions).

## Auth

With real OAuth creds in `.dev.vars`, every API call 401s without a session.
Reuse the e2e helper — it mints the owner a signed session cookie (no-op when
auth is unconfigured):

```ts
import { chromium } from "playwright";
import { signInAsOwner } from "/abs/path/to/repo/e2e/auth";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await signInAsOwner(context); // BEFORE newPage()
const page = await context.newPage();
```

## Drive

- Playwright chromium is already installed (`~/.cache/ms-playwright`). Run
  ad-hoc driver scripts with `bun <script>.ts` from the scratchpad — no need
  for the `@playwright/test` runner.
- The client is a load-everything SPA: pages render only after
  `GET /api/snapshot` succeeds, so `waitForSelector` on real content, and a
  stuck "Loading…" body means an API/auth problem — check the dev log first.
- Seed data titles are synthetic ("Seed ur3lp0", …) — don't hardcode query
  terms; scrape a word from a rendered row when a test needs a matching query.
- Mobile check: `page.setViewportSize({ width: 390, height: 800 })`; wide
  tables must scroll inside their own container, never the page.
