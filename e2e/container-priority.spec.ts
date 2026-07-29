import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Inline priority editing on container pages (PROG-136), in a real browser:
// the outline rows on a focus/arc page carry the shared PriorityPicker, so an
// action's priority is settable from the list without opening the action.
// (Table mode already had the picker via ActionTable, PROG-132.)

const tag = () => Math.random().toString(36).slice(2, 8);

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("outline rows on a focus page set priority in place (PROG-136)", async ({ page }) => {
  // A fresh focus with one none-priority action.
  const ws = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await (
      await page.request.post("/api/focuses", {
        data: {
          name: `E2E priority ${tag()}`,
          workspaceId: ws.workspaces[0].id,
          keyPrefix: `P${tag()
            .toUpperCase()
            .replaceAll(/[^A-Z]/g, "Z")
            .padEnd(4, "Q")
            .slice(0, 4)}`,
        },
      })
    ).json()
  ).container as { id: string };
  const title = `Prio target ${tag()}`;
  const action = (
    await (
      await page.request.post("/api/actions", {
        data: { title, focusId: focus.id, status: "todo" },
      })
    ).json()
  ).action as { id: string };

  // Fresh context → the container list opens in its default outline mode.
  await page.goto(`/focus/${focus.id}`);
  const row = page.locator("div.group", { has: page.locator(`input[value="${title}"]`) });
  await expect(row).toBeVisible();

  // The picker is present even at priority none (transparent until hover, but
  // still interactive); changing it patches the action optimistically.
  const select = row.getByTitle("Change priority");
  await expect(select).toHaveValue("none");
  await select.selectOption("high");
  await expect(select).toHaveValue("high");

  // Server-confirmed.
  await expect
    .poll(async () => {
      const snap = await (await page.request.get("/api/snapshot")).json();
      return snap.actions.find((i: { id: string }) => i.id === action.id)?.priority;
    })
    .toBe("high");

  // Cleanup: cancel the action, archive the focus (shared dev DB hygiene).
  await page.request.patch(`/api/actions/${action.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});
