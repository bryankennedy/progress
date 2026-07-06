import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Agenda quick-add (PROG-89), in a real browser: typing under a date grouping
// creates an issue pre-dated for that bucket. The date math is unit-tested
// (agendaQuickAdd.test.ts); this proves the wiring — the input renders under a
// populated group, Enter creates optimistically into the picked product, and
// the server-confirmed issue carries the bucket's due date.
//
// Each test creates its own product + a seed issue via the API (groups are
// hidden when empty, so the seed makes the target group render), and archives
// the product at the end.

const tag = () => Math.random().toString(36).slice(2, 8);

// Local calendar today/+n as YYYY-MM-DD — same day the app computes (todayISO).
function localISO(plusDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function makeProductWithSeed(page: Page, seedDue: string) {
  const ws = await (await page.request.get("/api/workspace")).json();
  const product = (
    await (
      await page.request.post("/api/products", {
        data: {
          name: `E2E agenda ${tag()}`,
          initiativeId: ws.initiatives[0].id,
          keyPrefix: `A${tag().toUpperCase().replaceAll(/[^A-Z]/g, "Z").padEnd(4, "Q").slice(0, 4)}`,
        },
      })
    ).json()
  ).container as { id: string };
  const seed = (
    await (
      await page.request.post("/api/issues", {
        data: { title: `Seed ${tag()}`, productId: product.id, dueDate: seedDue, status: "todo" },
      })
    ).json()
  ).issue as { id: string };
  return { product, seed };
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("quick-add under Today creates an issue due today (PROG-89)", async ({ page }) => {
  const today = localISO();
  const { product } = await makeProductWithSeed(page, today);

  // Filter to the fresh product so the seeded issue is the group's only row
  // and the quick-add picker follows the filter.
  await page.goto(`/agenda?product=${product.id}`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: /^Today/ }) });
  await expect(section).toBeVisible();

  const title = `Quick today ${tag()}`;
  const input = section.getByLabel(`New issue due ${today}`);
  await input.fill(title);
  await input.press("Enter");

  // Appears in the Today group instantly (optimistic), input clears for the next.
  await expect(section.getByText(title)).toBeVisible();
  await expect(input).toHaveValue("");

  // Server-confirmed: right product, due today, todo.
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/workspace")).json();
      const issue = ws.issues.find(
        (i: { title: string; productId: string }) => i.title === title && i.productId === product.id,
      );
      return issue && { dueDate: issue.dueDate, status: issue.status };
    })
    .toEqual({ dueDate: today, status: "todo" });

  await page.request.patch(`/api/products/${product.id}`, { data: { archived: true } });
});

test("quick-add under This week dates to the window's last day; Overdue has no input (PROG-89)", async ({
  page,
}) => {
  const { product } = await makeProductWithSeed(page, localISO(3)); // seeds the This-week group
  // An overdue seed too, to prove the Overdue group renders WITHOUT an input.
  await page.request.post("/api/issues", {
    data: { title: `Late seed ${tag()}`, productId: product.id, dueDate: localISO(-2), status: "todo" },
  });

  await page.goto(`/agenda?product=${product.id}`);
  const weekSection = page.locator("section", {
    has: page.getByRole("heading", { name: /^This week/ }),
  });
  const overdueSection = page.locator("section", {
    has: page.getByRole("heading", { name: /^Overdue/ }),
  });
  await expect(overdueSection).toBeVisible();
  await expect(overdueSection.locator("input[type=text], input:not([type])")).toHaveCount(0);

  const endOfWindow = localISO(6);
  const title = `Quick week ${tag()}`;
  const input = weekSection.getByLabel(`New issue due ${endOfWindow}`);
  await input.fill(title);
  await input.press("Enter");
  await expect(weekSection.getByText(title)).toBeVisible();

  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/workspace")).json();
      return ws.issues.find((i: { title: string }) => i.title === title)?.dueDate;
    })
    .toBe(endOfWindow);

  await page.request.patch(`/api/products/${product.id}`, { data: { archived: true } });
});
