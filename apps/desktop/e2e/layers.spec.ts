import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const info = (page: Page) => page.getByTestId("layer-info");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await expect(page.locator('[data-testid="print-check"][data-check="fits"]')).toHaveAttribute("data-status", "ok");
});

test("Preview layers cuts the checked part into its real layers", async ({ page }) => {
  // The starting part is a 60 × 40 × 30 open box with 2 mm walls and floor.
  await page.getByRole("button", { name: "Preview layers" }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  await expect(info(page)).toHaveText("Layer 150 of 150: 29.80 mm to 30.00 mm, 384 mm² of material.");
  await page.screenshot({ path: `${OUT}layers-top.png` });

  // Down in the floor every layer is the whole 60 × 40 rectangle.
  await page.getByLabel("Layer", { exact: true }).fill("5");
  await expect(host(page)).toHaveAttribute("data-layers", "5/150");
  await expect(info(page)).toHaveText("Layer 5 of 150: 0.80 mm to 1.00 mm, 2400 mm² of material.");
  await page.screenshot({ path: `${OUT}layers-floor.png` });

  await page.getByRole("button", { name: "Show the part" }).click();
  await expect(host(page)).not.toHaveAttribute("data-layers", /.*/);
});

test("the layer height is saved beside the design, and changing it re-slices without rebuilding", async ({ page }) => {
  await page.getByRole("button", { name: "Preview layers" }).click();
  await page.getByLabel("Layer height").selectOption("0.28");
  // 107 full layers reach 29.96 mm; a last thin one finishes the top.
  await expect(host(page)).toHaveAttribute("data-layers", "108/108");
  await expect(info(page)).toHaveText(/^Layer 108 of 108: 29\.96 mm to 30\.00 mm/);
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Layer height")).toHaveValue("0.2");
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
});

test("changing the design in Design and coming back slices the new part", async ({ page }) => {
  await page.getByRole("button", { name: "Back to design" }).click();
  await page.getByLabel("Height", { exact: true }).fill("10");
  await current(page);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await page.getByRole("button", { name: "Preview layers" }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "50/50");
});
