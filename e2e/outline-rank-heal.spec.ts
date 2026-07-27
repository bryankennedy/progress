import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// PROG-129 regression: a drop landing between two rows that carry the SAME
// fractional rank (racing creates minted duplicate keys in production) used to
// throw rankBetween(dup, dup) out of dnd-kit's drag-end batch and unmount the
// whole page. The drop must instead land AND re-space ("heal") the tied run,
// leaving the group's ranks strictly ordered server-side.

const tag = () => Math.random().toString(36).slice(2, 8);
const prefix = (lead: string) =>
  `${lead}${tag()
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "Z")
    .padEnd(4, "X")
    .slice(0, 4)}`;

async function post<T>(page: Page, path: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

const handleOf = (page: Page, key: string) =>
  page.getByRole("button", { name: `Open ${key} — drag to reorder`, exact: true });

test("a drop between duplicate-rank rows heals the tie instead of crashing (PROG-129)", async ({
  page,
  context,
}) => {
  await signInAsOwner(context);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("/outline");
  const { workspaces } = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await post<{ container: { id: string; keyPrefix: string } }>(page, "/api/focuses", {
      name: `E2E rank heal ${tag()}`,
      keyPrefix: prefix("H"),
      workspaceId: workspaces[0].id,
    })
  ).container;
  const arc = (
    await post<{ container: { id: string } }>(page, "/api/arcs", {
      name: "Heal arc e2e",
      focusId: focus.id,
    })
  ).container;
  const mk = async (title: string) =>
    (
      await post<{ action: { id: string; number: number } }>(page, "/api/actions", {
        title,
        focusId: focus.id,
        arcId: arc.id,
      })
    ).action;
  const top = await mk("Top e2e");
  const dragger = await mk("Dragger e2e");
  const wall1 = await mk("Wall one e2e");
  const wall2 = await mk("Wall two e2e");

  // The production shape: two adjacent rows with one identical degenerate key
  // (the number tiebreak keeps wall1 before wall2). Every rank is pinned —
  // creates append after the ambient DB's global max, so without the pins the
  // rendered order would depend on seed data. Dragger starts BELOW the walls;
  // dragging it up onto Wall two lands it before it, i.e. between the dups.
  const dup = "z".repeat(37) + "s";
  const pins: Array<[{ id: string }, string]> = [
    [top, "b"],
    [wall1, dup],
    [wall2, dup],
    [dragger, "z".repeat(40)],
  ];
  for (const [a, rank] of pins)
    await page.request.patch(`/api/actions/${a.id}`, { data: { rank } });

  const key = (a: { number: number }) => `${focus.keyPrefix}-${a.number}`;
  await page.goto(`/outline?focus=${focus.id}`);
  await handleOf(page, key(dragger)).waitFor();

  // Drag Dragger UP onto Wall two: within a group an upward drop lands the
  // active row before the hovered one — i.e. exactly between the duplicate
  // pair (the drop the old code answered with rankBetween(dup, dup) → throw).
  const from = (await handleOf(page, key(dragger)).boundingBox())!;
  const to = (await handleOf(page, key(wall2)).boundingBox())!;
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx, fy + 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  const tx = to.x + 60;
  const ty = to.y + to.height * 0.3;
  const steps = 20;
  for (let s = 1; s <= steps; s++)
    await page.mouse.move(fx + ((tx - fx) * s) / steps, fy + 6 + ((ty - fy - 6) * s) / steps);
  await page.mouse.up();
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });

  // The heal: dragger sits strictly between the (re-spaced) walls server-side.
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      const rankOf = (id: string) => ws.actions.find((a: { id: string }) => a.id === id)?.rank;
      const order = [top.id, wall1.id, dragger.id, wall2.id].map(rankOf);
      return order.every((r, i) => i === 0 || (r && order[i - 1]! < r));
    })
    .toBe(true);

  // And the page survived: rows still render, no uncaught errors.
  await handleOf(page, key(dragger)).waitFor();
  expect(pageErrors).toEqual([]);

  for (const a of [top, dragger, wall1, wall2])
    await page.request.patch(`/api/actions/${a.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});
