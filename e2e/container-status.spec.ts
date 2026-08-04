import { expect, test } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Inline status editing on container pages (PROG-140), in a real browser: the
// outline rows on a focus/arc page carry the shared StatusPicker, so an
// action's status is settable from the list without opening the action. Table
// mode gets the same picker via ActionTable. Mirrors container-priority.spec
// (PROG-136).

const tag = () => Math.random().toString(36).slice(2, 8);

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("outline rows on a focus page set status in place (PROG-140)", async ({ page }) => {
  const ws = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await (
      await page.request.post("/api/focuses", {
        data: {
          name: `E2E status ${tag()}`,
          workspaceId: ws.workspaces[0].id,
          keyPrefix: `S${tag()
            .toUpperCase()
            .replaceAll(/[^A-Z]/g, "Z")
            .padEnd(4, "Q")
            .slice(0, 4)}`,
        },
      })
    ).json()
  ).container as { id: string };
  const title = `Status target ${tag()}`;
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

  const select = row.getByTitle("Change status");
  await expect(select).toHaveValue("todo");
  await select.selectOption("in_progress");
  await expect(select).toHaveValue("in_progress");

  // Server-confirmed.
  await expect
    .poll(async () => {
      const snap = await (await page.request.get("/api/snapshot")).json();
      return snap.actions.find((i: { id: string }) => i.id === action.id)?.status;
    })
    .toBe("in_progress");

  // Table mode: the same picker, with its label shown, on the container
  // page's table view.
  await page.getByRole("button", { name: "Table" }).click();
  const tableRow = page.locator("tr", { has: page.getByRole("link", { name: title }) });
  await expect(tableRow).toBeVisible();
  const tableSelect = tableRow.getByTitle("Change status");
  await expect(tableSelect).toHaveValue("in_progress");
  await tableSelect.selectOption("done");
  await expect(tableSelect).toHaveValue("done");

  await expect
    .poll(async () => {
      const snap = await (await page.request.get("/api/snapshot")).json();
      return snap.actions.find((i: { id: string }) => i.id === action.id)?.status;
    })
    .toBe("done");

  // Cleanup: cancel the action, archive the focus (shared dev DB hygiene).
  await page.request.patch(`/api/actions/${action.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});
