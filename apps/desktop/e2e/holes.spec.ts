import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkBinaryStl } from "../../../packages/geometry/src/stl-check";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const current = (page: Page) =>
  expect(host(page)).toHaveAttribute("data-geometry", "current");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-geometry", "current", {
    timeout: 30_000,
  });
});

test("adding a hole cuts it through the floor with the real geometry engine", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await expect(page.getByTestId("hole")).toHaveCount(1);
  await current(page);
  // Default box 60 × 40 × 30 with 2 mm walls; a 5 mm through hole removes a 2 mm-tall disc from the floor.
  await expect(volume(page)).toHaveText(cm3(15552 - cyl(5, 2)));

  await field(page, "Wall thickness").fill("0");
  await field(page, "Hole 1 diameter").fill("10");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(10, 30)));

  await page.getByLabel("All the way through").uncheck();
  await field(page, "Hole 1 depth").fill("12");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(10, 12)));
});

test("a hole off the edge is explained and the last good model is kept", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await current(page);
  const good = await volume(page).innerText();
  await field(page, "Hole 1 left / right position").fill("-29");
  await expect(page.getByText("runs off the left edge")).toBeVisible();
  await expect(field(page, "Hole 1 left / right position")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(host(page)).toHaveAttribute("data-geometry", "stale");
  await expect(volume(page)).toHaveText(good);
  await expect(page.getByRole("button", { name: "Export STL" })).toBeDisabled();
});

test("a hole in the empty inside gets a plain warning", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.getByLabel("All the way through").uncheck();
  await current(page);
  await expect(page.getByText("doesn't cut anything")).toBeVisible();
  await expect(volume(page)).toHaveText(cm3(15552));
});

test("removing a hole puts the material back", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.getByRole("button", { name: "Add hole" }).click();
  await expect(page.getByText("Hole 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Hole 1" }).click();
  await page.getByRole("button", { name: "Remove Hole 2" }).click();
  await expect(page.getByTestId("hole")).toHaveCount(0);
  await current(page);
  await expect(volume(page)).toHaveText(cm3(15552));
});

test("undo and redo step through changes, with buttons and with the keyboard", async ({
  page,
}) => {
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await expect(undo).toBeDisabled();

  await field(page, "Width").fill("80"); // one step, however many characters are typed
  await current(page);
  await page.getByRole("button", { name: "Add hole" }).click();
  await current(page);
  const withHole = await volume(page).innerText();

  await undo.click();
  await expect(page.getByTestId("hole")).toHaveCount(0);
  await expect(field(page, "Width")).toHaveValue("80");
  await page.keyboard.press("Control+z");
  await expect(field(page, "Width")).toHaveValue("60");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(15552));
  await expect(page.getByTestId("save-status")).toContainText("Not saved yet");
  await expect(undo).toBeDisabled();

  await redo.click();
  await expect(field(page, "Width")).toHaveValue("80");
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("hole")).toHaveCount(1);
  await current(page);
  await expect(volume(page)).toHaveText(withHole);
  await expect(redo).toBeDisabled();
});

test("Ctrl+Z inside a text box undoes the design, not just the text", async ({
  page,
}) => {
  await field(page, "Height").fill("45");
  await field(page, "Height").press("Control+z");
  await expect(field(page, "Height")).toHaveValue("30");
});

test("holes are saved and reopened exactly", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await field(page, "Hole 1 diameter").fill("3.5");
  await field(page, "Hole 1 left / right position").fill("12.25");
  await current(page);
  const saved = await volume(page).innerText();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project" }).click();
  const path = await (await download).path();

  await page.getByRole("button", { name: "New" }).click();
  await expect(page.getByTestId("hole")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(path);
  await expect(field(page, "Hole 1 diameter")).toHaveValue("3.5");
  await expect(field(page, "Hole 1 left / right position")).toHaveValue(
    "12.25",
  );
  await current(page);
  await expect(volume(page)).toHaveText(saved);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled(); // opening starts a fresh history
});

test("exported STL has the holes in it and is watertight", async ({ page }) => {
  await field(page, "Width").fill("50");
  await field(page, "Depth").fill("30");
  await field(page, "Height").fill("20");
  await field(page, "Wall thickness").fill("0");
  await page.getByRole("button", { name: "Add hole" }).click();
  await field(page, "Hole 1 diameter").fill("8");
  await current(page);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL" }).click();
  const bytes = readFileSync(await (await download).path());
  const report = checkBinaryStl(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const expected = 30000 - cyl(8, 20);
  expect(report.watertight).toBe(true);
  expect(report.consistentWinding).toBe(true);
  expect(Math.abs(report.volume - expected) / expected).toBeLessThan(0.005);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}app-export-hole.stl`, bytes);
  writeFileSync(
    `${OUT}app-export-hole.expected.json`,
    JSON.stringify({ volume: expected, size: [50, 30, 20] }),
  );
});
