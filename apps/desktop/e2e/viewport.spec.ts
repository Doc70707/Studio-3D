import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const cameraPos = async (page: Page) =>
  ((await host(page).getAttribute("data-camera-position")) ?? "").split(",").map(Number);
const distance = (p: number[]) => Math.hypot(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
const cameraTarget = async (page: Page) =>
  ((await host(page).getAttribute("data-camera-target")) ?? "").split(",").map(Number);
/** How far the camera is from the point it orbits around. */
const orbitRadius = async (page: Page) => {
  const [p, t] = [await cameraPos(page), await cameraTarget(page)];
  return distance(p.map((v, i) => v - (t[i] ?? 0)));
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-camera-view", "iso");
  expect(errors, "no errors while starting").toEqual([]);
});

test("the app starts and shows the viewport", async ({ page }) => {
  await expect(page).toHaveTitle("Untitled — Studio 3D");
  await expect(page.getByTestId("viewport-canvas")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the viewport actually renders the build plate", async ({ page }) => {
  const png = await page.getByTestId("viewport-canvas").screenshot();
  // Count distinct colours in the centre crop: a blank or failed canvas is one flat colour.
  const colours = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(img.width / 4, img.height / 4, img.width / 2, img.height / 2).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return set.size;
  }, png.toString("base64"));
  expect(colours).toBeGreaterThan(5);
});

test("standard view buttons move the camera", async ({ page }) => {
  for (const [label, view] of [["Top", "top"], ["Front", "front"], ["Right", "right"], ["3D", "iso"]] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(host(page)).toHaveAttribute("data-camera-view", view);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Top", exact: true }).click();
  // Camera sits directly above the part's centre, which is on the plate centre (orbit controls nudge it a hair off the pole).
  await expect.poll(async () => Math.max(...(await cameraPos(page)).slice(0, 2).map(Math.abs))).toBeLessThan(0.01);
  expect((await cameraPos(page))[2]).toBeGreaterThan(0);
});

test("keyboard shortcuts change the view", async ({ page }) => {
  await page.keyboard.press("2");
  await expect(host(page)).toHaveAttribute("data-camera-view", "front");
  await page.keyboard.press("1");
  await expect(host(page)).toHaveAttribute("data-camera-view", "top");
});

test("dragging orbits the camera", async ({ page }) => {
  const before = await cameraPos(page);
  const radius = await orbitRadius(page);
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 50, { steps: 10 });
  await page.mouse.up();
  await expect(host(page)).toHaveAttribute("data-camera-view", "custom");
  const after = await cameraPos(page);
  expect(after).not.toEqual(before);
  // Orbiting keeps the same distance from the point it turns around (the middle of the part).
  expect(await orbitRadius(page)).toBeCloseTo(radius, 0);
});

test("scrolling zooms in", async ({ page }) => {
  const before = distance(await cameraPos(page));
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -500);
  await expect.poll(async () => distance(await cameraPos(page))).toBeLessThan(before * 0.95);
});

test("right-drag pans the view", async ({ page }) => {
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  const before = await cameraPos(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up({ button: "right" });
  const after = await cameraPos(page);
  expect(after).not.toEqual(before);
  // The target moved, so the camera's distance from the origin changes.
  expect(Math.abs(distance(after) - distance(before))).toBeGreaterThan(0.001);
});
