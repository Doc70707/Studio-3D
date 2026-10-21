import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const ribbon = (page: Page) => page.getByTestId("ribbon");
const tab = (page: Page, name: string) =>
  page.getByRole("tablist", { name: "Ribbon tabs" }).getByRole("tab", { name, exact: true });
const palette = (page: Page, name: string) => page.getByRole("complementary", { name });
const safeArea = async (page: Page) =>
  (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [number, number, number, number];
/** The view publishes its camera after drawing the next frame; wait for it so a read isn't one frame old. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("the ribbon's tabs hold the tools, and it minimises to its tab names and opens over the view", async ({
  page,
}) => {
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
  for (const group of ["Shapes", "Sketch", "Modify"])
    await expect(ribbon(page).getByRole("group", { name: group })).toBeVisible();
  const [topOpen] = await safeArea(page);

  await page.getByRole("button", { name: "Minimise the ribbon" }).click();
  await expect(ribbon(page).getByRole("tabpanel")).toHaveCount(0);
  // The view gets the room back, so the part re-centres lower down.
  await expect.poll(async () => (await safeArea(page))[0]).toBeLessThan(topOpen - 40);
  // Minimised, a tab opens its tools over the view; using one closes it again.
  await tab(page, "Home").click();
  await expect(ribbon(page).getByRole("tabpanel")).toBeVisible();
  await ribbon(page).getByRole("button", { name: "Add box" }).click();
  await expect(ribbon(page).getByRole("tabpanel")).toHaveCount(0);
  await current(page);
  await expect(page.getByTestId("shape")).toHaveCount(2);
  // Escape closes an open tab without using anything.
  await tab(page, "Home").click();
  await page.keyboard.press("Escape");
  await expect(ribbon(page).getByRole("tabpanel")).toHaveCount(0);
  // Double-clicking a tab name brings the ribbon back, as in Civil 3D.
  await tab(page, "View").dblclick();
  await expect(ribbon(page).getByRole("tabpanel")).toBeVisible();
  await expect.poll(async () => (await safeArea(page))[0]).toBe(topOpen);
});

test("palettes fold to a strip, resize from their inner edge, and swap sides", async ({ page }) => {
  const browser = palette(page, "Browser");
  const properties = palette(page, "Properties");
  await expect(browser.getByTestId("browser")).toBeVisible();
  const width = (await browser.boundingBox())!.width;
  expect(width).toBeCloseTo(260, 0);

  // Arrow keys on the edge, then a drag: both widen it, and the view's open area follows.
  const edge = browser.getByRole("separator", { name: "Resize Browser" });
  await edge.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await browser.boundingBox())!.width).toBeCloseTo(300, 0);
  const e = (await edge.boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 + 60, e.y + e.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await browser.boundingBox())!.width).toBeCloseTo(360, 0);
  await expect.poll(async () => (await safeArea(page))[1]).toBeGreaterThanOrEqual(360);

  // Folded, it leaves a strip with its name; a click opens it at the same width.
  await browser.getByRole("button", { name: "Collapse Browser" }).click();
  await expect(browser.getByTestId("browser")).toHaveCount(0);
  await expect.poll(async () => (await browser.boundingBox())!.width).toBeLessThan(60);
  await browser.getByRole("button", { name: "Open Browser" }).click();
  await expect.poll(async () => (await browser.boundingBox())!.width).toBeCloseTo(360, 0);

  // Swapping puts the Browser on the right and Properties on the left.
  await tab(page, "View").click();
  await ribbon(page).getByRole("button", { name: "Swap sides" }).click();
  const b = (await browser.boundingBox())!;
  const p = (await properties.boundingBox())!;
  expect(b.x).toBeGreaterThan(p.x);
  expect(b.x + b.width).toBeCloseTo(1280, 0);

  // A palette can be put away from the ribbon and brought back.
  await ribbon(page).getByRole("button", { name: "Show Properties" }).click();
  await expect(properties).toHaveCount(0);
  await expect.poll(async () => (await safeArea(page))[1]).toBe(0);
  await ribbon(page).getByRole("button", { name: "Show Properties" }).click();
  await expect(properties).toBeVisible();
});

test("the arranged workspace comes back after a restart, and Reset puts it back as it started", async ({ page }) => {
  await tab(page, "View").click();
  await ribbon(page).getByRole("button", { name: "Swap sides" }).click();
  await ribbon(page).getByRole("button", { name: "Floating" }).click();
  await expect(page.locator(".app")).toHaveClass(/style-floating/);
  await palette(page, "Properties").getByRole("button", { name: "Collapse Properties" }).click();
  await page.getByRole("button", { name: "Minimise the ribbon" }).click();

  await page.reload();
  await current(page);
  await expect(page.locator(".app")).toHaveClass(/style-floating/);
  await expect(ribbon(page).getByRole("tabpanel")).toHaveCount(0);
  await expect(palette(page, "Properties").getByRole("button", { name: "Open Properties" })).toBeVisible();
  expect((await palette(page, "Browser").boundingBox())!.x).toBeGreaterThan(640); // still on the right

  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reset workspace" }).click();
  await expect(page.locator(".app")).toHaveClass(/style-docked/);
  await expect(ribbon(page).getByRole("tabpanel")).toBeVisible();
  await expect(palette(page, "Properties").getByRole("button", { name: "Collapse Properties" })).toBeVisible();
  await expect.poll(async () => (await palette(page, "Browser").boundingBox())!.x).toBeCloseTo(0, 0);
});

test("floating palettes are glass over the view, and the part still centres in the open space", async ({ page }) => {
  await tab(page, "View").click();
  await ribbon(page).getByRole("button", { name: "Floating" }).click();
  await settled(page);
  const [top, left, bottom, right] = await safeArea(page);
  expect(left).toBeGreaterThan(200);
  expect(right).toBeGreaterThan(200);
  expect(top).toBeGreaterThan(60);
  expect(bottom).toBeGreaterThanOrEqual(0);
  // Floating palettes stand clear of the window's edge.
  expect((await palette(page, "Browser").boundingBox())!.x).toBeGreaterThan(4);
});
