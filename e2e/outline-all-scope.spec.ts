import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// The all-workspaces outline scope (PROG-140, verified under PROG-142) in a real
// browser. `/outline?all=1` renders every active workspace as a sortable section
// → focus sections → arc sections → action rows, all in ONE DndContext. The
// genuinely NEW drags this scope adds — and that no other spec covers — are:
//   1. workspace sections reorder among themselves;
//   2. a focus section dragged into ANOTHER workspace re-parents (PATCH
//      workspaceId), optimistically and durably;
//   3. an action dragged into a focus in a DIFFERENT workspace still moves
//      (re-key + alias), the cross-focus move spanning workspaces;
//   4. an arc dropped outside its focus deliberately does NOT move (PROG-140).
// The within-focus action reorder / cross-arc drag / step-carry paths are the
// SAME shared component (FocusOutline) proven by outline-move / outline-container
// -reorder at focus/workspace scope, so they aren't re-proven here.
//
// Each test builds its OWN workspaces (a shared unique name prefix so the two
// sort adjacent among the ambient tree), then archives them again. The all scope
// shows the whole dev DB, so drags scroll their small pair into view first and
// target it by bounding box.

const tag = () => Math.random().toString(36).slice(2, 8);
const prefix = (lead: string) =>
  `${lead}${tag()
    .toUpperCase()
    .replaceAll(/[^A-Z]/g, "Z")
    .padEnd(4, "X")
    .slice(0, 4)}`;

type Container = { id: string; keyPrefix?: string };
type Action = { id: string; number: number; focusId: string };

async function post<T>(page: Page, path: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(path, { data });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

async function snapshot(page: Page): Promise<{
  workspaces: Container[];
  focuses: (Container & { workspaceId: string })[];
  actions: Action[];
  actionKeyAliases: { key: string; actionId: string }[];
}> {
  return (await (await page.request.get("/api/snapshot")).json()) as never;
}

// Center a section by its header link so its small pair sits inside the viewport
// even though the all scope is a tall page.
async function center(page: Page, name: string) {
  await page
    .getByRole("link", { name, exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
}

// y-order of the given header links, top → bottom.
async function yOrder(page: Page, names: string[]): Promise<string[]> {
  const boxes = await Promise.all(
    names.map(async (name) => ({
      name,
      y: (await page.getByRole("link", { name, exact: true }).boundingBox())!.y,
    })),
  );
  return boxes.sort((a, b) => a.y - b.y).map((b) => b.name);
}

// Press a section's bullet handle (an <a> dnd-kit exposes as role=button, named
// "Open <name> — drag to reorder"), clear the 4px activation threshold, glide to
// the target point in small steps so dnd-kit tracks it, release. The floating
// DragOverlay must appear on pickup and clear on drop.
async function dragGrip(page: Page, name: string, toX: number, toY: number) {
  const grip = (await page
    .getByRole("button", { name: `Open ${name} — drag to reorder`, exact: true })
    .boundingBox())!;
  const cx = grip.x + grip.width / 2;
  const cy = grip.y + grip.height / 2;
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
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });
}

test.beforeEach(async ({ context }) => {
  await signInAsOwner(context);
});

test("workspace sections drag-reorder at all scope and it survives reload (PROG-140)", async ({
  page,
}) => {
  await page.goto("/outline?all=1");
  const stem = `zq${tag()}`;
  const wsA = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} A ws` })
  ).container;
  const wsB = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} B ws` })
  ).container;
  // A focus in each so the section has a stable header link to locate.
  const focusA = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} A focus`,
      keyPrefix: prefix("A"),
      workspaceId: wsA.id,
    })
  ).container;
  const focusB = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} B focus`,
      keyPrefix: prefix("B"),
      workspaceId: wsB.id,
    })
  ).container;

  const nameA = `${stem} A ws`;
  const nameB = `${stem} B ws`;
  await page.reload();
  await page.getByRole("link", { name: nameA, exact: true }).waitFor();

  // Tied ranks → alphabetical: A above B.
  await center(page, nameA);
  expect(await yOrder(page, [nameA, nameB])).toEqual([nameA, nameB]);

  // Drag B's workspace grip above A's header.
  const aBox = (await page.getByRole("link", { name: nameA, exact: true }).boundingBox())!;
  await dragGrip(page, nameB, aBox.x, aBox.y - 8);

  await expect.poll(() => yOrder(page, [nameA, nameB])).toEqual([nameB, nameA]);

  // Server-side ranks → survives reload.
  await page.reload();
  await page.getByRole("link", { name: nameB, exact: true }).waitFor();
  await center(page, nameB);
  expect(await yOrder(page, [nameA, nameB])).toEqual([nameB, nameA]);

  for (const f of [focusA, focusB])
    await page.request.patch(`/api/focuses/${f.id}`, { data: { archived: true } });
  for (const w of [wsA, wsB])
    await page.request.patch(`/api/workspaces/${w.id}`, { data: { archived: true } });
});

