import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;

/** A step's line in the list; clicking it shows its properties. */
const step = (page: Page, name: string) =>
  page.getByRole("list", { name: "Steps" }).getByRole("button", { name: new RegExp(`^${name}\\b`) });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0");
  await field(page, "Height").fill("10"); // a solid 60 × 40 × 10 plate = 24000 mm³
  await current(page);
});

test("a hole repeated in a 3 × 2 grid makes six holes, and follows the original when it changes", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await field(page, "Hole 1 diameter").fill("5");
  await field(page, "Hole 1 left / right position").fill("-20");
  await field(page, "Hole 1 front / back position").fill("-10");
  await current(page);
  await page.getByRole("button", { name: "Pattern", exact: true }).click();
  await current(page);
  await expect(page.getByTestId("copy-step")).toContainText("Pattern 1");
  const card = page.getByTestId("properties");
  await expect(card.getByLabel("Copies")).toHaveValue(/.+/);
  await field(page, "Pattern 1 across").fill("3");
  await field(page, "Pattern 1 spacing").fill("20");
  await field(page, "Pattern 1 rows").fill("2");
  await field(page, "Pattern 1 row spacing").fill("20");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 - 6 * cyl(5, 10)));
  await page.screenshot({ path: `${OUT}pattern.png` });

  // Changing the original changes every copy.
  await step(page, "Hole 1").click();
  await field(page, "Hole 1 diameter").fill("4");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 - 6 * cyl(4, 10)));

  // Removing the original takes its pattern with it; undo brings both back.
  await page.getByRole("button", { name: "Remove Hole 1" }).click();
  await current(page);
  await expect(page.getByTestId("copy-step")).toHaveCount(0);
  await expect(volume(page)).toHaveText(cm3(24000));
  await page.getByRole("button", { name: "Undo" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 - 6 * cyl(4, 10)));
});

test("holes round a circle, from the Modify menu", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await field(page, "Hole 1 diameter").fill("4");
  await field(page, "Hole 1 left / right position").fill("12");
  await current(page);
  await page.getByRole("menubar").getByRole("menuitem", { name: "Modify", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Pattern Hole 1" }).click();
  await current(page);
  await page.getByRole("button", { name: "Round a circle" }).click();
  await field(page, "Pattern 1 count").fill("6");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 - 6 * cyl(4, 10)));
});

test("a boss mirrored to the other side, then across the other way", async ({ page }) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await field(page, "Diameter").fill("10");
  await field(page, "Height").fill("5");
  await field(page, "Left / right").fill("20");
  await field(page, "Front / back").fill("10");
  await current(page);
  await page.getByRole("button", { name: "Mirror", exact: true }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 + 2 * cyl(10, 5)));
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 15 mm");
  await page.getByRole("button", { name: "Front ↔ back" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(24000 + 2 * cyl(10, 5)));
});
