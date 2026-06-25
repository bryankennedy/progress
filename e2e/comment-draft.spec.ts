import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// PROG-51: comment and description drafts are mirrored to localStorage as you
// type, so unsent work survives a reload / tab close / failed save, and the
// draft is cleared once the server confirms. The persistence + restore is
// browser-only behavior (localStorage + the editor's restore indicator); the
// server-side idempotency that makes a failed-comment retry safe is verified
// separately against the API.

const COMMENT = 'textarea[placeholder^="Leave a comment"]';
const DESC_EDITOR = "textarea.font-mono"; // EditableMarkdown's edit surface

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

// Open the first issue from the board and wait for the comment composer.
async function openFirstIssue(page: Page): Promise<void> {
  await page.goto("/");
  const card = page.locator('a[href^="/issue/"]').first();
  await card.waitFor();
  await card.click();
  await page.waitForSelector(COMMENT);
}

test("a comment draft survives a reload (PROG-51)", async ({ page }) => {
  await openFirstIssue(page);
  const text = `Draft that must survive a reload ${Date.now()}`;
  await page.locator(COMMENT).fill(text);
  await page.waitForTimeout(600); // past the 400ms debounce → localStorage
  await page.reload();
  await expect(page.locator(COMMENT)).toHaveValue(text);
});

test("posting a comment clears its draft, even across a reload (PROG-51)", async ({ page }) => {
  await openFirstIssue(page);
  const text = `Comment to post ${Date.now()}`;
  await page.locator(COMMENT).fill(text);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Comment" }).click();

  // The composer clears on confirm and the comment lands in the thread (scoped
  // to the list item so it doesn't also match the textarea while in flight).
  await expect(page.locator(COMMENT)).toHaveValue("");
  await expect(page.locator("li", { hasText: text })).toBeVisible();

  // The draft was cleared on confirm, so a reload doesn't resurrect it.
  await page.reload();
  await expect(page.locator(COMMENT)).toHaveValue("");
});

test("an unsaved description edit is restored with an indicator (PROG-51)", async ({ page }) => {
  await openFirstIssue(page);

  // Enter the description editor and type, but leave WITHOUT saving (reload).
  await page.locator("section.cursor-text").first().click();
  const text = `Unsaved description edit ${Date.now()}`;
  await page.locator(DESC_EDITOR).fill(text);
  await page.waitForTimeout(600);
  await page.reload();

  // Reopening shows the restored draft plus the "unsaved draft" indicator, so
  // it's never mistaken for the saved description.
  await page.locator("section.cursor-text").first().click();
  await expect(page.locator(DESC_EDITOR)).toHaveValue(text);
  await expect(page.getByText("Unsaved draft restored.")).toBeVisible();

  // Discarding drops the draft and reverts to the saved value.
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(DESC_EDITOR)).not.toHaveValue(text);
});
