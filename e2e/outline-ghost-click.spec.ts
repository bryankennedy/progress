import { expect, test, type Page } from "@playwright/test";
import { signInAsOwner } from "./auth";

// PROG-130 regression: after a touch drag on the Outline, iOS Safari fires a
// synthesized click at the RELEASE point — with no pointerdown of its own.
// dnd-kit's click guard only stops propagation, which doesn't cancel an
// anchor's default action, and every outline handle is a real <a href>; when
// the element under the release point is a link the drop didn't move, the
// page navigated away. A same-group reorder is usually safe by accident (the
// dragged row itself lands under the finger, and its handle still holds the
// drag's pointerdown coordinates, so the moved-distance guard fires) — the
// deterministic failing shape is a drop onto an arc SECTION HEADER: the row
// appends at that arc's end while the header, a link to the arc page, stays
// right under the finger and never saw a pointerdown. The fix arms a one-shot
// window-capture click swallower on pointer drag end plus a Handle guard for
// pointer clicks with no recorded pointerdown.

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

const handleOf = (page: Page, name: string) =>
  page.getByRole("button", { name: `Open ${name} — drag to reorder`, exact: true });

test("the post-drop ghost click does not navigate away from the outline (PROG-130)", async ({
  page,
  context,
}) => {
  await signInAsOwner(context);

  await page.goto("/outline");
  const { workspaces } = await (await page.request.get("/api/snapshot")).json();
  const focus = (
    await post<{ container: { id: string; keyPrefix: string } }>(page, "/api/focuses", {
      name: `E2E ghost click ${tag()}`,
      keyPrefix: prefix("G"),
      workspaceId: workspaces[0].id,
    })
  ).container;
  // Target arc sorts FIRST (alphabetical among untouched ranks) so its header
  // stays put while the preview re-homes the dragged row out of the source
  // arc below it.
  const targetArc = (
    await post<{ container: { id: string } }>(page, "/api/arcs", {
      name: "AA ghost target e2e",
      focusId: focus.id,
    })
  ).container;
  const sourceArc = (
    await post<{ container: { id: string } }>(page, "/api/arcs", {
      name: "ZZ ghost source e2e",
      focusId: focus.id,
    })
  ).container;
  const mk = async (title: string, arcId: string) =>
    (
      await post<{ action: { id: string; number: number } }>(page, "/api/actions", {
        title,
        focusId: focus.id,
        arcId,
      })
    ).action;
  const resident = await mk("Ghost resident e2e", targetArc.id);
  const dragged = await mk("Ghost dragged e2e", sourceArc.id);
  const key = (x: { number: number }) => `${focus.keyPrefix}-${x.number}`;

  await page.goto(`/outline?focus=${focus.id}`);
  await handleOf(page, key(dragged)).waitFor();

  // Drag the row from the source arc and RELEASE ON THE TARGET ARC'S HEADER
  // HANDLE: the row appends at that arc's end (PROG-118), the header stays
  // under the release point.
  const from = (await handleOf(page, key(dragged)).boundingBox())!;
  const to = (await handleOf(page, "AA ghost target e2e").boundingBox())!;
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx, fy - 6);
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(1);
  const steps = 15;
  for (let s = 1; s <= steps; s++)
    await page.mouse.move(fx + ((tx - fx) * s) / steps, fy - 6 + ((ty - fy + 6) * s) / steps);
  await page.mouse.up();
  // Let the drop animation land so the hit test sees the settled rows (still
  // well inside the swallower's 400ms window).
  await expect(page.locator("[data-drag-overlay]")).toHaveCount(0, { timeout: 1000 });

  // The ghost: a BARE click at the release point, exactly what iOS
  // synthesizes. It must land on the arc header's link to prove anything.
  const ghost = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x!, y!);
      const target = el?.closest("a") ?? el;
      target?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
      return target instanceof HTMLAnchorElement ? target.getAttribute("href") : target?.tagName;
    },
    [tx, ty],
  );
  expect(ghost).toBe(`/arc/${targetArc.id}`);

  // The drop stuck (the row joined the target arc server-side)…
  await expect
    .poll(async () => {
      const ws = await (await page.request.get("/api/snapshot")).json();
      return ws.actions.find((x: { id: string }) => x.id === dragged.id)?.arcId;
    })
    .toBe(targetArc.id);
  // …and the ghost click did NOT navigate: still on the outline.
  expect(new URL(page.url()).pathname).toBe("/outline");
  await handleOf(page, key(dragged)).waitFor();

  // A REAL tap well after the drop still opens the row's page (the swallower
  // is one-shot and must not eat genuine navigation).
  await page.waitForTimeout(450);
  await handleOf(page, key(resident)).click();
  await expect(page).toHaveURL(new RegExp(`/action/${key(resident)}$`));

  for (const x of [resident, dragged])
    await page.request.patch(`/api/actions/${x.id}`, { data: { status: "canceled" } });
  await page.request.patch(`/api/focuses/${focus.id}`, { data: { archived: true } });
});
