import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// PROG-40: the Done column is capped to the most-recently-completed issues so it
// can't make the board endless, and every column shares one height so a card can
// be dropped into a column's full-height zone (not just its top).

// Statuses changed by markDone, so afterEach can put them back — these specs
// share the dev DB with the others, and draining columns into Done would break
// the reorder specs that read the ambient board.
let touched: { id: string; status: string }[] = [];

async function markDone(page: Page, n: number): Promise<number> {
  const ws = await (await page.request.get("/api/snapshot")).json();
  const subset = ws.issues.slice(0, n) as { id: string; status: string }[];
  touched = subset.map((i) => ({ id: i.id, status: i.status }));
  // Sequential so completedAt timestamps differ (the API sets it to "now").
  for (const { id } of touched) {
    await page.request.patch(`/api/issues/${id}`, { data: { status: "done" } });
  }
  const after = await (await page.request.get("/api/snapshot")).json();
  return after.issues.filter((i: { status: string }) => i.status === "done").length;
}

const doneSection = (page: Page) =>
  page.locator("section", { has: page.getByRole("heading", { name: /^Done/ }) });

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test.afterEach(async ({ page }) => {
  for (const { id, status } of touched) {
    await page.request.patch(`/api/issues/${id}`, { data: { status } });
  }
  touched = [];
});

test("the Done column shows at most the 10 most recent, noting the total (PROG-40)", async ({
  page,
}) => {
  const doneTotal = await markDone(page, 12); // > 10 so the cap engages
  expect(doneTotal).toBeGreaterThan(10);

  await page.goto("/?backlog=1");
  await page.waitForSelector("[data-issue-id]");

  const done = doneSection(page);
  await expect(done.getByRole("heading")).toHaveText(`Done · 10 of ${doneTotal}`);
  await expect(done.locator("[data-issue-id]")).toHaveCount(10); // exactly 10 cards rendered
});

test("all board columns share one height so the drop zone spans the column (PROG-40)", async ({
  page,
}) => {
  await markDone(page, 12); // make one column much taller than the rest
  await page.goto("/?backlog=1");
  await page.waitForSelector("[data-issue-id]");

  // Each kanban column is a <section> with a heading; with items-stretch they
  // must all render at the same height regardless of how many cards they hold.
  const heights = await page
    .locator("section", { has: page.getByRole("heading") })
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});
