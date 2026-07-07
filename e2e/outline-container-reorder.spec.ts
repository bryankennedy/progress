import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// Container drag-to-reorder on the Outline (PROG-87), in a real browser —
// pointer events can't be unit-tested. The tie-aware rank math (first drag in
// an all-default group renumbers it, later drags are one write) lives in
// src/client/containerReorder.test.ts; these prove the end-to-end wiring: the
// alphabetical default, the grip drag, and that the new order is global —
// i.e. it survives a reload because it's stored server-side.
//
// Each test creates its OWN containers via the API (unique names/prefix), so
// it is independent of the ambient dev DB and of the other specs; it archives
// them again at the end to keep the ambient views clean.

const tag = () => Math.random().toString(36).slice(2, 8);

async function apiJson<T>(page: Page, path: string): Promise<T> {
  return (await (await page.request.get(path)).json()) as T;
}

// y-order of elements matching the given locator texts, top → bottom.
async function yOrder(page: Page, names: string[]): Promise<string[]> {
  const boxes = await Promise.all(
    names.map(async (name) => ({
      name,
      y: (await page.getByRole("link", { name, exact: true }).boundingBox())!.y,
    })),
  );
  return boxes.sort((a, b) => a.y - b.y).map((b) => b.name);
}

// Press a grip and clear the 4px drag-activation threshold, glide to the
// target y in small steps so dnd-kit tracks it, release. Mid-drag, the held
// section must be carried by a floating DragOverlay preview (the board's
// pattern — instant pickup + depth) and it must clear on release.
async function dragGrip(page: Page, gripLabel: string, toY: number) {
  const grip = (await page.getByRole("button", { name: gripLabel }).boundingBox())!;
  const cx = grip.x + grip.width / 2;
  const cy = grip.y + grip.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  const steps = 18;
  for (let s = 1; s <= steps; s++) {
    await page.mouse.move(cx, cy + 6 + ((toY - cy - 6) * s) / steps);
  }
  await page.mouse.up();
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 250 });
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("arcs list alphabetically by default and drag-reorder within a focus (PROG-87)", async ({
  page,
}) => {
  // A fresh focus with three arcs, created in non-alphabetical order — the
  // outline must still show them alphabetically (all ranks tie at the default).
  await page.goto("/outline");
  const workspaces = (await apiJson<{ workspaces: { id: string }[] }>(page, "/api/snapshot"))
    .workspaces;
  const prefix = `Q${tag().toUpperCase().replaceAll(/[^A-Z]/g, "Z").padEnd(4, "X").slice(0, 4)}`;
  const focus = (
    await (
      await page.request.post("/api/focuses", {
        data: { name: `E2E arcs ${tag()}`, keyPrefix: prefix, workspaceId: workspaces[0]!.id },
      })
    ).json()
  ).container as { id: string };
  const mk = async (name: string) =>
    (
      await (
        await page.request.post("/api/arcs", { data: { name, focusId: focus.id } })
      ).json()
    ).container as { id: string };
  const gamma = await mk("Gamma e2e");
  const alpha = await mk("Alpha e2e");
  const beta = await mk("Beta e2e");

  await page.goto(`/outline?focus=${focus.id}`);
  await page.getByRole("link", { name: "Gamma e2e", exact: true }).waitFor();

  // Default order: alphabetical, not creation order.
  expect(await yOrder(page, ["Alpha e2e", "Beta e2e", "Gamma e2e"])).toEqual([
    "Alpha e2e",
    "Beta e2e",
    "Gamma e2e",
  ]);

  // Drag Gamma's section above Alpha's header.
  const alphaBox = (await page.getByRole("link", { name: "Alpha e2e", exact: true }).boundingBox())!;
  await dragGrip(page, "Reorder Gamma e2e", alphaBox.y - 10);

  await expect
    .poll(() => yOrder(page, ["Alpha e2e", "Beta e2e", "Gamma e2e"]))
    .toEqual(["Gamma e2e", "Alpha e2e", "Beta e2e"]);

  // The order is global (server-side ranks), so it survives a reload.
  await page.reload();
  await page.getByRole("link", { name: "Gamma e2e", exact: true }).waitFor();
  expect(await yOrder(page, ["Alpha e2e", "Beta e2e", "Gamma e2e"])).toEqual([
    "Gamma e2e",
    "Alpha e2e",
    "Beta e2e",
  ]);

  // The first drag in a tied group renumbers it: ranks are now distinct.
  const ws = await apiJson<{ arcs: { id: string; rank: string }[] }>(page, "/api/snapshot");
  const ranks = [gamma.id, alpha.id, beta.id].map(
    (id) => ws.arcs.find((a) => a.id === id)!.rank,
  );
  expect(new Set(ranks).size).toBe(3);
  expect(ranks[0]! < ranks[1]! && ranks[1]! < ranks[2]!).toBe(true);

  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});

test("focuses drag-reorder at workspace scope (PROG-87)", async ({ page }) => {
  await page.goto("/outline");
  const workspace = (
    await (
      await page.request.post("/api/workspaces", { data: { name: `E2E workspace ${tag()}` } })
    ).json()
  ).container as { id: string };
  const mk = async (name: string) =>
    (
      await (
        await page.request.post("/api/focuses", {
          data: {
            name,
            workspaceId: workspace.id,
            keyPrefix: `P${tag().toUpperCase().replaceAll(/[^A-Z]/g, "Z").padEnd(4, "Y").slice(0, 4)}`,
          },
        })
      ).json()
    ).container as { id: string };
  const cherry = await mk("Cherry e2e");
  const apple = await mk("Apple e2e");

  await page.goto(`/outline?workspace=${workspace.id}`);
  await page.getByRole("link", { name: "Cherry e2e", exact: true }).waitFor();

  // Alphabetical while ranks tie.
  expect(await yOrder(page, ["Apple e2e", "Cherry e2e"])).toEqual(["Apple e2e", "Cherry e2e"]);

  // Drag the Cherry section above the Apple section.
  const appleBox = (await page.getByRole("link", { name: "Apple e2e", exact: true }).boundingBox())!;
  await dragGrip(page, "Reorder Cherry e2e", appleBox.y - 20);

  await expect
    .poll(() => yOrder(page, ["Apple e2e", "Cherry e2e"]))
    .toEqual(["Cherry e2e", "Apple e2e"]);

  await page.reload();
  await page.getByRole("link", { name: "Cherry e2e", exact: true }).waitFor();
  expect(await yOrder(page, ["Apple e2e", "Cherry e2e"])).toEqual(["Cherry e2e", "Apple e2e"]);

  for (const p of [cherry, apple])
    await page.request.patch(`/api/focuses/${p.id}`, { data: { archived: true } });
  await page.request.patch(`/api/workspaces/${workspace.id}`, { data: { archived: true } });
});

test("the scope picker is sticky — a bare /outline reopens the last scope", async ({ page }) => {
  await page.goto("/outline");
  const workspace = (
    await (
      await page.request.post("/api/workspaces", { data: { name: `E2E sticky ${tag()}` } })
    ).json()
  ).container as { id: string };

  // Visit the workspace scope via URL (the shareable-link path)…
  await page.goto(`/outline?workspace=${workspace.id}`);
  const scope = page.locator("select");
  await expect(scope).toHaveValue(`workspace:${workspace.id}`);

  // …leave for another view, come back with NO params: the scope must stick.
  await page.goto("/structure");
  await page.goto("/outline");
  await expect(scope).toHaveValue(`workspace:${workspace.id}`);

  await page.request.patch(`/api/workspaces/${workspace.id}`, { data: { archived: true } });
});
