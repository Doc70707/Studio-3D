import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const menu = (page: Page) => page.getByRole("menu", { name: "Right-click menu" });
const snapItem = (page: Page, label: string) => menu(page).getByRole("menuitemradio", { name: label, exact: true });
const marker = (page: Page) => page.getByTestId("snap3d");

// The 3D tests sweep the pointer across the view looking for snaps, which takes a while on a busy machine.
test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

// ---------- Sketch ----------

const canvas = (page: Page) => page.getByTestId("sketch-canvas");
/** Where a sketch point (mm) is on screen, once the drawing has stopped moving. */
async function at(page: Page, u: number, v: number): Promise<[number, number]> {
  const c = canvas(page);
  let last = "";
  await expect
    .poll(
      async () => {
        const now = `${JSON.stringify(await c.boundingBox())} ${await c.getAttribute("data-origin")} ${await c.getAttribute("data-scale")}`;
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const box = (await c.boundingBox())!;
  const k = Number(await c.getAttribute("data-scale"));
  const [ox, oy] = (await c.getAttribute("data-origin"))!.split(",").map(Number) as [number, number];
  return [box.x + ox + u * k, box.y + oy - v * k];
}
const clickAt = async (page: Page, u: number, v: number) => page.mouse.click(...(await at(page, u, v)));
const rightClickAt = async (page: Page, u: number, v: number) =>
  page.mouse.click(...(await at(page, u, v)), { button: "right" });

test("sketch: right-click offers the snaps that fit the spot, and one picked is used for the next point", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await clickAt(page, 0, 0);
  await clickAt(page, 40, 20);
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Outline tool" }).click();

  // Right-click near the bottom side: a menu at the pointer, inside the drawing, naming what is there.
  await rightClickAt(page, 20.3, 0.5);
  await expect(menu(page)).toBeVisible();
  await expect(page.getByTestId("context-title")).toContainText("Side");
  const m = (await menu(page).boundingBox())!;
  const c = (await canvas(page).boundingBox())!;
  expect(m.x).toBeGreaterThanOrEqual(c.x);
  expect(m.y + m.height).toBeLessThanOrEqual(c.y + c.height + 1);
  // Middle is there to pick; tangent needs a first corner and a circle, so it is greyed out with the reason.
  await expect(snapItem(page, "Middle")).not.toHaveAttribute("aria-disabled");
  await expect(snapItem(page, "Tangent")).toHaveAttribute("aria-disabled", "true");
  await expect(snapItem(page, "Tangent")).toHaveAttribute("title", /last corner/);
  await page.screenshot({ path: `${OUT}context-menu-sketch.png` });
  await snapItem(page, "Middle").click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByText("Next point snaps to Middle")).toBeVisible();

  // The picked snap reaches further than usual: 4 mm away still lands on the middle, exactly.
  await page.mouse.move(...(await at(page, 17, 3)), { steps: 3 });
  await expect(page.getByTestId("snap")).toHaveAttribute("data-snap", "middle");
  await page.mouse.click(...(await at(page, 17, 3)));
  await page.mouse.move(...(await at(page, 30, 30)), { steps: 3 });
  // From that first corner (20, 0), the side drawn ends at the pointer; the picked snap was used once only.
  await expect(page.getByText("Next point snaps to Middle")).toHaveCount(0);

  // Snaps kept on can be changed from the menu, and are remembered.
  await rightClickAt(page, 30, 30);
  await menu(page).getByRole("checkbox", { name: "Keep End on" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("studio3d.snaps") ?? "{}"));
  expect(saved.kinds).not.toContain("end");
  expect(saved.kinds).toContain("middle");
});

test("sketch: a right drag still slides the drawing and opens no menu", async ({ page }) => {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  const [x, y] = await at(page, 0, 0);
  const before = await canvas(page).getAttribute("data-origin");
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 80, y + 40, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect(canvas(page)).not.toHaveAttribute("data-origin", before!);
  await expect(menu(page)).toHaveCount(0);
});

// ---------- 3D view ----------

/** The part of the 3D view the bars and palettes leave open. */
async function openArea(page: Page) {
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const a = { x0: view.x + left, x1: view.x + view.width - right, y0: view.y + top, y1: view.y + view.height - bottom };
  return { ...a, cx: (a.x0 + a.x1) / 2, cy: (a.y0 + a.y1) / 2 };
}
/** A solid 60 x 40 x 30 block, seen straight down without perspective. */
async function topView(page: Page) {
  const wall = page.getByLabel("Wall thickness", { exact: true });
  await wall.fill("0");
  await wall.blur(); // so the view keys reach the view, not the box
  await current(page);
  await page.keyboard.press("1");
  await page.keyboard.press("5");
  await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");
}

