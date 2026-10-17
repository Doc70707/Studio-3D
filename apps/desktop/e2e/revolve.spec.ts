import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const canvas = (page: Page) => page.getByTestId("sketch-canvas");
const menu = (page: Page, name: string) =>
  page.getByRole("menubar").getByRole("menuitem", { name, exact: true });
const item = (page: Page, name: string) => page.getByRole("menu").getByRole("menuitem", { name, exact: true });

/** Where a drawing point (in mm) is on screen. */
async function at(page: Page, u: number, v: number): Promise<[number, number]> {
  const c = canvas(page);
  const box = (await c.boundingBox())!;
  const k = Number(await c.getAttribute("data-scale"));
  const [ox, oy] = (await c.getAttribute("data-origin"))!.split(",").map(Number) as [number, number];
  return [box.x + ox + u * k, box.y + oy - v * k];
}
const clickAt = async (page: Page, u: number, v: number) => page.mouse.click(...(await at(page, u, v)));

/** Draws a rectangle by its first corner and typed width and height. */
async function typedRectangle(page: Page, u: number, v: number, w: string, h: string) {
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, u, v);
  await page.mouse.move(...(await at(page, u + 5, v + 5)));
  await page.keyboard.type(w);
  await page.keyboard.press("Tab");
  await page.keyboard.type(h);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("Create > Revolve spins a drawn outline into a round part, and the angle can change", async ({ page }) => {
  await page.getByRole("button", { name: "Remove Box" }).click();
  await expect(host(page)).toHaveAttribute("data-geometry", "empty");
  await menu(page, "Create").click();
  await item(page, "Revolve (spin an outline)").click();
  const editor = page.getByTestId("sketch-editor");
  await expect(editor).toContainText("Revolve 1 on the upright plane");
  await expect(page.getByTestId("spin-line")).toContainText("Spin line");

  // A 10 × 20 rectangle 5 mm out from the line: a tube 30 mm across and 20 mm tall.
  await typedRectangle(page, 5, 0, "10", "20");
  await expect(field(page, "Rectangle left edge")).toHaveValue("5");
  await expect(field(page, "Revolve angle")).toHaveValue("360");
  await page.screenshot({ path: `${OUT}revolve-editor.png` });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(editor).toBeHidden();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(Math.PI * (15 ** 2 - 5 ** 2) * 20));
  const card = page.getByTestId("sketch");
  await expect(card).toContainText("On the upright plane · 1 rectangle · spun 360°");

  // Half a turn makes half the tube.
  await field(page, "Revolve 1 angle").fill("180");
  await field(page, "Revolve 1 angle").press("Enter");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(Math.PI * (15 ** 2 - 5 ** 2) * 10));
  await page.screenshot({ path: `${OUT}revolve-half.png` });
});

test("an outline crossing the spin line is explained and can't be finished", async ({ page }) => {
  await page.getByRole("button", { name: "Revolve", exact: true }).click();
  await typedRectangle(page, -5, 0, "10", "10");
  await expect(page.getByTestId("sketch-editor")).toContainText("Rectangle 1 crosses the spin line");
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  // Moving it right of the line fixes it.
  await field(page, "Rectangle left edge").fill("0");
  await field(page, "Rectangle left edge").press("Enter");
  await expect(page.getByRole("button", { name: "Done" })).toBeEnabled();
});

test("a revolve can cut into the part: a countersink in the block's top", async ({ page }) => {
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
  await page.getByRole("button", { name: "Revolve", exact: true }).click();
  // A triangle from the line at 25 mm up to 5 mm out at the top (30 mm), closed above the block.
  await page.getByRole("button", { name: "Outline tool" }).click();
  for (const [u, v] of [
    [0, 25],
    [5, 30],
    [5, 31],
    [0, 31],
    [0, 25],
  ] as const)
    await clickAt(page, u, v);
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await page.getByRole("button", { name: "Cut in" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - (Math.PI * 25 * 5) / 3));
  await expect(page.getByTestId("sketch")).toContainText("cut 360°");
});
