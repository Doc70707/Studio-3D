import { expect, test, type Locator, type Page } from "@playwright/test";

// Floating mode's layout: one header card, palettes only as tall as what they hold, the same gap between every card
// and from the window's edges, and the 3D view reachable everywhere else, at any window size.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const GAP = 12;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const ribbon = (page: Page) => page.getByTestId("ribbon");
const palette = (page: Page, name: string) => page.getByRole("complementary", { name });
const topbar = (page: Page) => page.locator("header.topbar");
const statusbar = (page: Page) => page.locator("footer.statusbar");
const box = async (l: Locator) => (await l.boundingBox())!;

async function floating(page: Page) {
  await page.getByRole("tablist", { name: "Ribbon tabs" }).getByRole("tab", { name: "View", exact: true }).click();
  await ribbon(page).getByRole("button", { name: "Floating" }).click();
  await expect(page.locator(".app")).toHaveClass(/style-floating/);
  // The palettes come off the window's edge as the layout settles.
  await expect.poll(async () => (await box(palette(page, "Browser"))).x).toBeCloseTo(GAP, 0);
}

/** Checks the cards' places against each other: the gaps, the joined header, and palettes kept to their contents. */
async function expectTidy(page: Page) {
  const size = page.viewportSize()!;
  const bar = await box(topbar(page));
  const tools = await box(ribbon(page));
  const status = await box(statusbar(page));
  const browser = await box(palette(page, "Browser"));
  const properties = await box(palette(page, "Properties"));
  // The bar and the tools are one card: no gap between them, the same width.
  expect(Math.abs(tools.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(tools.x - bar.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tools.width - bar.width)).toBeLessThanOrEqual(1);
  // The same gap from the window's edges and between the cards.
  expect(bar.x).toBeCloseTo(GAP, 0);
  expect(bar.y).toBeCloseTo(GAP, 0);
  expect(size.width - (bar.x + bar.width)).toBeCloseTo(GAP, 0);
  expect(size.height - (status.y + status.height)).toBeCloseTo(GAP, 0);
  for (const p of [browser, properties]) {
    expect(p.y - (tools.y + tools.height)).toBeCloseTo(GAP, 0);
    expect(p.y + p.height).toBeLessThanOrEqual(status.y - GAP + 1);
  }
  expect(browser.x).toBeCloseTo(GAP, 0);
  expect(size.width - (properties.x + properties.width)).toBeCloseTo(GAP, 0);
  // The view buttons keep the same gap from the Properties palette and the header.
  // (It follows the palette's edge once the 3D view has taken in the new layout.)
  const nav = page.locator(".view-nav");
  await expect.poll(async () => properties.x - ((await box(nav)).x + (await box(nav)).width)).toBeCloseTo(GAP, 0);
  await expect.poll(async () => (await box(nav)).y - (tools.y + tools.height)).toBeCloseTo(GAP, 0);
  return { bar, tools, status, browser, properties };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("floating: one header card, palettes as tall as what they hold, the same gap everywhere", async ({ page }) => {
  await floating(page);
  const { browser, status, tools } = await expectTidy(page);
  // One step in the Browser: its palette is short, and the 3D view shows (and takes clicks) below it.
  const room = status.y - GAP - (tools.y + tools.height + GAP);
  expect(browser.height).toBeLessThan(room - 150);
  const below = { x: browser.x + browser.width / 2, y: browser.y + browser.height + 40 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, below)).toBe("CANVAS");
  await page.screenshot({ path: `${OUT}floating-1280.png` });

  // With more steps than fit, the Browser grows to the room there is and scrolls; it never runs under the status bar.
  await page.getByRole("tablist", { name: "Ribbon tabs" }).getByRole("tab", { name: "Home", exact: true }).click();
  for (let i = 0; i < 14; i++) await page.getByRole("button", { name: "Add cylinder" }).click();
  await expect.poll(async () => (await box(palette(page, "Browser"))).height).toBeGreaterThan(room - 2);
  const tall = await box(palette(page, "Browser"));
  expect(tall.y + tall.height).toBeLessThanOrEqual(status.y - GAP + 1);
});

test("floating stays tidy as the window is resized, and with the tools minimised", async ({ page }) => {
  await floating(page);
  for (const [width, height] of [
    [1024, 640],
    [1920, 1080],
    [1366, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await box(topbar(page))).width).toBeCloseTo(width - 2 * GAP, 0);
    await expectTidy(page);
    if (width === 1024) await page.screenshot({ path: `${OUT}floating-1024.png` });
  }

  // Minimised, the bar is a card of its own with all its corners round, and a tab's tools drop under it as another.
  await page.getByRole("button", { name: "Minimise the ribbon" }).click();
  await expect(ribbon(page).getByRole("tabpanel")).toHaveCount(0);
  const radius = () => topbar(page).evaluate((h) => parseFloat(getComputedStyle(h).borderBottomLeftRadius));
  await expect.poll(radius).toBeGreaterThan(8);
  await page.getByRole("tablist", { name: "Ribbon tabs" }).getByRole("tab", { name: "Home", exact: true }).click();
  const bar = await box(topbar(page));
  // (It slides down a little as it drops.)
  await expect
    .poll(async () => (await box(ribbon(page).getByRole("tabpanel"))).y - (bar.y + bar.height))
    .toBeCloseTo(GAP, 0);
  // The palettes sit one gap under the bar, not two.
  expect((await box(palette(page, "Browser"))).y - (bar.y + bar.height)).toBeCloseTo(GAP, 0);
  await page.screenshot({ path: `${OUT}floating-minimised.png` });
});

test("in floating, Blurry's panel lines up with the palettes, and the view buttons stay clear of it", async ({
  page,
}) => {
  await floating(page);
  const { properties, status } = await expectTidy(page);
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  const blurry = page.getByRole("dialog", { name: "Blurry" });
  await expect(blurry).toBeVisible();
  await expect.poll(async () => (await box(blurry)).width).toBeGreaterThan(300); // grown in
  // Let its opening finish before measuring: it materialises in place.
  await page.waitForTimeout(400);
  const panel = await box(blurry);
  expect(properties.x - (panel.x + panel.width)).toBeCloseTo(GAP, 0);
  expect(status.y - (panel.y + panel.height)).toBeCloseTo(GAP, 0);
  const nav = await box(page.locator(".view-nav"));
  await expect
    .poll(async () => panel.x - ((await box(page.locator(".view-nav"))).x + nav.width))
    .toBeGreaterThan(GAP - 1);
  await page.screenshot({ path: `${OUT}floating-blurry.png` });
});
