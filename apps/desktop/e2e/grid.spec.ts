import { expect, test, type Page } from "@playwright/test";

// The adaptive grid: crisp at every zoom, finer squares close up, coarser far out, with no moiré or solid mass of
// lines at the horizon, on the plate and in model space alike.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The open part of the 3D view, where nothing covers the scene. */
async function openArea(page: Page) {
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { x: view.x + left, y: view.y + top, width: view.width - left - right, height: view.height - top - bottom };
}

/** Zooms with the wheel at the middle of the open area: negative zooms in. */
async function zoom(page: Page, notches: number) {
  const a = await openArea(page);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  for (let i = 0; i < Math.abs(notches); i++) await page.mouse.wheel(0, Math.sign(notches) * 120);
  await settled(page);
}

/**
 * How busy a strip of the view is: the share of neighbouring pixels that differ a lot. A grid that has crowded into
 * moiré or a solid mass of lines is busy everywhere; a clean grid is mostly calm surface between thin lines.
 */
async function busyness(page: Page, band: { x: number; y: number; width: number; height: number }) {
  await settled(page);
  const png = await page.screenshot({ clip: band });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.width, img.height];
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const lum = (i: number) => 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    let edges = 0;
    let n = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 1; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (Math.abs(lum(i) - lum(i - 4)) > 6) edges++;
        n++;
      }
    return edges / n;
  }, png.toString("base64"));
}

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

for (const space of ["plate", "model space"] as const)
  test(`${space}: the grid stays calm from close up to far away, and near the horizon`, async ({ page }) => {
    if (space === "model space") {
      await page.keyboard.press("Control+9");
      const input = page.getByTestId("command-line").getByRole("combobox");
      await input.fill("plate");
      await page.keyboard.press("Enter");
      await expect(host(page)).toHaveAttribute("data-surroundings", "model-space");
      await input.blur();
    }
    const name = space === "plate" ? "plate" : "model-space";
    const a = await openArea(page);
    // The top strip of the open area: in the 3D view that is the far plate, towards the horizon.
    const far = { x: a.x + 20, y: a.y + 10, width: a.width - 40, height: Math.round(a.height * 0.18) };
    const results: Record<string, number> = {};
    for (const [label, notches] of [
      ["start", 0],
      ["close", -14],
      ["closer", -10],
      ["medium", 24],
      ["far", 14],
      ["farther", 12],
    ] as const) {
      await zoom(page, notches);
      results[label] = await busyness(page, far);
      await page.screenshot({ path: `${OUT}grid-${name}-${label}.png` });
    }
    // Seen from the side, nearly edge-on to the plate: the worst case for moiré.
    await page.keyboard.press("3");
    await settled(page);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 40, { steps: 8 });
    await page.mouse.up({ button: "left" });
    results.edgeOn = await busyness(page, far);
    await page.screenshot({ path: `${OUT}grid-${name}-edge-on.png` });
    console.log(space, JSON.stringify(results));
    for (const [label, b] of Object.entries(results)) expect(b, label).toBeLessThan(0.2);
  });
