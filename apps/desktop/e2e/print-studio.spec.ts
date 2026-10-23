import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { checkBinaryStl } from "../../../packages/geometry/src/stl-check";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const check = (page: Page, id: string) => page.locator(`[data-testid="print-check"][data-check="${id}"]`);
const printStudio = (page: Page) => page.getByRole("button", { name: "Print Studio" });
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("Prepare to print checks the real part on the chosen printer's plate", async ({ page }) => {
  await printStudio(page).click();
  await expect(page.getByRole("complementary", { name: "Print Studio" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Browser" })).toHaveCount(0);
  // The default A1's plate and build volume, and the starting 60 × 40 × 30 box checked from its exported file.
  await expect(host(page)).toHaveAttribute("data-plate", "256,256,256");
  await expect(check(page, "closed")).toHaveAttribute("data-status", "ok");
  await expect(check(page, "pieces")).toHaveAttribute("data-status", "ok");
  await expect(check(page, "plate")).toHaveAttribute("data-status", "ok");
  await expect(check(page, "fits")).toHaveText("Fits the A1: 60 mm × 40 mm × 30 mm in 256 mm × 256 mm × 256 mm.");
  await expect(page.getByTestId("print-facts")).toContainText("60 × 40 × 30 mm");
  await page.screenshot({ path: `${OUT}print-studio.png` });

  // Clicking the part here looks at it; it doesn't pick a piece to edit.
  const view = (await host(page).boundingBox())!;
  await page.mouse.click(view.x + view.width * 0.6, view.y + view.height * 0.5);
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
});

test("changing the printer never touches the design, and undo puts it back", async ({ page }) => {
  await field(page, "Width").fill("200");
  await current(page);
  await printStudio(page).click();
  await expect(check(page, "fits")).toHaveAttribute("data-status", "ok"); // 200 mm fits the A1

  await page.getByLabel("Printer").selectOption("bambu-a1-mini");
  await expect(host(page)).toHaveAttribute("data-plate", "180,180,180");
  await expect(page.getByTestId("build-volume")).toHaveText(
    "Build volume 180 × 180 × 180 mm. 0.4 mm nozzle up to 300 °C. Bed up to 80 °C.",
  );
  await expect(check(page, "fits")).toHaveAttribute("data-status", "error");
  await expect(check(page, "fits")).toHaveText(
    "Too big for the A1 mini: 200 mm wide, the most is 180 mm. Make it smaller, split it, or pick a bigger printer.",
  );
  await expect(host(page)).toHaveAttribute("data-geometry", "current"); // nothing was rebuilt
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes"); // the printer is saved with it
  await page.screenshot({ path: `${OUT}print-studio-too-big.png` });

  // A printer the maker gives less detail for shows only what they publish.
  await page.getByLabel("Printer").selectOption("bambu-x1c");
  await expect(page.getByTestId("build-volume")).toHaveText("Build volume 256 × 256 × 256 mm.");
  await page.getByLabel("Printer").selectOption("anycubic-kobra3-max");
  await expect(host(page)).toHaveAttribute("data-plate", "420,420,500");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Printer")).toHaveValue("bambu-a1");
  await expect(check(page, "fits")).toHaveAttribute("data-status", "ok");

  await page.getByRole("button", { name: "Back to design" }).click();
  await expect(host(page)).toHaveAttribute("data-plate", "1000,1000");
  await expect(field(page, "Width")).toHaveValue("200");
});

test("a part in two pieces, or above the plate, gets a plain warning", async ({ page }) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await field(page, "Left / right").fill("80"); // clear of the box
  await current(page);
  await printStudio(page).click();
  await expect(check(page, "pieces")).toHaveAttribute("data-status", "warning");
  await expect(check(page, "pieces")).toContainText("2 separate pieces");

  await page.getByRole("button", { name: "Back to design" }).click();
  await page.getByRole("button", { name: /^Cylinder 1\b/ }).click();
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: /^Box\b/ }).click();
  await field(page, "Lift").fill("5");
  await current(page);
  await printStudio(page).click();
  await expect(check(page, "pieces")).toHaveAttribute("data-status", "ok");
  await expect(check(page, "plate")).toHaveAttribute("data-status", "warning");
  await expect(check(page, "plate")).toContainText("5 mm above the plate");
});

test("the file exported from Print Studio is the one that was checked", async ({ page }) => {
  await printStudio(page).click();
  await expect(check(page, "fits")).toHaveAttribute("data-status", "ok");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL" }).click();
  const bytes = readFileSync(await (await download).path());
  const report = checkBinaryStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect(report.watertight).toBe(true);
  expect(report.bodies).toBe(1);
  expect(report.max.map((v, i) => Math.round(v - report.min[i]!))).toEqual([60, 40, 30]);
});

test("switching workspaces keeps the camera where it was", async ({ page }) => {
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  // Inside the open part of the view, clear of the palettes.
  const [, , bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as number[];
  const [x, y] = [box.x + box.width - right! - 120, box.y + box.height - bottom! - 160];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y - 30, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  await expect(host(page)).toHaveAttribute("data-camera-view", "custom");
  const before = await host(page).getAttribute("data-camera-position");
  await printStudio(page).click();
  await expect(check(page, "fits")).toBeVisible();
  await settled(page);
  expect(await host(page).getAttribute("data-camera-position")).toBe(before);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await settled(page);
  expect(await host(page).getAttribute("data-camera-position")).toBe(before);
});
