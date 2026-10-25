import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");

/** A step's line in the list; clicking it shows its properties. */
const step = (page: Page, name: string) =>
  page.getByRole("list", { name: "Steps" }).getByRole("button", { name: new RegExp(`^${name}\\b`) });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("hollow out a block, change the walls and the open side, then make it solid again", async ({ page }) => {
  await page.getByRole("button", { name: "Hollow out" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 56 * 36 * 28));
  await expect(page.getByTestId("hollow")).toContainText("2 mm walls · open at the top");
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 30 mm");
  await expect(page.getByRole("button", { name: "Hollow out" })).toBeDisabled(); // one hollow per part

  await field(page, "Hollow 1 wall thickness").fill("3");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 54 * 34 * 27));

  await page.getByLabel("Open side").selectOption("none");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 54 * 34 * 24));
  await expect(page.getByTestId("hollow")).toContainText("closed inside");

  await page.getByLabel("Open side").selectOption("top");
  await current(page);
  await page.screenshot({ path: `${OUT}hollow.png` });

  // Walls thicker than the part allows are explained, and the last good version stays.
  await field(page, "Hollow 1 wall thickness").fill("20");
  await expect(page.getByTestId("properties")).toContainText("only 30 mm across at its thinnest");
  await expect(volume(page)).toHaveText(cm3(72000 - 54 * 34 * 27));

  await field(page, "Hollow 1 wall thickness").fill("3");
  await current(page);
  await page.getByRole("button", { name: "Remove Hollow 1" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
});

test("a rounded top can't be left open, so another side is chosen", async ({ page }) => {
  await page.getByRole("button", { name: "Hollow out" }).click();
  await current(page);
  await page.getByRole("button", { name: "Add sphere" }).click();
  await field(page, "Lift").fill("25"); // sunk 5 mm into the block
  // The new ball is hollowed with the block, so the top of the part is now round.
  // The problem shows on the hollow's line in the list, though the ball is the step being edited.
  await expect(page.getByTestId("hollow")).toContainText("top of the part isn't flat");
  await step(page, "Hollow 1").click();
  await page.getByLabel("Open side").selectOption("bottom");
  await current(page);
  await expect(page.getByTestId("hollow")).toContainText("open at the bottom");
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 45 mm");
  await expect(page.getByTestId("hollow")).not.toContainText("isn't flat");
});
