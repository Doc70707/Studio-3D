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
const card = (page: Page, name: string) =>
  page.getByTestId("shape").filter({ hasText: name });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("a new cylinder stands on top of the part and adds its material", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await expect(card(page, "Cylinder 1")).toBeVisible();
  await expect(field(page, "Lift")).toHaveValue("30"); // placed on the top face
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + cyl(20, 20)));
  await expect(page.getByTestId("measurements")).toContainText(
    "60 × 40 × 50 mm",
  );
});

test("switching a shape to Cut removes its material from the part", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await field(page, "Lift").fill("10");
  await page.getByRole("button", { name: "Cut away" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(20, 20)));
  await page.getByRole("button", { name: /^Box/ }).click(); // open the box, which closes the cylinder
  await expect(card(page, "Cylinder 1")).toContainText("Cut ·");
});

test("the first shape can't be a cut, since there's nothing to cut from", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Cut away" })).toBeDisabled();
});

test("every kind of shape can be added and is built by the engine", async ({
  page,
}) => {
  for (const [button, name] of [
    ["Add tube", "Tube 1"],
    ["Add cone", "Cone 1"],
    ["Add sphere", "Sphere 1"],
    ["Add box", "Box 1"],
  ] as const) {
    await page.getByRole("button", { name: button }).click();
    await expect(card(page, name)).toBeVisible();
    await current(page);
  }
  await expect(page.getByTestId("shape")).toHaveCount(5);
});

test("a mistake in a shape is explained on its card and the last good model is kept", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add tube" }).click();
  await current(page);
  const good = await volume(page).innerText();
  await field(page, "Inside diameter").fill("25");
  await expect(
    page.getByText("must be smaller than the outside"),
  ).toBeVisible();
  await expect(host(page)).toHaveAttribute("data-geometry", "stale");
  await expect(volume(page)).toHaveText(good);
  await expect(page.getByRole("button", { name: "Export STL" })).toBeDisabled();
  await page.getByRole("button", { name: /^Box/ }).click(); // the error still shows when the card is closed
  await expect(card(page, "Tube 1")).toContainText(
    "must be smaller than the outside",
  );
});

test("removing a shape and undoing brings it back", async ({ page }) => {
  await page.getByRole("button", { name: "Add sphere" }).click();
  await current(page);
  const withSphere = await volume(page).innerText();
  await page.getByRole("button", { name: "Remove Sphere 1" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
  await page.keyboard.press("Control+z");
  await current(page);
  await expect(volume(page)).toHaveText(withSphere);
  await expect(page.getByRole("button", { name: "Remove Box" })).toBeEnabled();
});

test("a part made of several shapes is saved and reopened exactly", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add cone" }).click();
  await field(page, "Left / right").fill("-12.5");
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await page.getByRole("button", { name: "Cut away" }).click();
  await field(page, "Lift").fill("20");
  await current(page);
  const saved = await volume(page).innerText();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project" }).click();
  const path = await (await download).path();
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "New" }).click();
  await expect(page.getByTestId("shape")).toHaveCount(1);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByTestId("shape")).toHaveCount(3);
  await current(page);
  await expect(volume(page)).toHaveText(saved);
  await page.getByRole("button", { name: /^Cone 1/ }).click();
  await expect(field(page, "Left / right")).toHaveValue("-12.5");
});

test("a part with a sphere and a cone exports a watertight STL", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add sphere" }).click();
  await page.getByRole("button", { name: "Add cone" }).click();
  await field(page, "Left / right").fill("20");
  await current(page);
  const expected =
    Number((await volume(page).innerText()).replace(" cm³", "")) * 1000;
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL" }).click();
  const bytes = readFileSync(await (await download).path());
  const report = checkBinaryStl(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  expect(report.watertight).toBe(true);
  expect(report.consistentWinding).toBe(true);
  expect(Math.abs(report.volume - expected) / expected).toBeLessThan(0.005);
  const size = [0, 1, 2].map((i) => report.max[i]! - report.min[i]!);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}app-export-shapes.stl`, bytes);
  // The independent trimesh check compares against the volume the app showed (from the exact CAD geometry).
  writeFileSync(
    `${OUT}app-export-shapes.expected.json`,
    JSON.stringify({ volume: expected, size }),
  );
});
