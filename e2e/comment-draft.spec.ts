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

// Open the first action from the board and wait for the comment composer.
async function openFirstAction(page: Page): Promise<void> {
  await page.goto("/");
  const card = page.locator('a[href^="/action/"]').first();
  await card.waitFor();
  await card.click();
  await page.waitForSelector(COMMENT);
}

test("a comment draft survives a reload (PROG-51)", async ({ page }) => {
  await openFirstAction(page);
  const text = `Draft that must survive a reload ${Date.now()}`;
  await page.locator(COMMENT).fill(text);
  await page.waitForTimeout(600); // past the 400ms debounce → localStorage
  await page.reload();
  await expect(page.locator(COMMENT)).toHaveValue(text);
});

test("posting a comment clears its draft, even across a reload (PROG-51)", async ({ page }) => {
  await openFirstAction(page);
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

test("a second comment typed during an in-flight send is not clobbered (PROG-51)", async ({
  page,
}) => {
  await openFirstAction(page);

  // Hold the comment POST open so there's a window to keep typing while the first
  // send is in flight (the slow/retry path).
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/comments", async (route) => {
    await gate;
    await route.continue();
  });

  // Unique per run — the local DB persists comments across test runs.
  const sent = `first comment ${Date.now()}`;
  const stillTyping = `second comment still being written ${Date.now()}`;

  const box = page.locator(COMMENT);
  await box.fill(sent);
  await page.getByRole("button", { name: "Comment" }).click();

  // While the first POST is held, the user types a brand-new comment.
  await box.fill(stillTyping);
  release(); // let the first POST complete

  // The first comment lands, but the in-progress second comment is preserved —
  // the success handler must not wipe text it didn't send.
  await expect(page.locator("li", { hasText: sent })).toBeVisible();
  await expect(box).toHaveValue(stillTyping);
});

test("repeated comment-save failures don't stack toasts (PROG-51)", async ({ page }) => {
  await openFirstAction(page);
  // Force every comment POST to fail so each submit raises a sticky Retry toast.
  await page.route("**/comments", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
  );

  const box = page.locator(COMMENT);
  await box.fill(`will fail ${Date.now()}`);
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator("[data-toast]")).toHaveCount(1);

  // A second failure from the same composer replaces its toast rather than
  // stacking a duplicate.
  await box.fill(`will fail again ${Date.now()}`);
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator("[data-toast]")).toHaveCount(1);
});

test("a container description draft is restored with an indicator (PROG-51)", async ({ page }) => {
  // Reach a container page via the action breadcrumb's focus link.
  await openFirstAction(page);
  await page.locator('a[href^="/focus/"]').first().click();
  await page.waitForSelector("section.cursor-text");

  await page.locator("section.cursor-text").first().click();
  const text = `Container description draft ${Date.now()}`;
  await page.locator(DESC_EDITOR).fill(text);
  await page.waitForTimeout(600);
  await page.reload();

  await page.locator("section.cursor-text").first().click();
  await expect(page.locator(DESC_EDITOR)).toHaveValue(text);
  await expect(page.getByText("Unsaved draft restored.")).toBeVisible();
});

test("an unsaved description edit is restored with an indicator (PROG-51)", async ({ page }) => {
  await openFirstAction(page);

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
