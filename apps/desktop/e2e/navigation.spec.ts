import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const numbers = async (page: Page, attr: string) =>
  ((await host(page).getAttribute(attr)) ?? "").split(",").map(Number);
const cameraPos = (page: Page) => numbers(page, "data-camera-position");
const cameraTarget = (page: Page) => numbers(page, "data-camera-target");
const zoom = async (page: Page) => Number(await host(page).getAttribute("data-camera-zoom"));
const projection = (page: Page) => host(page).getAttribute("data-camera-projection");
const orbitRadius = async (page: Page) => {
  const [p, t] = [await cameraPos(page), await cameraTarget(page)];
  return Math.hypot(...p.map((v, i) => v - (t[i] ?? 0)));
};
const orthoButton = (page: Page) => page.getByRole("button", { name: "Orthographic", exact: true });
const canvas = (page: Page) => page.getByTestId("sketch-canvas");
const profiles = (page: Page) => page.getByTestId("sketch-profile");

/** How far apart the size labels are on screen: a stand-in for how big the part looks. */
async function labelSpread(page: Page): Promise<number> {
  const boxes = await Promise.all((await page.getByTestId("dimension").all()).map((l) => l.boundingBox()));
  const xs = boxes.map((b) => b!.x + b!.width / 2);
  const ys = boxes.map((b) => b!.y + b!.height / 2);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** Drags from the middle of an element with a mouse button, optionally holding Shift. */
async function drag(page: Page, testId: string, button: "middle" | "right", by: [number, number], shift = false) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.down({ button });
  await page.mouse.move(x + by[0], y + by[1], { steps: 5 });
  await page.mouse.up({ button });
  if (shift) await page.keyboard.up("Shift");
  // The view publishes its camera after drawing the next frame; wait for it so the next read isn't one frame old.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await expect(host(page)).toHaveAttribute("data-camera-projection", "perspective");
});

test("the Ortho button and key 5 switch to a true orthographic view that keeps the view and the part's size", async ({
  page,
}) => {
  for (const [view, viewName] of [
    ["Top", "top"],
    ["Front", "front"],
    ["3D", "iso"],
  ] as const) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(host(page)).toHaveAttribute("data-camera-view", viewName);
    await expect.poll(() => labelSpread(page)).toBeGreaterThan(0);
    const before = await labelSpread(page);
    await orthoButton(page).click();
    await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");
    await expect(orthoButton(page)).toHaveAttribute("aria-pressed", "true");
    // Same view, same target, and the part looks about the same size (perspective makes near parts bigger).
    await expect(host(page)).toHaveAttribute("data-camera-view", viewName);
    await expect.poll(() => labelSpread(page)).toBeGreaterThan(before * 0.8);
    expect(await labelSpread(page)).toBeLessThan(before * 1.25);
    if (view === "Front") await page.screenshot({ path: `${OUT}ortho-front.png` });
    await page.keyboard.press("5");
    await expect(host(page)).toHaveAttribute("data-camera-projection", "perspective");
    await expect(host(page)).toHaveAttribute("data-camera-view", viewName);
  }
});

test("the View menu has all six sides, iso and the orthographic switch; Shift+number looks from the other side", async ({
  page,
}) => {
  await page.getByRole("menuitem", { name: "View" }).click();
  for (const name of ["3D view", "Top view", "Front view", "Right view", "Bottom view", "Back view", "Left view"])
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  await page.getByRole("menuitemcheckbox", { name: "Orthographic (no perspective)" }).click();
  await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");

  for (const [key, view, axis, sign] of [
    ["Shift+1", "bottom", 2, -1],
    ["Shift+2", "back", 1, 1],
    ["Shift+3", "left", 0, -1],
    ["1", "top", 2, 1],
  ] as const) {
    await page.keyboard.press(key);
    await expect(host(page)).toHaveAttribute("data-camera-view", view);
    const [p, t] = [await cameraPos(page), await cameraTarget(page)];
    expect(Math.sign(p[axis]! - t[axis]!)).toBe(sign);
  }
  // Changing views doesn't drop back to perspective.
  await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");
});

