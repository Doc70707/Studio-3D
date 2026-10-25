import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const units = (page: Page) => page.getByRole("group", { name: "Units" });
const width = (page: Page) => page.getByLabel("Width", { exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("one click shows every size in inches; typing inches makes the part that size; the part itself is unchanged", async ({
  page,
}) => {
  await expect(width(page)).toHaveValue("60");
  await units(page).getByRole("button", { name: "in", exact: true }).click();
  // The 60 × 40 × 30 mm box, in inches: boxes, units, the size underneath and the sizes on the part.
  await expect(width(page)).toHaveValue("2.362");
  await expect(page.locator(".field", { has: width(page) }).locator(".unit")).toHaveText("in");
  await expect(page.getByTestId("measurements")).toContainText("2.362 × 1.575 × 1.181 in");
  await expect(page.getByTestId("volume")).toHaveText("0.949 in³");
  await expect(page.getByTestId("dimension").filter({ hasText: "2.362 in" })).toHaveCount(1);
  // Nothing was rebuilt: switching units changes what is shown, not the part.
  await expect(host(page)).toHaveAttribute("data-geometry", "current");

  // Typing 3 means 3 inches; a fraction works, and so does a size with its own unit.
  await width(page).fill("3");
  await current(page);
  await expect(page.getByTestId("measurements")).toContainText("3 × 1.575 × 1.181 in");
  await width(page).fill("2 1/2");
  await current(page);
  await expect(page.getByTestId("measurements")).toContainText("2.5 × 1.575 × 1.181 in");
  await width(page).fill("50 mm");
  await current(page);
  await expect(page.getByTestId("measurements")).toContainText("1.969 × 1.575 × 1.181 in");

  // Back to millimetres: the part is exactly 50 mm wide.
  await units(page).getByRole("button", { name: "mm", exact: true }).click();
  await expect(width(page)).toHaveValue("50");
  await expect(page.getByTestId("measurements")).toContainText("50 × 40 × 30 mm");
  // 2 1/2 inches is exactly 63.5 mm.
  await width(page).fill("2 1/2 in");
  await current(page);
  await expect(page.getByTestId("measurements")).toContainText("63.5 × 40 × 30 mm");
});

test("the choice is remembered, and the View menu has it too", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Sizes in inches" }).click();
  await expect(units(page).getByRole("button", { name: "in", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await current(page);
  await expect(width(page)).toHaveValue("2.362");
  await expect(page.getByTestId("volume")).toHaveText("0.949 in³");
});

test("sketching in inches: the grid is in inches, and a typed rectangle is exactly that many inches", async ({
  page,
}) => {
  await units(page).getByRole("button", { name: "in", exact: true }).click();
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  const canvas = page.getByTestId("sketch-canvas");
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40);
  await expect(page.getByTestId("typed-width")).toContainText(" in");
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.type("1.5");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  // Picked straight after drawing: exactly 2 × 1.5 inches.
  await expect(page.getByLabel("Rectangle width")).toHaveValue("2");
  await expect(page.getByLabel("Rectangle height")).toHaveValue("1.5");
  // The grid has a line every 1/16, 1/8, 1/4 or 1 inch, depending on the zoom.
  const grid = Number(await canvas.locator("[data-grid]").getAttribute("data-grid"));
  expect([1 / 16, 1 / 8, 1 / 4, 1, 4].map((g) => g * 25.4)).toContainEqual(grid);
  // In millimetres it is 50.8 × 38.1, exactly.
  await units(page).getByRole("button", { name: "mm", exact: true }).click();
  await expect(page.getByLabel("Rectangle width")).toHaveValue("50.8");
  await expect(page.getByLabel("Rectangle height")).toHaveValue("38.1");
});

test("Settings › Units: feet and inches, centimetres and metres, each to a chosen precision", async ({ page }) => {
  const settings = page.getByRole("dialog", { name: "Settings" });
  const sizes = page.getByTestId("measurements");
  await page.keyboard.press("Control+,");
  await settings.getByRole("tab", { name: "Units" }).click();
  await settings.getByRole("radio", { name: "Feet and inches" }).click();
  // Shown at once, to the nearest 1/16 inch; the box keeps the exact size for editing.
  await expect(sizes).toContainText(`2 3/8" × 1 9/16" × 1 3/16"`);
  await expect(width(page)).toHaveValue(`2 3/8"`);
  await expect(page.locator(".field", { has: width(page) }).locator(".unit")).toHaveCount(0);

  // Typed as an architect writes it.
  await width(page).fill(`2' 3 1/2"`);
  await current(page);
  await expect(sizes).toContainText(`2' 3 1/2" × 1 9/16" × 1 3/16"`);
  await expect(page.getByTestId("dimension").filter({ hasText: `2' 3 1/2"` })).toHaveCount(1);

  await settings.getByRole("radio", { name: `1/64"` }).click();
  await expect(sizes).toContainText(`2' 3 1/2" × 1 37/64" × 1 3/16"`);

  await settings.getByRole("radio", { name: "Centimetres" }).click();
  await expect(sizes).toContainText("69.85 × 4 × 3 cm");
  await settings.getByRole("radio", { name: "Metres", exact: true }).click();
  await expect(sizes).toContainText("0.699 × 0.04 × 0.03 m");
  await settings.getByRole("radio", { name: "0.0001" }).click();
  await expect(sizes).toContainText("0.6985 × 0.04 × 0.03 m");

  // Cancel puts the units back; the part keeps its new width, exactly 27.5 inches.
  await settings.getByRole("button", { name: "Cancel" }).click();
  await expect(sizes).toContainText("698.5 × 40 × 30 mm");

  // The status bar's switch goes to the last imperial choice: feet and inches, to the 1/64.
  await units(page).getByRole("button", { name: "ft-in", exact: true }).click();
  await expect(sizes).toContainText(`2' 3 1/2" × 1 37/64" × 1 3/16"`);
  // Remembered: after a restart (the design itself waits in "Restore your unsaved work?") sizes are still to the 1/64.
  await page.reload();
  await current(page);
  await expect(sizes).toContainText(`2 23/64" × 1 37/64" × 1 3/16"`);
});