/** Moves the pointer along a line and returns the first snap of a kind it shows: where it is drawn and its 3D point. */
async function findSnap(page: Page, kind: string, from: [number, number], to: [number, number], steps: number) {
  for (let i = 0; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps;
    const y = from[1] + ((to[1] - from[1]) * i) / steps;
    await page.mouse.move(x, y);
    // Let the app draw the marker for this spot before looking (it can lag a frame when the machine is busy).
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = marker(page);
    if ((await m.count()) && (await m.getAttribute("data-snap")) === kind) {
      const b = (await m.boundingBox())!;
      const point = (await m.getAttribute("data-point"))!.split(",").map(Number);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, point };
    }
  }
  throw new Error(`no ${kind} snap between ${from} and ${to}`);
}

test("3D: Measure snaps to the part's real corners and gives the exact distance", async ({ page }) => {
  // Hundreds of small pointer moves, each drawn by software graphics: slow on a busy test machine.
  test.setTimeout(240_000);
  // Looking straight down, without perspective: the block's top is a 60 x 40 rectangle on screen.
  await topView(page);
  await page.getByRole("tab", { name: "View" }).click();
  await page.getByRole("button", { name: "Measure distance" }).click();
  await expect(page.getByTestId("measure-bar")).toContainText("Click the first point");

  const v = await openArea(page);
  // Across the middle of the view: the left side's middle.
  const left = await findSnap(page, "middle", [v.x0 + 10, v.cy], [v.cx, v.cy], 80);
  expect(left.point).toEqual([-30, 0, 30]);
  // Up the left side from its middle: its far end, the back-left corner.
  const corner = await findSnap(page, "end", [left.x, left.y], [left.x, v.y0 + 10], 80);
  expect(corner.point).toEqual([-30, 20, 30]);
  await page.mouse.click(corner.x + 3, corner.y + 3);
  await expect(page.getByTestId("measure-bar")).toContainText("Click the second point");
  // Across the back to the other corner.
  const right = await findSnap(page, "end", [corner.x + 40, corner.y], [v.x1 - 10, corner.y], 160);
  expect(right.point).toEqual([30, 20, 30]);
  await page.mouse.click(right.x - 3, right.y + 3);
  await expect(page.getByTestId("measure-result")).toContainText("60 mm");
  await expect(page.getByTestId("measure-result")).toContainText("left/right 60 mm · front/back 0 mm · up 0 mm");
  await page.screenshot({ path: `${OUT}measure-snap.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("measure-bar")).toHaveCount(0);
});

test("3D: right-click names what is under the pointer and offers the snaps that fit it", async ({ page }) => {
  await topView(page);
  await page.getByRole("tab", { name: "View" }).click();
  await page.getByRole("button", { name: "Measure distance" }).click();
  const v = await openArea(page);
  const left = await findSnap(page, "middle", [v.x0 + 10, v.cy], [v.cx, v.cy], 80);
  await page.keyboard.press("Escape");

  await page.mouse.click(left.x, left.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(page.getByTestId("context-title")).toContainText("Edge, 40 mm long");
  await expect(snapItem(page, "Middle")).not.toHaveAttribute("aria-disabled");
  // Snaps that only mean something in a sketch aren't offered on a solid; ones with nothing near are greyed out.
  await expect(snapItem(page, "Crossing")).toHaveCount(0);
  await expect(snapItem(page, "Tangent")).toHaveCount(0);
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(8);
  await expect(snapItem(page, "Square to")).toHaveAttribute("aria-disabled", "true");
  // A plain block has no circles: nothing for Centre or Quadrant.
  await expect(snapItem(page, "Centre")).toHaveAttribute("aria-disabled", "true");
  await expect(snapItem(page, "Quadrant")).toHaveAttribute("aria-disabled", "true");
  await expect(snapItem(page, "Square to")).toHaveAttribute("title", /first point/);
  await page.screenshot({ path: `${OUT}context-menu-3d.png` });
  // Picking Middle starts measuring with it for the first point: 25 px off still lands on the side's middle.
  await snapItem(page, "Middle").click();
  await expect(page.getByTestId("measure-bar")).toContainText("Next point snaps to Middle");
  await page.mouse.move(left.x + 20, left.y + 15, { steps: 3 });
  await expect(marker(page)).toHaveAttribute("data-point", "-30,0,30");
  await page.mouse.click(left.x + 20, left.y + 15);
  await expect(page.getByTestId("measure-bar")).toContainText("Click the second point");
});

test("3D: a right drag still pans and opens no menu; a right click on empty space offers Measure from here", async ({
  page,
}) => {
  const v = await openArea(page);
  const target = await host(page).getAttribute("data-camera-target");
  await page.mouse.move(v.cx, v.cy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(v.cx + 100, v.cy + 60, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await expect(host(page)).not.toHaveAttribute("data-camera-target", target!);
  await expect(menu(page)).toHaveCount(0);

  await page.mouse.click(v.x0 + 30, v.y1 - 30, { button: "right" });
  await expect(page.getByTestId("context-title")).toHaveText("Empty space");
  await menu(page).getByRole("menuitem", { name: "Measure from here" }).click();
  await expect(page.getByTestId("measure-bar")).toContainText("Click the second point");
});