test("orthographic: scrolling zooms without moving the camera, and perspective picks up the same zoom", async ({
  page,
}) => {
  await orthoButton(page).click();
  const radius = await orbitRadius(page);
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => zoom(page)).toBeGreaterThan(1.3);
  const z = await zoom(page);
  expect(await orbitRadius(page)).toBeCloseTo(radius, 0);
  await orthoButton(page).click();
  await expect(host(page)).toHaveAttribute("data-camera-projection", "perspective");
  expect(await zoom(page)).toBe(1);
  // Coming back to perspective moves in by the zoom, so the part stays the same size.
  expect((await orbitRadius(page)) / (radius / z)).toBeCloseTo(1, 1);
  // A standard view frames the part again, at zoom 1.
  await orthoButton(page).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => zoom(page)).toBeGreaterThan(1.1);
  await page.keyboard.press("0");
  await expect.poll(() => zoom(page)).toBe(1);
});

test("orthographic: wheel-drag pans, Shift + wheel-drag orbits, and neither changes the projection", async ({
  page,
}) => {
  await orthoButton(page).click();
  const [pos, target, radius] = [await cameraPos(page), await cameraTarget(page), await orbitRadius(page)];
  await drag(page, "viewport-canvas", "middle", [150, 40]);
  const [pos2, target2] = [await cameraPos(page), await cameraTarget(page)];
  expect(target2).not.toEqual(target);
  pos.forEach((v, i) => expect(pos2[i]! - v).toBeCloseTo(target2[i]! - target[i]!, 1));
  expect(await orbitRadius(page)).toBeCloseTo(radius, 1);

  await drag(page, "viewport-canvas", "middle", [150, 40], true);
  (await cameraTarget(page)).forEach((v, i) => expect(v).toBeCloseTo(target2[i]!, 3));
  expect(await cameraPos(page)).not.toEqual(pos2);
  expect(await orbitRadius(page)).toBeCloseTo(radius, 0);
  expect(await projection(page)).toBe("orthographic");
});

test("sketch: wheel-drag, Shift + wheel-drag and right-drag only slide the drawing; nothing is drawn or turned", async ({
  page,
}) => {
  test.slow(); // many drags, each redrawing the sketch: slow when several browsers share the machine
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
  const camera3d = [await cameraPos(page), await cameraTarget(page)];
  const scale = await canvas(page).getAttribute("data-scale");
  const origin = async () => (await canvas(page).getAttribute("data-origin"))!.split(",").map(Number);

  let [ox, oy] = await origin();
  for (const [button, shift, by] of [
    ["middle", false, [120, 30]],
    ["middle", true, [-60, 80]],
    ["right", false, [40, -50]],
  ] as const) {
    await drag(page, "sketch-canvas", button, [by[0], by[1]], shift);
    const [nx, ny] = await origin();
    // The drawing moved exactly with the mouse: a pure slide in the sketch's plane, no turn and no zoom.
    expect(nx! - ox!).toBeCloseTo(by[0], -0.5);
    expect(ny! - oy!).toBeCloseTo(by[1], -0.5);
    await expect(canvas(page)).toHaveAttribute("data-scale", scale!);
    [ox, oy] = [nx, ny];
  }
  await expect(profiles(page)).toHaveCount(0);
  // The 3D camera behind the drawing didn't move either.
  expect([await cameraPos(page), await cameraTarget(page)]).toEqual(camera3d);

  // Scrolling zooms the drawing; double-clicking the wheel fits it again.
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(canvas(page)).not.toHaveAttribute("data-scale", scale!);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, {
    button: "middle",
  });
  await expect(canvas(page)).toHaveAttribute("data-scale", scale!);
  await expect(profiles(page)).toHaveCount(0);

  // A plain left drag still draws, so the slide gestures above really were ignored by the tool.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(profiles(page)).toHaveCount(1);

  // Back in 3D, wheel-drag pans the 3D view again.
  await page.getByRole("button", { name: "Cancel" }).click();
  const target = await cameraTarget(page);
  await drag(page, "viewport-canvas", "middle", [100, 0]);
  expect(await cameraTarget(page)).not.toEqual(target);
});
