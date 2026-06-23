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
async function issueOf(page: Page, id: string): Promise<{ rank: string; status: string } | undefined> {
  const ws = await (await page.request.get("/api/workspace")).json();
  return ws.issues.find((i: { id: string }) => i.id === id);
}
async function rankOf(page: Page, id: string): Promise<string | undefined> {
  return (await issueOf(page, id))?.rank;
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

// Glide the pointer (already pressed) to an absolute (x, y) in small steps.
async function glideTo(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  const steps = 24;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(fromX + ((toX - fromX) * s) / steps, fromY + ((toY - fromY) * s) / steps);
  }
}

test.beforeEach(async ({ page, context }) => {
  await signInAsOwner(context);
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

test("dragging a card to the TOP of a populated column moves it there (PROG-59)", async ({
  page,
}) => {
  // Arrange the issue's exact scenario via the API so the test is deterministic
  // regardless of prior drag tests: a card in `todo` and a populated `backlog`.
  // Both are the two leftmost columns, so they stay on-screen at this viewport
  // (a far-right column like in_review would scroll out of view and the drag
  // would never engage).
  const ws = await (await page.request.get("/api/workspace")).json();
  const ids: string[] = ws.issues.map((i: { id: string }) => i.id);
  const mover = ids[0]!;
  const fillers = ids.slice(1, 4); // ensure backlog has several cards
  const patch = (id: string, body: object) =>
    page.request.patch(`/api/issues/${id}`, { data: body });
  await patch(mover, { status: "todo" });
  for (const id of fillers) await patch(id, { status: "backlog" });

  await page.goto("/?backlog=1");
  await page.waitForSelector(`[data-issue-id="${mover}"]`);

  const box = async (id: string): Promise<Box> => {
    const b = (await page.locator(`[data-issue-id="${id}"]`).boundingBox())!;
    return { id, x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  };
  // The backlog column = the column the fillers are in; its top card is the one
  // with the smallest y among them.
  const fillerBoxes = (await Promise.all(fillers.map(box))).sort((a, b) => a.y - b.y);
  const targetTop = fillerBoxes[0]!;
  const moverBox = await box(mover);
  expect(Math.round(moverBox.x)).not.toBe(Math.round(targetTop.x)); // genuinely different columns
  const targetTopBefore = (await issueOf(page, targetTop.id))!;

  // Drag the lone card over the TOP card of the populated column and release —
  // the gesture that used to fly it back unless dropped below every card.
  await press(page, moverBox);
  await glideTo(page, moverBox.cx, moverBox.cy + 6, targetTop.cx, targetTop.y + 4);
  await page.mouse.up();

  await expect
    .poll(async () => (await issueOf(page, mover))?.status, {
      message: "the dragged card should adopt the target column's status",
    })
    .toBe("backlog");
  // And it landed at the top: ranks are base-62 strings, so compare with a
  // lexicographic `<` (what the board sorts by), never numeric toBeLessThan.
  const movedRank = (await rankOf(page, mover))!;
  expect(movedRank < targetTopBefore.rank).toBe(true);
});
