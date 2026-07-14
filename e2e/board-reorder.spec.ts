import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Board vertical reordering (PROG-43), in a real browser — pointer events can't
// be unit-tested. The exhaustive index math (incl. the drag-down off-by-one)
// lives in src/client/boardOrder.test.ts; these prove the end-to-end wiring and
// the drop animation. They only touch the TOP cards of a column, which are
// always on-screen, so they don't flake on off-screen targets.

type Box = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number };

// page.request shares the page's cookie jar (the standalone `request` fixture
// has its own and would 401 once auth is configured).
async function actionOf(
  page: Page,
  id: string,
): Promise<{ rank: string; status: string } | undefined> {
  const ws = await (await page.request.get("/api/snapshot")).json();
  return ws.actions.find((i: { id: string }) => i.id === id);
}
async function rankOf(page: Page, id: string): Promise<string | undefined> {
  return (await actionOf(page, id))?.rank;
}

// On-screen box of a card by id.
async function boxOf(page: Page, id: string): Promise<Box> {
  const b = (await page.locator(`[data-action-id="${id}"]`).boundingBox())!;
  return {
    id,
    x: b.x,
    y: b.y,
    w: b.width,
    h: b.height,
    cx: b.x + b.width / 2,
    cy: b.y + b.height / 2,
  };
}

// Boxes for the given ids, ordered top→bottom (= rank order within a column).
async function boxesIn(page: Page, ids: string[]): Promise<Box[]> {
  return (await Promise.all(ids.map((id) => boxOf(page, id)))).sort((a, b) => a.y - b.y);
}

// Make `status` contain exactly `ids` (in their existing rank order): move those
// in and evict any other current occupants. Keeps each test independent of the
// ambient board and of the other specs that share the dev DB. `backlog` and
// `todo` are the two leftmost columns, so they stay on-screen at this viewport.
async function isolateColumn(page: Page, status: string, ids: string[]): Promise<void> {
  const ws = await (await page.request.get("/api/snapshot")).json();
  const dump = status === "backlog" ? "todo" : "backlog";
  for (const i of ws.actions as { id: string; status: string }[]) {
    if (i.status === status && !ids.includes(i.id)) {
      await page.request.patch(`/api/actions/${i.id}`, { data: { status: dump } });
    }
  }
  for (const id of ids) await page.request.patch(`/api/actions/${id}`, { data: { status } });
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

// Glide the pointer (already pressed) to an absolute (x, y) in small steps.
async function glideTo(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const steps = 24;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(fromX + ((toX - fromX) * s) / steps, fromY + ((toY - fromY) * s) / steps);
  }
}

// Live x of a card via getBoundingClientRect — unlike boundingBox() it doesn't
// wait for the element to stop animating, so it's safe to read mid-drag.
function liveX(page: Page, id: string): Promise<number> {
  return page.locator(`[data-action-id="${id}"]`).evaluate((el) => el.getBoundingClientRect().x);
}

test.beforeEach(async ({ page, context }) => {
  await signInAsOwner(context);
  await page.goto("/?backlog=1"); // show every column
  await page.waitForSelector("[data-action-id]");
});

// Three known cards in `backlog` (leftmost column, always on-screen), in a
// deterministic rank order — independent of ambient data and other specs.
async function threeInBacklog(page: Page): Promise<[Box, Box, Box]> {
  const ws = await (await page.request.get("/api/snapshot")).json();
  const ids: string[] = ws.actions.map((i: { id: string }) => i.id).slice(0, 3);
  await isolateColumn(page, "backlog", ids);
  await page.goto("/?backlog=1");
  await page.waitForSelector(`[data-action-id="${ids[0]}"]`);
  const [a, b, c] = await boxesIn(page, ids);
  return [a!, b!, c!];
}

