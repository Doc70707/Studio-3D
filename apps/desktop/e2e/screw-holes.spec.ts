import { expect, test, type Page } from "@playwright/test";
import { threadProfile, threadVolume } from "../../../packages/document/src/threads";

const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const frustum = (D: number, d: number, h: number) =>
  (Math.PI * h * ((D / 2) ** 2 + (D / 2) * (d / 2) + (d / 2) ** 2)) / 3;
// Threads take a few seconds to build, more on a slow test machine.
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 90_000 });

test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await current(page);
});

test("a clearance hole for an M5 screw, then a counterbore and a countersink for its head", async ({ page }) => {
  await page.getByLabel("Hole 1 clearance for screw").selectOption("M5");
  await expect(field(page, "Hole 1 diameter")).toBeHidden(); // the size comes from ISO 273 now
  await expect(page.getByTestId("clearance-size")).toHaveText(
    "5.5 mm across, the ISO 273 medium size for an M5 screw.",
  );
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5.5, 30)));

  await page.getByLabel("Hole 1 clearance fit").selectOption("coarse");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5.8, 30)));

  await page.getByLabel("Hole 1 screw head").selectOption("counterbore");
  await expect(field(page, "Hole 1 counterbore diameter")).toHaveValue("9.5");
  await expect(field(page, "Hole 1 counterbore depth")).toHaveValue("5");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5.8, 25) - cyl(9.5, 5)));
  await expect(page.getByTestId("dimension").filter({ hasText: "counterbore Ø9.5 mm" })).toHaveCount(1);

  // Too deep is explained, and nothing is changed to fit.
  await field(page, "Hole 1 counterbore depth").fill("30");
  await expect(page.getByText("The counterbore on Hole 1 reaches 30 mm deep")).toBeVisible();
  await expect(field(page, "Hole 1 counterbore depth")).toHaveValue("30");
  await field(page, "Hole 1 counterbore depth").fill("4");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5.8, 26) - cyl(9.5, 4)));

  await page.getByLabel("Hole 1 screw head").selectOption("countersink");
  await expect(field(page, "Hole 1 countersink diameter")).toHaveValue("11.2");
  await current(page);
  const sink = (11.2 - 5.8) / 2;
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(5.8, 30 - sink) - frustum(11.2, 5.8, sink)));
});

test("an inch thread part way down, then simplified to its tap drill", async ({ page }) => {
  await page.getByLabel("Hole 1 thread").selectOption("1/4-20 UNC");
  await page.getByLabel("Thread the whole hole").uncheck();
  await expect(field(page, "Hole 1 thread depth")).toHaveValue("10");
  await current(page);
  const t = threadProfile("1/4-20 UNC", 0.3, false);
  await expect(volume(page)).toHaveText(cm3(72000 - threadVolume(t, 10) - Math.PI * t.minor ** 2 * 20));

  await field(page, "Hole 1 thread depth").fill("2");
  await expect(page.getByText("needs at least two turns: make it at least 2.54 mm deep")).toBeVisible();
  await field(page, "Hole 1 thread depth").fill("10");

  await page.getByRole("button", { name: "Cosmetic" }).click();
  await expect(page.getByText("Drawn as the 5.11 mm tap drill for 1/4-20 UNC")).toBeVisible();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(0.201 * 25.4, 30)));
  await expect(page.getByRole("list", { name: "Steps" })).toContainText("1/4-20 UNC tapped, Ø5.11 mm drill");
});
