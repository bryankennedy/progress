import { expect, test, type APIRequestContext } from "@playwright/test";

// Board vertical reordering (PROG-43). These need real pointer events, so they
// run in a browser rather than the unit suite.

type Box = { id: string; x: number; y: number; cx: number; cy: number };

async function rankOf(request: APIRequestContext, id: string): Promise<string | undefined> {
  const ws = await (await request.get("/api/workspace")).json();
  return ws.issues.find((i: { id: string }) => i.id === id)?.rank;
}

// Two cards stacked in the same column (same x, one directly below the other).
async function stackedPair(page: import("@playwright/test").Page) {
  const boxes: Box[] = await page.locator("[data-issue-id]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-issue-id")!, x: r.x, y: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }),
  );
  for (const a of boxes) {
    const below = boxes
      .filter((b) => b.id !== a.id && Math.abs(b.x - a.x) < 5 && b.y > a.y)
      .sort((m, n) => m.y - n.y)[0];
    if (below) return { top: a, bottom: below };
  }
  return null;
}

test("dragging a card up settles in place — no fly-back to the old slot (PROG-43)", async ({
  page,
  request,
}) => {
  await page.goto("/?backlog=1"); // show every column so a 2+ card one exists
  await page.waitForSelector("[data-issue-id]");

  const pair = await stackedPair(page);
  test.skip(!pair, "needs a column with at least two cards");
  const { top, bottom } = pair!;

  // Drag the lower card up to just above the upper card.
  await page.mouse.move(bottom.cx, bottom.cy);
  await page.mouse.down();
  const steps = 12;
  const targetX = top.cx;
  const targetY = top.y - 6;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(
      bottom.cx + ((targetX - bottom.cx) * s) / steps,
      bottom.cy + ((targetY - bottom.cy) * s) / steps,
    );
  }
  // The floating overlay is present while dragging.
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);

  await page.mouse.up();

  // The regression: the buggy default drop animation keeps the overlay clone
  // alive ~250ms while it flies back to the origin. The fix removes it at once,
  // so it must be gone well inside that window.
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 120 });

  // And the reorder actually persisted: the dragged card now ranks above its
  // former upper neighbour.
  await expect
    .poll(async () => {
      const [b, t] = [await rankOf(request, bottom.id), await rankOf(request, top.id)];
      return b !== undefined && t !== undefined && b < t;
    })
    .toBe(true);
});