test("a focus section drags into another workspace and re-parents (PROG-140)", async ({ page }) => {
  await page.goto("/outline?all=1");
  const stem = `zq${tag()}`;
  const wsA = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} A ws` })
  ).container;
  const wsB = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} B ws` })
  ).container;
  const focusA = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} mover focus`,
      keyPrefix: prefix("M"),
      workspaceId: wsA.id,
    })
  ).container;
  // A resident focus in B gives a concrete in-workspace drop target.
  const resident = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} resident focus`,
      keyPrefix: prefix("R"),
      workspaceId: wsB.id,
    })
  ).container;

  const moverName = `${stem} mover focus`;
  const residentName = `${stem} resident focus`;
  await page.reload();
  await page.getByRole("link", { name: moverName, exact: true }).waitFor();
  await center(page, moverName);

  // Drop the mover focus onto the resident focus (inside workspace B).
  const resBox = (await page.getByRole("link", { name: residentName, exact: true }).boundingBox())!;
  await dragGrip(page, moverName, resBox.x, resBox.y + resBox.height * 0.9);

  // Durable: PATCH workspaceId persisted — the mover focus now lives under B.
  await expect
    .poll(async () => (await snapshot(page)).focuses.find((f) => f.id === focusA.id)?.workspaceId)
    .toBe(wsB.id);

  // Survives a full reload (renders inside B's block, adjacent to the resident).
  await page.reload();
  await page.getByRole("link", { name: moverName, exact: true }).waitFor();
  await center(page, residentName);
  const order = await yOrder(page, [residentName, moverName]);
  expect(order).toContain(moverName);
  expect(order).toContain(residentName);

  for (const f of [focusA, resident])
    await page.request.patch(`/api/focuses/${f.id}`, { data: { archived: true } });
  for (const w of [wsA, wsB])
    await page.request.patch(`/api/workspaces/${w.id}`, { data: { archived: true } });
});

