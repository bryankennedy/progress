import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE, signSession } from "../src/worker/auth";

// Board vertical reordering (PROG-43), in a real browser — pointer events can't
// be unit-tested. The exhaustive index math (incl. the drag-down off-by-one)
// lives in src/client/boardOrder.test.ts; these prove the end-to-end wiring and
// the drop animation. They only touch the TOP cards of a column, which are
// always on-screen, so they don't flake on off-screen targets.

type Box = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number };

// page.request shares the page's cookie jar (the standalone `request` fixture
// has its own and would 401 once auth is configured).
async function rankOf(page: Page, id: string): Promise<string | undefined> {
  const ws = await (await page.request.get("/api/workspace")).json();
  return ws.issues.find((i: { id: string }) => i.id === id)?.rank;
}

// Cards grouped into columns by x position, each ordered top→bottom (= rank order).
async function columns(page: Page): Promise<Box[][]> {
  const boxes: Box[] = await page.locator("[data-issue-id]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-issue-id")!,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    }),
  );
  const groups = new Map<number, Box[]>();
  for (const b of boxes) {
    const key = Math.round(b.x);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(b);
  }
  return [...groups.values()].map((arr) => arr.sort((a, b) => a.y - b.y));
}

async function largestColumn(page: Page): Promise<Box[]> {
  return (await columns(page)).sort((a, b) => b.length - a.length)[0] ?? [];
}

const overlay = (page: Page) => page.locator("[data-drag-overlay]");

// Press a card and clear the 4px drag-activation threshold.
async function press(page: Page, box: Box) {
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx, box.cy + 6);
}

// Glide the pointer (already pressed) vertically to an absolute y in small steps
// so dnd-kit tracks it.
async function glideY(page: Page, x: number, fromY: number, toY: number) {
  const steps = 18;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(x, fromY + ((toY - fromY) * s) / steps);
  }
}

// Read a key from the gitignored .dev.vars (KEY=value lines), if present.
function devVar(key: string): string | undefined {
  try {
    const txt = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim();
    }
  } catch {
    /* no .dev.vars → auth is unconfigured and the worker falls back to owner */
  }
  return undefined;
}

test.beforeEach(async ({ page, context }) => {
  // When local auth is configured (real OAuth creds in .dev.vars), the worker's
  // owner fallback is off and every /api/* call would 401. Sign a session cookie
  // for the owner — exactly what a logged-in user carries — so the board loads.
  // With auth unconfigured (CI / fresh checkout) there's no secret, the worker
  // falls back to the owner, and this is simply skipped.
  const secret = devVar("SESSION_SECRET");
  if (secret) {
    const token = await signSession("usr_owner", "owner@example.com", secret);
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
    ]);
  }
  await page.goto("/?backlog=1"); // show every column
  await page.waitForSelector("[data-issue-id]");
});

test("dragging a card up settles in place — no fly-back to the old slot", async ({ page }) => {
  const col = await largestColumn(page);
  test.skip(col.length < 2, "needs a column with at least two cards");
  const c0 = col[0]!; // top
  const c1 = col[1]!; // second (on-screen)

  await press(page, c1);
  await glideY(page, c1.cx, c1.cy + 6, c0.y - 8); // drag the second card above the first
  await expect(overlay(page)).toHaveCount(1); // overlay present mid-drag
  await page.mouse.up();
  // Regression: the buggy default drop animation kept the overlay clone alive
  // ~250ms flying back to the origin; it must clear well inside that.
  await expect(overlay(page)).toHaveCount(0, { timeout: 120 });

  await expect
    .poll(async () => {
      const [r0, r1] = [await rankOf(page, c0.id), await rankOf(page, c1.id)];
      return r0 !== undefined && r1 !== undefined && r1 < r0; // c1 now above c0
    })
    .toBe(true);
});

test("dragging a card DOWN past its neighbor persists — does not snap back (PROG-43)", async ({
  page,
}) => {
  const col = await largestColumn(page);
  test.skip(col.length < 3, "needs a column with at least three cards");
  const c0 = col[0]!; // top (lowest rank)
  const c1 = col[1]!;
  const slot = c1.y - c0.y; // one card's vertical pitch

  const before = await rankOf(page, c0.id);
  await press(page, c0);
  await glideY(page, c0.cx, c0.cy + 6, c0.cy + slot * 1.6); // down past c1
  await page.mouse.up();

  // The off-by-one bug snapped a downward drop back to the top; the card must
  // now rank AFTER its old neighbor.
  await expect
    .poll(async () => {
      const [r0, r1] = [await rankOf(page, c0.id), await rankOf(page, c1.id)];
      return r0 !== undefined && r1 !== undefined && r1 < r0;
    }, { message: "c0 should sort after c1 after dragging down past it" })
    .toBe(true);
  expect(await rankOf(page, c0.id)).not.toBe(before); // it actually changed
});