test("dragging a card up settles in place — no fly-back to the old slot", async ({ page }) => {
  const [c0, , c2] = await threeInBacklog(page); // c2 = bottom of the three

  await press(page, c2);
  await glideY(page, c2.cx, c2.cy + 6, c0.y - 8); // drag the bottom card above the top
  await expect(overlay(page)).toHaveCount(1); // overlay present mid-drag
  await page.mouse.up();
  // The settle tween (PROG-118, shared DROP_ANIMATION ~180ms) glides the
  // overlay into the card's NEW slot, then clears. The old fly-back-to-origin
  // regression is covered by the frame-sampling spec below ("doesn't flash
  // back"); here just require the overlay to clear once the tween ends.
  await expect(overlay(page)).toHaveCount(0, { timeout: 600 });

  await expect
    .poll(async () => {
      const [r0, r2] = [await rankOf(page, c0.id), await rankOf(page, c2.id)];
      return r0 !== undefined && r2 !== undefined && r2 < r0; // c2 now above c0
    })
    .toBe(true);
});

test("dragging a card DOWN past its neighbor persists — does not snap back (PROG-43)", async ({
  page,
}) => {
  const [c0, c1] = await threeInBacklog(page);
  const slot = c1.y - c0.y; // one card's vertical pitch

  const before = await rankOf(page, c0.id);
  await press(page, c0);
  await glideY(page, c0.cx, c0.cy + 6, c0.cy + slot * 1.6); // down past c1
  await page.mouse.up();

  // The off-by-one bug snapped a downward drop back to the top; the card must
  // now rank AFTER its old neighbor.
  await expect
    .poll(
      async () => {
        const [r0, r1] = [await rankOf(page, c0.id), await rankOf(page, c1.id)];
        return r0 !== undefined && r1 !== undefined && r1 < r0;
      },
      { message: "c0 should sort after c1 after dragging down past it" },
    )
    .toBe(true);
  expect(await rankOf(page, c0.id)).not.toBe(before); // it actually changed
});

test("dragging a card to the TOP of a populated column moves it there (PROG-59)", async ({
  page,
}) => {
  // The action's exact scenario, arranged via the API for determinism: a lone
  // card in `todo` and a populated `backlog` (the two leftmost, on-screen
  // columns — a far-right column like in_review would scroll out of view).
  const ws = await (await page.request.get("/api/snapshot")).json();
  const ids: string[] = ws.actions.map((i: { id: string }) => i.id);
  const mover = ids[0]!;
  const fillers = ids.slice(1, 4);
  await isolateColumn(page, "todo", [mover]);
  await isolateColumn(page, "backlog", fillers);

  await page.goto("/?backlog=1");
  await page.waitForSelector(`[data-action-id="${mover}"]`);

  const targetTop = (await boxesIn(page, fillers))[0]!; // top card of backlog
  const moverBox = await boxOf(page, mover);
  expect(Math.round(moverBox.x)).not.toBe(Math.round(targetTop.x)); // genuinely different columns
  const targetTopBefore = (await actionOf(page, targetTop.id))!;

  // Drag the lone card over the TOP card of the populated column, then nudge on
  // its center until onDragOver actually moves the card into the target column
  // (its DOM x crosses into the backlog half). Each onDragOver fires on a move,
  // so a stationary pointer won't commit — hence the nudges. A fast synthetic
  // drag can otherwise outrun React's state commit and release over a stale
  // layout; a human drag is always slow enough that this never bites.
  await press(page, moverBox);
  await glideTo(page, moverBox.cx, moverBox.cy + 6, targetTop.cx, targetTop.cy);
  const half = (moverBox.x + targetTop.x) / 2;
  for (let i = 0; i < 40 && (await liveX(page, mover)) >= half; i++) {
    await page.mouse.move(targetTop.cx, targetTop.cy + (i % 2)); // 0/1px jiggle → onDragOver
    await page.waitForTimeout(20);
  }
  expect(await liveX(page, mover)).toBeLessThan(half); // preview committed before release
  await page.mouse.up();

  await expect
    .poll(async () => (await actionOf(page, mover))?.status, {
      message: "the dragged card should adopt the target column's status",
    })
    .toBe("backlog");
  // And it landed at the top: ranks are base-62 strings, so compare with a
  // lexicographic `<` (what the board sorts by), never numeric toBeLessThan.
  const movedRank = (await rankOf(page, mover))!;
  expect(movedRank < targetTopBefore.rank).toBe(true);
});

