import { expect, test, type Page } from "@playwright/test";
import { threadProfile, threadVolume } from "../../../packages/document/src/threads";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
// Threads take a few seconds to build, more on a slow test machine.
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 90_000 });

test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("a hole becomes an M5 threaded hole, labelled in the 3D view", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await current(page);
  await expect(field(page, "Hole 1 diameter")).toBeVisible();
  await page.getByLabel("Hole 1 thread").click(); // as a person would, which also shows the hole's measurements
  await page.getByLabel("Hole 1 thread").selectOption("M5");
  await expect(field(page, "Hole 1 diameter")).toBeHidden(); // the size comes from the thread now
  await expect(field(page, "Hole 1 fit clearance")).toHaveValue("0.3");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - threadVolume(threadProfile("M5", 0.3, false), 30)));
  await expect(page.getByTestId("dimension").filter({ hasText: "M5 thread" })).toHaveCount(1);

  // Back to a plain hole of the same size.
  await page.getByLabel("Hole 1 thread").selectOption("");
  await current(page);
  await expect(field(page, "Hole 1 diameter")).toHaveValue("5");
  await expect(volume(page)).toHaveText(cm3(72000 - Math.PI * 2.5 ** 2 * 30));
});

test("a cylinder becomes an M8 threaded rod standing on the block", async ({ page }) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await field(page, "Height").fill("15");
  await page.getByLabel("Cylinder 1 thread").selectOption("M8");
  await current(page);
  await expect(page.getByTestId("shape").filter({ hasText: "Cylinder 1" })).toContainText("M8 threaded rod × 15 mm");
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 45 mm");
  await expect(volume(page)).toHaveText(cm3(72000 + threadVolume(threadProfile("M8", 0.3, true), 15)));

  // A big M20 rod, close up, for the picture.
  await page.getByLabel("Cylinder 1 thread").selectOption("M20");
  await field(page, "Height").fill("25");
  await current(page);
  await page.getByRole("button", { name: "Sizes" }).click();
  const box = (await host(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}thread.png` });
  await page.getByRole("button", { name: "Sizes" }).click();

  // Too short for two turns of thread: explained, and the last good version stays.
  await field(page, "Height").fill("2");
  await expect(page.getByTestId("properties")).toContainText("at least two turns");
});
