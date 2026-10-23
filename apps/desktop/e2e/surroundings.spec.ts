import { expect, test, type Page } from "@playwright/test";

// What lies around the part: a bigger build plate (1 m by default, up to 2 m), or no plate at all, with the part on a
// plain background of any colour and just a grid, as in Civil 3D's model space. PLATE, GRID (F7) and BACKGROUND.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.getByRole("dialog", { name: "Appearance" });
const backgrounds = (page: Page) => panel(page).getByRole("radiogroup", { name: "Background" });
const line = (page: Page) => page.getByTestId("command-line");
const input = (page: Page) => line(page).getByRole("combobox");
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The average colour of a patch near the top left of the 3D view's open area, away from the part. */
async function cornerColour(page: Page): Promise<[number, number, number]> {
  await settled(page);
  const view = (await host(page).boundingBox())!;
  const [top, left] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [number, number];
  const png = await page.screenshot({ clip: { x: view.x + left + 30, y: view.y + top + 30, width: 24, height: 24 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.width, img.height];
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    return sum.map((v) => Math.round(v / (d.length / 4))) as [number, number, number];
  }, png.toString("base64"));
}

async function run(page: Page, command: string) {
  await input(page).focus();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();
});

test("the design plate is 1 m across, and Appearance makes it 256 mm, 500 mm or 2 m", async ({ page }) => {
  await expect(host(page)).toHaveAttribute("data-plate", "1000,1000");
  await expect(host(page)).toHaveAttribute("data-surroundings", "plate");
  await page.screenshot({ path: `${OUT}plate-1m.png` });

  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Background colour…" }).click();
  await panel(page).getByRole("radio", { name: "2 m" }).click();
  await expect(host(page)).toHaveAttribute("data-plate", "2000,2000");
  await panel(page).getByRole("radio", { name: "256 mm" }).click();
  await expect(host(page)).toHaveAttribute("data-plate", "256,256");
  await page.screenshot({ path: `${OUT}appearance-surroundings.png` });

  // Print Studio still shows the printer's own plate, then the design's comes back.
  await run(page, "print");
  await expect(host(page)).toHaveAttribute("data-plate", "256,256,256");
  await page.getByRole("button", { name: "Back to design" }).click();
  await expect(host(page)).toHaveAttribute("data-plate", "256,256");
});

test("PLATE turns the plate off: the part sits on a plain black background with a grid, as in model space", async ({
  page,
}) => {
  await run(page, "plate");
  await expect(host(page)).toHaveAttribute("data-surroundings", "model-space");
  await current(page);

  await run(page, "bg");
  await expect(panel(page)).toBeVisible();
  await backgrounds(page).getByRole("radio", { name: "Black" }).click();
  await expect(backgrounds(page).getByRole("radio", { name: "Black" })).toHaveAttribute("aria-checked", "true");
  await panel(page).getByRole("button", { name: "Done" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(host(page)).toHaveCSS("background-color", "rgb(0, 0, 0)");
  const black = await cornerColour(page);
  expect(Math.max(...black)).toBeLessThan(24);
  await page.screenshot({ path: `${OUT}model-space-black.png` });

  // White, picked the same way, shows white round the part: no plate is drawn over it.
  await run(page, "bg");
  await expect(panel(page)).toBeVisible();
  await backgrounds(page).getByRole("radio", { name: "White" }).click();
  await expect(backgrounds(page).getByRole("radio", { name: "White" })).toHaveAttribute("aria-checked", "true");
  await panel(page).getByRole("button", { name: "Done" }).click();
  await expect(panel(page)).toHaveCount(0);
  const white = await cornerColour(page);
  expect(Math.min(...white)).toBeGreaterThan(225);
  await page.screenshot({ path: `${OUT}model-space-white.png` });

  // F7 hides and shows the grid, as in AutoCAD.
  await input(page).blur();
  await page.keyboard.press("F7");
  await expect(host(page)).toHaveAttribute("data-grid", "off");
  await page.keyboard.press("F7");
  await expect(host(page)).toHaveAttribute("data-grid", "on");

  // Print Studio always shows the printer's plate, even with the design's turned off.
  await run(page, "print");
  await expect(host(page)).toHaveAttribute("data-surroundings", "plate");
  await page.getByRole("button", { name: "Back to design" }).click();
  await expect(host(page)).toHaveAttribute("data-surroundings", "model-space");

  // Kept for next time.
  await page.reload();
  await current(page);
  await expect(host(page)).toHaveAttribute("data-surroundings", "model-space");
  await expect(host(page)).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("any colour can be picked for the background, and the sketch screen uses it too", async ({ page }) => {
  await run(page, "background");
  await panel(page).getByLabel("Any background colour").fill("#203040");
  await expect(panel(page)).toContainText("Your colour #203040");
  await panel(page).getByRole("button", { name: "Done" }).click();
  await expect(host(page)).toHaveCSS("background-color", "rgb(32, 48, 64)");

  await run(page, "rec");
  await expect(page.getByTestId("sketch-editor")).toHaveCSS("background-color", "rgb(32, 48, 64)");
});