test("dragging a card into an EMPTY column drops it there (PROG-40)", async ({ page }) => {
  // A lone card in `todo`, an empty `in_progress` — both on-screen (cols 2 & 3).
  // Empty columns are now full-height; the regression was that closestCorners
  // measured to their far corners and handed the drop to a neighbour's card.
  const ws = await (await page.request.get("/api/snapshot")).json();
  const mover = ws.actions.map((i: { id: string }) => i.id)[0]!;
  await isolateColumn(page, "in_progress", []); // empty the target column
  await isolateColumn(page, "todo", [mover]);

  await page.goto("/?backlog=1");
  await page.waitForSelector(`[data-action-id="${mover}"]`);
  expect((await actionOf(page, mover))!.status).toBe("todo"); // sanity: starts elsewhere

  // The empty column has no card to aim at, so target the column section itself.
  const col = (await page
    .locator("section", { has: page.getByRole("heading", { name: /^In Progress/ }) })
    .boundingBox())!;
  const targetX = col.x + col.width / 2;
  const targetY = col.y + Math.min(col.height / 2, 200);
  const moverBox = await boxOf(page, mover);

  await press(page, moverBox);
  await glideTo(page, moverBox.cx, moverBox.cy + 6, targetX, targetY);
  // Nudge over the empty column until the preview moves the card into it (its
  // DOM x crosses past the midpoint toward the target column), then release.
  const half = (moverBox.x + targetX) / 2;
  for (let i = 0; i < 40 && (await liveX(page, mover)) < half; i++) {
    await page.mouse.move(targetX, targetY + (i % 2));
    await page.waitForTimeout(20);
  }
  expect(await liveX(page, mover)).toBeGreaterThan(half); // preview committed
  await page.mouse.up();

  await expect
    .poll(async () => (await actionOf(page, mover))?.status, {
      message: "the card should land in the empty column it was dropped on",
    })
    .toBe("in_progress");
});

test("a card dropped in a new column doesn't flash back to its old one (PROG-40)", async ({
  page,
}) => {
  // Cross-column drop: lone card in `todo` → top of a populated `backlog`.
  const ws = await (await page.request.get("/api/snapshot")).json();
  const ids: string[] = ws.actions.map((i: { id: string }) => i.id);
  const mover = ids[0]!;
  const fillers = ids.slice(1, 4);
  await isolateColumn(page, "todo", [mover]);
  await isolateColumn(page, "backlog", fillers);

  await page.goto("/?backlog=1");
  await page.waitForSelector(`[data-action-id="${mover}"]`);
  const targetTop = (await boxesIn(page, fillers))[0]!;
  const moverBox = await boxOf(page, mover);

  await press(page, moverBox);
  await glideTo(page, moverBox.cx, moverBox.cy + 6, targetTop.cx, targetTop.cy);
  const half = (moverBox.x + targetTop.x) / 2;
  for (let i = 0; i < 40 && (await liveX(page, mover)) >= half; i++) {
    await page.mouse.move(targetTop.cx, targetTop.cy + (i % 2));
    await page.waitForTimeout(20);
  }

  // Sample the card's x every frame across the release. The bug was a stale
  // store-resync briefly snapping the just-moved card back to its OLD column
  // (a ~360px x-jump) before settling; the card must stay put.
  await page.evaluate((id) => {
    (window as unknown as { __xs: number[] }).__xs = [];
    const t0 = performance.now();
    (function tick() {
      const el = document.querySelector(`[data-action-id="${id}"]`);
      if (el)
        (window as unknown as { __xs: number[] }).__xs.push(
          Math.round(el.getBoundingClientRect().x),
        );
      if (performance.now() - t0 < 400) requestAnimationFrame(tick);
    })();
  }, mover);
  await page.mouse.up();
  await page.waitForTimeout(450);

  const xs = await page.evaluate(() => (window as unknown as { __xs: number[] }).__xs);
  const finalX = xs.at(-1)!;
  const maxDeviation = Math.max(...xs.map((x) => Math.abs(x - finalX)));
  expect(maxDeviation).toBeLessThan(40); // no fly-back to the old column
});
