import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const canvas = (page: Page) => page.getByTestId("sketch-canvas");

/** Where a sketch point (in mm) is on screen, once the drawing has stopped moving. */
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

async function middleOfView(page: Page): Promise<[number, number]> {
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return [view.x + (left + view.width - right) / 2, view.y + (top + view.height - bottom) / 2];
}

/** Picks the top face of the solid 60 × 40 × 30 block by clicking it in the top view. */
async function sketchOnTop(page: Page) {
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await page.getByRole("button", { name: "Sketch on a face" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Click a flat face" })).toBeVisible();
  const [x, y] = await middleOfView(page);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByTestId("sketch-editor")).toContainText("on the top face");
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("holes are placed right on the face while sketching, and become hole steps when done", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Hole tool" }).click();
  const options = page.getByRole("group", { name: "New holes" });
  await options.getByLabel("New hole diameter").fill("6");
  await options.getByLabel("New hole diameter").press("Enter");
  await clickAt(page, 10, 10);
  await clickAt(page, 50, 30);
  await expect(page.getByTestId("draft-hole")).toHaveCount(2);
  // The 3D view drills them straight away.
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 2 * cyl(6, 30)));

  // A hole is picked like a shape: exact numbers, and Delete removes it.
  await page.getByRole("button", { name: "Select tool" }).click();
  await clickAt(page, 10, 10);
  const panel = page.getByLabel("Selected hole");
  await expect(panel).toContainText("Hole 1");
  await expect(panel.getByLabel("Hole across")).toHaveValue("10");
  await page.screenshot({ path: new URL("../../../test-output/sketch-holes.png", import.meta.url).pathname });
  await panel.getByLabel("Hole across").fill("15");
  await panel.getByLabel("Hole across").press("Enter");
  await expect(page.getByTestId("draft-hole").first()).toBeVisible();
  await clickAt(page, 50, 30);
  await expect(panel).toContainText("Hole 2");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("draft-hole")).toHaveCount(1);
  // The sketch's own undo brings it back, and redo takes it away again.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-hole")).toHaveCount(2);
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("draft-hole")).toHaveCount(1);

  // Holes alone are fine: Done adds them without an empty sketch.
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("sketch-editor")).toBeHidden();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(6, 30)));
  await expect(page.getByTestId("browser").getByRole("button", { name: /^Hole 1/ })).toBeVisible();
  await expect(page.getByTestId("browser").getByRole("button", { name: /^Sketch/ })).toHaveCount(0);
  // Where it was put on the face, measured from the face's left and bottom edges.
  await expect(field(page, "Hole 1 diameter")).toHaveValue("6");
  await expect(page.getByLabel("Hole 1 measured across from")).toHaveValue("left");
  await expect(field(page, "Hole 1 distance across")).toHaveValue("15");
  await expect(field(page, "Hole 1 distance up")).toHaveValue("10");
});

test("a pocket and a hole drawn together go in as one undo step", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, 30, 10);
  await clickAt(page, 50, 30);
  await expect(field(page, "Rectangle width")).toHaveValue("20");
  await page.getByRole("button", { name: "Cut in" }).click();
  await field(page, "Sketch depth").fill("5");
  await page.getByRole("button", { name: "Hole tool" }).click();
  await clickAt(page, 15, 20);
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 20 * 20 * 5 - cyl(5, 30)));
  await page.getByRole("button", { name: "Undo" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
});

test("a hexagon for a nut trap, sized across its flats", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Polygon tool" }).click();
  await expect(page.getByRole("group", { name: "New polygon" }).getByLabel("Polygon sides")).toHaveValue("6");
  await clickAt(page, 30, 20);
  await page.keyboard.type("10");
  await expect(page.getByTestId("typed-across flats")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await expect(field(page, "Side 1 length")).toHaveValue(String(Math.round((10 / Math.sqrt(3)) * 100) / 100));
  await page.getByRole("button", { name: "Cut in" }).click();
  await field(page, "Sketch depth").fill("5");
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  // A hexagon 10 across its flats has an area of (√3 / 2) × 10².
  await expect(volume(page)).toHaveText(cm3(72000 - (Math.sqrt(3) / 2) * 100 * 5));
});
