import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkBinaryStl } from "../../../packages/geometry/src/stl-check";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");

async function setField(page: Page, label: string, value: string) {
  await field(page, label).fill(value);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 30_000 });
});

test("starts with a real default box built by the geometry engine", async ({ page }) => {
  // 60 × 40 × 30 open box with 2 mm walls = 15552 mm³
  await expect(volume(page)).toHaveText("15.55 cm³");
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 30 mm");
  await expect(page.getByTestId("measurements")).toContainText("56 × 36 × 28 mm");
  await expect(page.getByTestId("save-status")).toContainText("Not saved yet");
});

test("changing a dimension rebuilds the real geometry", async ({ page }) => {
  await setField(page, "Width", "80");
  // 80·40·30 − 76·36·28 = 19392 mm³
  await expect(volume(page)).toHaveText("19.39 cm³");
  await expect(page.getByTestId("measurements")).toContainText("80 × 40 × 30 mm");
  await setField(page, "Wall thickness", "0");
  await expect(volume(page)).toHaveText("96.00 cm³");
  await expect(page.getByTestId("measurements")).not.toContainText("Inside space");
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
});

test("invalid values are explained and the last valid model is kept", async ({ page }) => {
  await setField(page, "Wall thickness", "25");
  await expect(page.getByText("Walls of 25 mm would fill the whole box")).toBeVisible();
  await expect(field(page, "Wall thickness")).toHaveAttribute("aria-invalid", "true");
  await expect(host(page)).toHaveAttribute("data-geometry", "stale");
  await expect(volume(page)).toHaveText("15.55 cm³"); // still the last good box
  // Print Studio holds the export, and says why it can't run yet.
  await page.getByRole("button", { name: "Print Studio" }).click();
  await expect(page.getByRole("button", { name: "Export STL" })).toBeDisabled();
  await expect(page.getByTestId("print-blocked")).toContainText("Fix the highlighted values");
  await page.getByRole("button", { name: "Back to design" }).click();

  await setField(page, "Height", "abc");
  await expect(page.getByText("Height needs to be a number")).toBeVisible();

  await setField(page, "Wall thickness", "3");
  await setField(page, "Height", "30");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  // 60·40·30 − 54·34·27
  await expect(volume(page)).toHaveText(`${((72000 - 54 * 34 * 27) / 1000).toFixed(2)} cm³`);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await expect(page.getByRole("button", { name: "Export STL" })).toBeEnabled();
  await page.getByRole("button", { name: "Back to design" }).click();
});

test("save, then reopen, restores the exact design", async ({ page }) => {
  await setField(page, "Width", "73.5");
  await setField(page, "Depth", "41.25");
  await setField(page, "Wall thickness", "1.6");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  const savedVolume = await volume(page).innerText();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Untitled.s3d");
  const path = await file.path();
  await expect(page.getByTestId("save-status")).toContainText("All changes saved");

  // Start over, then open the saved file.
  await page.getByRole("button", { name: "New" }).click();
  await expect(field(page, "Width")).toHaveValue("60");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(path);

  await expect(field(page, "Width")).toHaveValue("73.5");
  await expect(field(page, "Depth")).toHaveValue("41.25");
  await expect(field(page, "Wall thickness")).toHaveValue("1.6");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(volume(page)).toHaveText(savedVolume);
  await expect(page.getByTestId("save-status")).toContainText("All changes saved");
});

test("a damaged project file is rejected and the current design is untouched", async ({ page }) => {
  await setField(page, "Width", "70");
  page.on("dialog", (d) => void d.accept()); // "discard unsaved changes?" → yes
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: "broken.s3d", mimeType: "application/json", buffer: Buffer.from('{"format":"studio3d-proj') });
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't open broken.s3d" })).toBeVisible();
  await expect(field(page, "Width")).toHaveValue("70");
});

test("a project from a newer version is refused with an explanation", async ({ page }) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  const newer = { format: "studio3d-project", formatVersion: 99, document: { units: "mm", features: [] } };
  await (await chooser).setFiles({ name: "future.s3d", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(newer)) });
  await expect(page.getByRole("alert").filter({ hasText: "newer version of Studio 3D" })).toBeVisible();
});

test("exported STL is a watertight mesh with the exact dimensions", async ({ page }) => {
  await setField(page, "Width", "50");
  await setField(page, "Depth", "30");
  await setField(page, "Height", "20");
  await setField(page, "Wall thickness", "1.5");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print Studio" }).click();
  await page.getByRole("button", { name: "Export STL" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Untitled.stl");
  const bytes = readFileSync(await file.path());
  const report = checkBinaryStl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const expectedVolume = 50 * 30 * 20 - 47 * 27 * 18.5;
  expect(report.watertight).toBe(true);
  expect(report.consistentWinding).toBe(true);
  expect(report.max[0] - report.min[0]).toBeCloseTo(50, 4);
  expect(report.max[1] - report.min[1]).toBeCloseTo(30, 4);
  expect(report.max[2] - report.min[2]).toBeCloseTo(20, 4);
  expect(Math.abs(report.volume - expectedVolume) / expectedVolume).toBeLessThan(0.005);

  // Hand the same file to the independent trimesh check in CI.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}app-export.stl`, bytes);
  writeFileSync(`${OUT}app-export.expected.json`, JSON.stringify({ volume: expectedVolume, size: [50, 30, 20] }));
});