test("dragging a parent action carries its steps and a same-group drop keeps them (PROG-140)", async ({
  page,
}) => {
  await page.goto("/outline?all=1");
  const stem = `zq${tag()}`;
  const ws = (await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} ws` }))
    .container;
  const focus = (
    await post<{ container: Container & { keyPrefix: string } }>(page, "/api/focuses", {
      name: `${stem} steps focus`,
      keyPrefix: prefix("S"),
      workspaceId: ws.id,
    })
  ).container;
  // A parent action with a child step, plus a sibling to reorder against.
  const parent = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: `${stem} parent`,
      focusId: focus.id,
    })
  ).action;
  const step = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: `${stem} child step`,
      focusId: focus.id,
      parentActionId: parent.id,
    })
  ).action;
  const sibling = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: `${stem} sibling`,
      focusId: focus.id,
    })
  ).action;
  const parentKey = `${focus.keyPrefix}-${parent.number}`;
  const siblingKey = `${focus.keyPrefix}-${sibling.number}`;

  await page.reload();
  const parentHandle = page.getByRole("button", {
    name: `Open ${parentKey} — drag to reorder`,
    exact: true,
  });
  await parentHandle.waitFor();
  await center(page, `${stem} steps focus`);

  // Press the parent's handle and glide below the sibling (same sibling group).
  const sibBox = (await page
    .getByRole("button", { name: `Open ${siblingKey} — drag to reorder`, exact: true })
    .boundingBox())!;
  const grip = (await parentHandle.boundingBox())!;
  const cx = grip.x + grip.width / 2;
  const cy = grip.y + grip.height / 2;
  const tx = sibBox.x + sibBox.width / 2;
  const ty = sibBox.y + sibBox.height * 0.9;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  // The overlay carries the subtree: the child step's title rides along.
  await expect(page.locator("[data-drag-overlay]")).toContainText(`${stem} child step`);
  for (let s = 1; s <= 20; s++) {
    await page.mouse.move(cx + ((tx - cx) * s) / 20, cy + 6 + ((ty - cy - 6) * s) / 20);
  }
  await page.mouse.up();
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });

  // Same-focus reorder: the step stays a child of its parent, in the same focus —
  // the subtree moved as one block, nothing detached.
  await page.waitForTimeout(300);
  const snap = await snapshot(page);
  const movedStep = snap.actions.find((a) => a.id === step.id) as Action & {
    parentActionId: string | null;
  };
  expect(movedStep.parentActionId).toBe(parent.id);
  expect(movedStep.focusId).toBe(focus.id);

  for (const a of [step, parent, sibling])
    await page.request.patch(`/api/actions/${a.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
  await page.request.patch(`/api/workspaces/${ws.id}`, { data: { archived: true } });
});

test("an action drags into a focus in another workspace and is re-keyed (PROG-140)", async ({
  page,
}) => {
  await page.goto("/outline?all=1");
  const stem = `zq${tag()}`;
  const wsA = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} A ws` })
  ).container;
  const wsB = (
    await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} B ws` })
  ).container;
  const from = (
    await post<{ container: Container & { keyPrefix: string } }>(page, "/api/focuses", {
      name: `${stem} from focus`,
      keyPrefix: prefix("F"),
      workspaceId: wsA.id,
    })
  ).container;
  const to = (
    await post<{ container: Container & { keyPrefix: string } }>(page, "/api/focuses", {
      name: `${stem} to focus`,
      keyPrefix: prefix("T"),
      workspaceId: wsB.id,
    })
  ).container;
  const mover = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: `${stem} migrant`,
      focusId: from.id,
    })
  ).action;
  const anchor = (
    await post<{ action: Action }>(page, "/api/actions", {
      title: `${stem} resident`,
      focusId: to.id,
    })
  ).action;
  const moverKey = `${from.keyPrefix}-${mover.number}`;
  const anchorKey = `${to.keyPrefix}-${anchor.number}`;

  await page.reload();
  const moverHandle = page.getByRole("button", {
    name: `Open ${moverKey} — drag to reorder`,
    exact: true,
  });
  await moverHandle.waitFor();
  await center(page, `${stem} from focus`);

  // Press the mover row's handle, glide onto the resident row in workspace B.
  const anchorHandle = (await page
    .getByRole("button", { name: `Open ${anchorKey} — drag to reorder`, exact: true })
    .boundingBox())!;
  const grip = (await moverHandle.boundingBox())!;
  const cx = grip.x + grip.width / 2;
  const cy = grip.y + grip.height / 2;
  const tx = anchorHandle.x + 60;
  const ty = anchorHandle.y + anchorHandle.height * 0.9;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  for (let s = 1; s <= 20; s++) {
    await page.mouse.move(cx + ((tx - cx) * s) / 20, cy + 6 + ((ty - cy - 6) * s) / 20);
  }
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });

  // Cross-focus (and cross-workspace) drop = a real move: new focus, re-keyed,
  // old key retired to an alias.
  await expect
    .poll(async () => (await snapshot(page)).actions.find((a) => a.id === mover.id)?.focusId)
    .toBe(to.id);
  const snap = await snapshot(page);
  expect(snap.actionKeyAliases.some((a) => a.key === moverKey && a.actionId === mover.id)).toBe(
    true,
  );

  for (const a of [mover, anchor])
    await page.request.patch(`/api/actions/${a.id}`, { data: { status: "canceled" } });
  for (const f of [from, to])
    await page.request.patch(`/api/focuses/${f.id}`, { data: { archived: true } });
  for (const w of [wsA, wsB])
    await page.request.patch(`/api/workspaces/${w.id}`, { data: { archived: true } });
});

test("an arc dropped outside its focus stays put (PROG-140, deliberate)", async ({ page }) => {
  await page.goto("/outline?all=1");
  const stem = `zq${tag()}`;
  const ws = (await post<{ container: Container }>(page, "/api/workspaces", { name: `${stem} ws` }))
    .container;
  const focusA = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} A focus`,
      keyPrefix: prefix("A"),
      workspaceId: ws.id,
    })
  ).container;
  const focusB = (
    await post<{ container: Container }>(page, "/api/focuses", {
      name: `${stem} B focus`,
      keyPrefix: prefix("B"),
      workspaceId: ws.id,
    })
  ).container;
  const arc = (
    await post<{ container: Container }>(page, "/api/arcs", {
      name: `${stem} lonely arc`,
      focusId: focusA.id,
    })
  ).container;
  // A resident arc in focus B, the (forbidden) drop target.
  await post(page, "/api/arcs", { name: `${stem} B arc`, focusId: focusB.id });

  const arcName = `${stem} lonely arc`;
  const targetName = `${stem} B arc`;
  await page.reload();
  await page.getByRole("link", { name: arcName, exact: true }).waitFor();
  await center(page, `${stem} A focus`);

  const targetBox = (await page
    .getByRole("link", { name: targetName, exact: true })
    .boundingBox())!;
  await dragGrip(page, arcName, targetBox.x, targetBox.y + targetBox.height * 0.9);

  // The arc must remain in focus A — cross-focus arc moves are not supported.
  await page.waitForTimeout(300);
  const snap = await snapshot(page);
  const stillThere = (snap as unknown as { arcs: (Container & { focusId: string })[] }).arcs.find(
    (a) => a.id === arc.id,
  );
  expect(stillThere?.focusId).toBe(focusA.id);

  for (const f of [focusA, focusB])
    await page.request.patch(`/api/focuses/${f.id}`, { data: { archived: true } });
  await page.request.patch(`/api/workspaces/${ws.id}`, { data: { archived: true } });
});
