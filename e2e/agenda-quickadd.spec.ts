import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Agenda quick-add (PROG-89), in a real browser: typing under a date grouping
// creates an action pre-dated for that bucket. The date math is unit-tested
// (agendaQuickAdd.test.ts); this proves the wiring — the input renders under a
// populated group, Enter creates optimistically into the picked focus, and
// the server-confirmed action carries the bucket's due date.
//
// Each test creates its own focus + a seed action via the API (groups are
// hidden when empty, so the seed makes the target group render), and archives
// the focus at the end.

const tag = () => Math.random().toString(36).slice(2, 8);

// Local calendar today/+n as YYYY-MM-DD — same day the app computes (todayISO).
function localISO(plusDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Focus names must not contain nav-link words ("Agenda", "Board", …): the
// board card prints the focus name inside the card link, so a focus named
// "… agenda …" makes bare nav-link selectors ambiguous for every later spec
// sharing the dev DB.
async function makeFocusWithSeed(page: Page, seedDue: string) {
  const ws = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await (
      await page.request.post("/api/focuses", {
        data: {
          name: `E2E quickadd ${tag()}`,
          workspaceId: ws.workspaces[0].id,
          keyPrefix: `A${tag().toUpperCase().replaceAll(/[^A-Z]/g, "Z").padEnd(4, "Q").slice(0, 4)}`,
        },
      })
    ).json()
  ).container as { id: string };
  const seed = (
    await (
      await page.request.post("/api/actions", {
        data: { title: `Seed ${tag()}`, focusId: focus.id, dueDate: seedDue, status: "todo" },
      })
    ).json()
  ).action as { id: string };
  return { focus, seed };
}

// Archiving a focus hides it from filters, but its actions stay visible
// everywhere (archive semantics) — so also cancel them, or every run leaves
// live cards on the shared dev board.
async function cleanupFocus(page: Page, focusId: string) {
  const ws = await (await page.request.get("/api/snapshot")).json();
  for (const i of ws.actions as { id: string; focusId: string }[]) {
    if (i.focusId === focusId) {
      await page.request.patch(`/api/actions/${i.id}`, { data: { status: "canceled" } });
    }
  }
  await page.request.patch(`/api/focuses/${focusId}`, { data: { archived: true } });
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("quick-add under Today creates an action due today (PROG-89)", async ({ page }) => {
  const today = localISO();
  const { focus } = await makeFocusWithSeed(page, today);

  // Filter to the fresh focus so the seeded action is the group's only row
  // and the quick-add picker follows the filter.
  await page.goto(`/agenda?focus=${focus.id}`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: /^Today/ }) });
  await expect(section).toBeVisible();

  const title = `Quick today ${tag()}`;
  const input = section.getByLabel(`New action due ${today}`);
  await input.fill(title);
  await input.press("Enter");

  // Appears in the Today group instantly (optimistic), input clears for the next.
  await expect(section.getByText(title)).toBeVisible();
  await expect(input).toHaveValue("");

  // Server-confirmed: right focus, due today, todo.
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      const action = ws.actions.find(
        (i: { title: string; focusId: string }) => i.title === title && i.focusId === focus.id,
      );
      return action && { dueDate: action.dueDate, status: action.status };
    })
    .toEqual({ dueDate: today, status: "todo" });

  await cleanupFocus(page, focus.id);
});

test("quick-add under This week dates to the window's last day; Overdue has no input (PROG-89)", async ({
  page,
}) => {
  const { focus } = await makeFocusWithSeed(page, localISO(3)); // seeds the This-week group
  // An overdue seed too, to prove the Overdue group renders WITHOUT an input.
  await page.request.post("/api/actions", {
    data: { title: `Late seed ${tag()}`, focusId: focus.id, dueDate: localISO(-2), status: "todo" },
  });

  await page.goto(`/agenda?focus=${focus.id}`);
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
  const input = weekSection.getByLabel(`New action due ${endOfWindow}`);
  await input.fill(title);
  await input.press("Enter");
  await expect(weekSection.getByText(title)).toBeVisible();

  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      return ws.actions.find((i: { title: string }) => i.title === title)?.dueDate;
    })
    .toBe(endOfWindow);

  await cleanupFocus(page, focus.id);
});
