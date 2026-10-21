import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const labels = (page: Page) => page.getByTestId("dimension");

/** The middle of the part of the 3D view the bars and palettes leave open, where the views centre the part. */
async function middleOfView(page: Page): Promise<[number, number]> {
  const view = (await page.locator("main.viewport-host").boundingBox())!;
  const [top, left, bottom, right] = (await page.locator("main.viewport-host").getAttribute("data-safe-area"))!
    .split(",")
    .map(Number) as [number, number, number, number];
  return [view.x + (left + view.width - right) / 2, view.y + (top + view.height - bottom) / 2];
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 x 40 x 30 block
  await current(page);
});

test("a hole on the front face, measured from the right edge, follows the box when it gets wider", async ({ page }) => {
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "Hole on a face…" }).click();
  await expect(page.getByRole("status").filter({ hasText: "where the hole goes" })).toBeVisible();
  const [x, y] = await middleOfView(page);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);

  // In the middle of the front face, straight through the block's 40 mm depth.
  await expect(page.getByTestId("hole-on")).toContainText("On the front face of Box");
  await expect(page.getByTestId("properties")).toHaveAccessibleName("Hole 1 properties");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5, 40)));

  // Measure from the right edge instead: the same place reads 30 mm from it.
  await page.getByLabel("Hole 1 measured across from").selectOption("right");
  await expect(field(page, "Hole 1 distance across")).toHaveValue("30");
  await field(page, "Hole 1 distance across").fill("10");
  await page.getByLabel("Hole 1 measured up from").selectOption("bottom");
  await expect(field(page, "Hole 1 distance up")).toHaveValue("15");
  await field(page, "Hole 1 distance up").fill("8");
  await current(page);
  await expect(labels(page).filter({ hasText: /^10 mm$/ })).toHaveCount(1);
  await expect(labels(page).filter({ hasText: /^8 mm$/ })).toHaveCount(1);
  await page.screenshot({ path: `${OUT}face-hole.png` });

  // Wider box: the hole stays 10 mm from the right edge and 8 mm up.
  await page
    .getByRole("list", { name: "Steps" })
    .getByRole("button", { name: /^Box\b/ })
    .click();
  await field(page, "Width").fill("80");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(80 * 40 * 30 - cyl(5, 40)));
  await page
    .getByRole("list", { name: "Steps" })
    .getByRole("button", { name: /^Hole 1\b/ })
    .click();
  await expect(field(page, "Hole 1 distance across")).toHaveValue("10");
  await expect(page.getByTestId("properties")).toContainText("The front face is 80 × 30 mm");
});

test("a hole that would run off its face says which edge, and the number is left as typed", async ({ page }) => {
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("menuitem", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "Hole on a face…" }).click();
  const [x, y] = await middleOfView(page);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByTestId("hole-on")).toContainText("On the right face of Box");
  await page.getByRole("checkbox", { name: "All the way through" }).uncheck();
  await field(page, "Hole 1 depth").fill("12");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5, 12)));

  await field(page, "Hole 1 distance up").fill("14"); // from the middle: 15 + 14 + 2.5 > 30
  await expect(page.getByTestId("properties").getByRole("alert").first()).toContainText(
    "Hole 1 runs off the top edge of the right face",
  );
  await expect(field(page, "Hole 1 distance up")).toHaveValue("14");
  await field(page, "Hole 1 depth").fill("70");
  await field(page, "Hole 1 distance up").fill("0");
  await expect(page.getByRole("alert").filter({ hasText: "only 60 mm deep under Hole 1" }).first()).toBeVisible();

  // Back to the top of the part.
  await page.getByRole("button", { name: "Top of the part" }).click();
  await expect(page.getByTestId("hole-on")).toContainText("Drilled down from the top of the part");
});
