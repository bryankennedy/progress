import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE, signSession } from "../src/worker/auth";

// Sticky board filters (PROG-58): a filter chosen on the board must survive
// navigating away and back, and clearing must stick. Needs a real browser
// (localStorage + wouter navigation); the restore decision itself is unit-tested
// in src/client/boardFilters.test.ts.

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

// The Priority dropdown is a fixed vocabulary, so it always has options — pick
// the first real one and return its value + visible label.
async function pickPriority(page: Page): Promise<{ value: string; label: string }> {
  const select = page.locator("select", { hasText: "Priority: all" });
  const option = select.locator("option").nth(1); // 0 is "Priority: all"
  const value = (await option.getAttribute("value"))!;
  const label = (await option.textContent())!.trim();
  await select.selectOption(value);
  return { value, label };
}

async function priorityValue(page: Page): Promise<string> {
  return page.locator("select", { hasText: "Priority: all" }).inputValue();
}

test.beforeEach(async ({ page, context }) => {
  const secret = devVar("SESSION_SECRET");
  if (secret) {
    const token = await signSession("usr_owner", "owner@example.com", secret);
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
    ]);
  }
  // Start from a clean slate so a stale memory from another test doesn't leak in.
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("progress:board-filters"));
});

test("a filter chosen on the board survives navigating away and back (PROG-58)", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForSelector("select");
  const { value } = await pickPriority(page);

  // The choice is reflected in the URL immediately.
  await expect.poll(() => page.url()).toContain(`priority=${value}`);

  // Leave the board, then return via the header "Board" link (which points at a
  // bare "/").
  await page.getByRole("link", { name: "Agenda" }).click();
  await expect.poll(() => page.url()).toContain("/agenda");
  await page.getByRole("link", { name: "Board" }).click();

  // Back on the board the selection is restored — both the URL and the control.
  await expect.poll(() => page.url()).toContain(`priority=${value}`);
  await page.waitForSelector("select");
  expect(await priorityValue(page)).toBe(value);
});

test("clearing filters sticks across navigation (PROG-58)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("select");
  const { value } = await pickPriority(page);
  await expect.poll(() => page.url()).toContain(`priority=${value}`);

  // Clear, leave, and come back — it must stay cleared, not resurrect the filter.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(() => priorityValue(page)).toBe("");

  await page.getByRole("link", { name: "Agenda" }).click();
  await expect.poll(() => page.url()).toContain("/agenda");
  await page.getByRole("link", { name: "Board" }).click();

  await page.waitForSelector("select");
  expect(await priorityValue(page)).toBe("");
  expect(page.url()).not.toContain("priority=");
});
