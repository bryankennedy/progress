import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Drag-to-MOVE on the Outline (PROG-118), in a real browser — the page-wide
// DndContext lets an action row be dropped outside its own sibling group: into
// another arc (one optimistic PATCH) or into another focus entirely (a real
// move: re-key + alias, via POST /api/actions/:id/move with the landing arc and
// rank). The rank/guard math is unit-tested (outlineReorder/outlineTree); these
// prove the end-to-end wiring with genuine pointer events, and that the result
// is server-side (it survives a reload).
//
// Each test creates its OWN containers/actions via the API (unique names and
// prefixes), so it is independent of the ambient dev DB and of other specs; it
// cancels its actions and archives the containers again at the end. The cancel
// matters: archiving a focus does NOT close its actions, and the board specs
// herd every ambient open action around with isolateColumn — leaked e2e
// actions accumulate across runs until those columns overflow the viewport and
// the board drags miss their targets (how PROG-118's leftovers broke
// board-reorder's PROG-59 spec).

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

type Container = { id: string };
type Action = { id: string; number: number; arcId: string | null; focusId: string };

// A row's bullet handle (PROG-111): an anchor that dnd-kit's sortable
// attributes expose as role=button, named "Open <KEY> — drag to reorder".
const handleOf = (page: Page, key: string) =>
  page.getByRole("button", { name: `Open ${key} — drag to reorder`, exact: true });

// Press an action row's bullet handle, clear the 4px activation threshold,
// glide to the target point in small steps so dnd-kit tracks it, and release.
// Mid-drag, the held row must be carried by a floating DragOverlay card
// (constant grabbed-it feedback that persists across arc/focus sections —
// PROG-118 polish), and it must clear once the drop settles.
async function dragActionTo(page: Page, actionKey: string, toX: number, toY: number) {
  const handle = (await handleOf(page, actionKey).boundingBox())!;
  const cx = handle.x + handle.width / 2;
  const cy = handle.y + handle.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  const steps = 20;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(cx + ((toX - cx) * s) / steps, cy + 6 + ((toY - cy - 6) * s) / steps);
  }
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  await page.mouse.up();
  // The drop animation (~180ms) removes the overlay when the card lands.
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("an action drags from one arc into another (PROG-118)", async ({ page }) => {
  await page.goto("/outline");
  const { workspaces } = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await post<{ container: Container & { keyPrefix: string } }>(page, "/api/focuses", {
      name: `E2E move arcs ${tag()}`,
      keyPrefix: prefix("Q"),
      workspaceId: workspaces[0].id,
    })
  ).container;
  const src = (
    await post<{ container: Container }>(page, "/api/arcs", {
      name: "Src arc e2e",
      focusId: focus.id,
    })
  ).container;
  const dst = (
    await post<{ container: Container }>(page, "/api/arcs", {
      name: "Dst arc e2e",
      focusId: focus.id,
    })
  ).container;
  const mover = (
    await post<{ action: Action; key: string }>(page, "/api/actions", {
      title: "Mover e2e",
      focusId: focus.id,
      arcId: src.id,
    })
  ).action;
  const anchor = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: "Anchor e2e",
      focusId: focus.id,
      arcId: dst.id,
    })
  ).action;
  const moverKey = `${focus.keyPrefix}-${mover.number}`;
  const anchorKey = `${focus.keyPrefix}-${anchor.number}`;

  await page.goto(`/outline?focus=${focus.id}`);
  await handleOf(page, moverKey).waitFor();

  // Drop Mover just below Anchor's row, inside the Dst arc section.
  const anchorBox = (await handleOf(page, anchorKey).boundingBox())!;
  await dragActionTo(page, moverKey, anchorBox.x + 60, anchorBox.y + anchorBox.height * 0.9);

  // The move is one optimistic PATCH { arcId, rank } — poll the server for it.
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      return ws.actions.find((i: Action) => i.id === mover.id)?.arcId;
    })
    .toBe(dst.id);
  // Anchor stayed put; Mover slotted below it (drop was past its middle).
  expect(
    (await (await page.request.get("/api/snapshot")).json()).actions.find(
      (i: Action) => i.id === anchor.id,
    ).arcId,
  ).toBe(dst.id);

  for (const a of [mover, anchor])
    await page.request.patch(`/api/actions/${a.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});

test("an action drags into another focus and is re-keyed (PROG-118)", async ({ page }) => {
  await page.goto("/outline");
  const workspace = (
    await post<{ container: Container }>(page, "/api/workspaces", {
      name: `E2E move focus ${tag()}`,
    })
  ).container;
  const mkFocus = async (name: string, keyPrefix: string) =>
    (
      await post<{ container: Container & { keyPrefix: string } }>(page, "/api/focuses", {
        name,
        keyPrefix,
        workspaceId: workspace.id,
      })
    ).container;
  const from = await mkFocus("From focus e2e", prefix("F"));
  const to = await mkFocus("To focus e2e", prefix("T"));
  const mover = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: "Migrant e2e",
      focusId: from.id,
    })
  ).action;
  const anchor = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: "Resident e2e",
      focusId: to.id,
    })
  ).action;

  const moverKey = `${from.keyPrefix}-${mover.number}`;
  const anchorKey = `${to.keyPrefix}-${anchor.number}`;

  await page.goto(`/outline?workspace=${workspace.id}`);
  await handleOf(page, moverKey).waitFor();

  // Drop Migrant just below Resident's row, inside the other focus's section.
  const anchorBox = (await handleOf(page, anchorKey).boundingBox())!;
  await dragActionTo(page, moverKey, anchorBox.x + 60, anchorBox.y + anchorBox.height * 0.9);

  // A cross-focus drop is a real move: new focus, re-keyed from the target's
  // sequence (after Resident took number 1), old key retired to an alias.
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      return ws.actions.find((i: Action) => i.id === mover.id)?.focusId;
    })
    .toBe(to.id);
  const ws = await (await page.request.get("/api/snapshot")).json();
  const moved = ws.actions.find((i: Action) => i.id === mover.id) as Action;
  expect(moved.number).toBe(anchor.number + 1);
  expect(
    ws.actionKeyAliases.some(
      (a: { key: string; actionId: string }) =>
        a.key === `${from.keyPrefix}-${mover.number}` && a.actionId === mover.id,
    ),
  ).toBe(true);

  // And the row renders under its NEW key after a full reload.
  await page.reload();
  await handleOf(page, `${to.keyPrefix}-${moved.number}`).waitFor();

  for (const a of [mover, anchor])
    await page.request.patch(`/api/actions/${a.id}`, { data: { status: "canceled" } });
  for (const p of [from, to])
    await page.request.patch(`/api/focuses/${p.id}`, { data: { archived: true } });
  await page.request.patch(`/api/workspaces/${workspace.id}`, { data: { archived: true } });
});
