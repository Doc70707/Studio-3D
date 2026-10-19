import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const info = (page: Page) => page.getByTestId("layer-info");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await expect(page.locator('[data-testid="print-check"][data-check="fits"]')).toHaveAttribute("data-status", "ok");
});

test("Slice cuts the checked part into its real layers", async ({ page }) => {
  // The starting part is a 60 × 40 × 30 open box with 2 mm walls and floor.
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  await expect(info(page)).toHaveText(/^Layer 150 of 150: 29\.80 mm to 30\.00 mm, 384 mm² of material\. 2 walls\./);
  await page.screenshot({ path: `${OUT}layers-top.png` });

  // Down in the floor every layer is the whole 60 × 40 rectangle.
  await page.getByLabel("Layer", { exact: true }).fill("5");
  await expect(host(page)).toHaveAttribute("data-layers", "5/150");
  // The floor's bottom 0.6 mm (layers 1–3) is solid; above that, 15% infill until the floor's top skin.
  await expect(info(page)).toHaveText("Layer 5 of 150: 0.80 mm to 1.00 mm, 2400 mm² of material. 2 walls. 15% infill.");
  await page.screenshot({ path: `${OUT}layers-floor.png` });
  await page.getByLabel("Layer", { exact: true }).fill("2");
  await expect(info(page)).toContainText("2 walls. Solid skin.");
  await page.screenshot({ path: `${OUT}layers-skin.png` });
  await page.getByLabel("Infill").selectOption("0");
  await page.getByLabel("Layer", { exact: true }).fill("5");
  await expect(info(page)).toContainText("2 walls. Nothing to fill inside the walls.");

  await page.getByRole("button", { name: "Show the part" }).click();
  await expect(host(page)).not.toHaveAttribute("data-layers", /.*/);
});

test("the layer height is saved beside the design, and changing it re-slices without rebuilding", async ({ page }) => {
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await page.getByLabel("Layer height").selectOption("0.28");
  // 107 full layers reach 29.96 mm; a last thin one finishes the top.
  await expect(host(page)).toHaveAttribute("data-layers", "108/108");
  await expect(info(page)).toHaveText(/^Layer 108 of 108: 29\.96 mm to 30\.00 mm/);
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Layer height")).toHaveValue("0.2");
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
});

test("walls: as many as fit in a 2 mm wall, and a fin too thin for a line is reported", async ({ page }) => {
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  await page.screenshot({ path: `${OUT}layers-walls.png` });
  // Two 0.42 mm walls from each side fit in the 2 mm wall (4 × 0.42 = 1.68 mm); a third from each side wouldn't.
  await page.getByLabel("Walls").selectOption("3");
  await expect(info(page)).toContainText("Room for 2 of 3 walls in places.");
  await page.getByLabel("Walls").selectOption("1");
  await expect(info(page)).toContainText("1 wall.");
  await expect(page.getByTestId("thin-warning")).toHaveCount(0);

  // A 0.3 mm wall is thinner than one line.
  await page.getByRole("button", { name: "Back to design" }).click();
  await page.getByLabel("Wall thickness", { exact: true }).fill("0.3");
  await current(page);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(page.getByTestId("thin-warning")).toContainText("thinner than one 0.42 mm line");
  await expect(info(page)).toContainText("Too thin for any wall.");
});

test("changing the design in Design and coming back slices the new part", async ({ page }) => {
  await page.getByRole("button", { name: "Back to design" }).click();
  await page.getByLabel("Height", { exact: true }).fill("10");
  await current(page);
  await page.getByRole("button", { name: "Print Studio" }).click();
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "50/50");
});

test("Export G-code writes the printer's file and checks it before saving", async ({ page }) => {
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  // The starting printer is a Bambu Lab A1: its G-code has to go inside Bambu's own 3MF, which isn't written yet.
  await expect(page.getByTestId("gcode-blocked")).toContainText("Bambu printers take G-code packed in Bambu's own 3MF");
  await expect(page.getByRole("button", { name: "Export G-code…" })).toBeDisabled();

  await page.getByLabel("Printer").selectOption("creality-ender3-v3-se");
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  await expect(page.getByTestId("gcode-blocked")).toHaveCount(0);
  await expect(page.getByTestId("gcode-material")).toHaveText(
    "G-code is for PLA: nozzle 215 °C on the first layer, then 210 °C; bed 60 °C; 1.75 mm filament. " +
      "It's checked before it's saved.",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export G-code…" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Untitled.gcode");
  const gcode = readFileSync(await file.path(), "utf8");
  expect(gcode).toMatch(/^; Made by Studio 3D \d+\.\d+\.\d+'s own slicer for the Creality Ender-3 V3 SE\./);
  expect(gcode).toContain("; layer 150 of 150, 29.8 to 30 mm");
  expect(gcode.trimEnd().split("\n").slice(-4)).toEqual([
    "M104 S0 ; nozzle off",
    "M140 S0 ; bed off",
    "M107 ; fan off",
    "M84 ; motors off",
  ]);
  await expect(page.locator(".toast")).toContainText(
    /^Exported Untitled\.gcode\. Checked: 150 layers, [\d.]+ m of PLA \(about \d+ g\), every line inside the part and the printer\./,
  );
  // The open box, 60 × 40 × 30 with 2 mm walls, is 15.6 cm³ solid (19 g of PLA); with 2 walls and 15% infill
  // inside its walls and floor it takes less.
  const grams = Number(/about (\d+) g/.exec((await page.locator(".toast").textContent())!)![1]);
  expect(grams).toBeGreaterThan(15);
  expect(grams).toBeLessThan(30);
  // For the independent check in CI. The box sits in the middle of the 220 × 220 plate.
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}app-export.gcode`, gcode);
  writeFileSync(
    `${OUT}app-export.gcode.expected.json`,
    JSON.stringify({
      volume: [220, 220, 250],
      footprint: [80, 90, 140, 130],
      layers: 150,
      partVolume: 60 * 40 * 30 - 56 * 36 * 28,
      filamentDiameter: 1.75,
      maxNozzleTemp: 260,
      primeY: 5,
      sparse: true,
    }),
  );
});

test("one click on Slice shows the print: time, filament and layers, from G-code that was checked", async ({
  page,
}) => {
  // The starting printer is a Bambu Lab A1: its file can't be saved yet, but the print is still worked out.
  await page.getByRole("button", { name: "Slice", exact: true }).click();
  await expect(host(page)).toHaveAttribute("data-layers", "150/150");
  const result = page.getByTestId("slice-result");
  await expect(result).toContainText("Every line checked inside the part and the printer.");
  await expect(page.getByTestId("slice-layers")).toHaveText("150");
  await expect(result).toContainText("layers, 30 mm");
  // The open box takes 15–30 g of PLA (see the G-code test), and some minutes at 20–60 mm/s.
  const grams = Number((await page.getByTestId("slice-filament").textContent())!.replace(" g", ""));
  expect(grams).toBeGreaterThan(15);
  expect(grams).toBeLessThan(30);
  await expect(page.getByTestId("slice-time")).toHaveText(/^(\d+ h \d\d min|\d+ min)$/);
  const [h, m] = /(?:(\d+) h )?(\d+) min/.exec((await page.getByTestId("slice-time").textContent())!)!.slice(1);
  const minutes = Number(h ?? 0) * 60 + Number(m);
  expect(minutes).toBeGreaterThan(20);
  expect(minutes).toBeLessThan(400);
  await page.screenshot({ path: `${OUT}slice-result.png` });

  // A thinner layer height slices again: more layers, longer.
  await page.getByLabel("Layer height").selectOption("0.12");
  await expect(page.getByTestId("slice-layers")).toHaveText("250");
  const [h2, m2] = /(?:(\d+) h )?(\d+) min/.exec((await page.getByTestId("slice-time").textContent())!)!.slice(1);
  expect(Number(h2 ?? 0) * 60 + Number(m2)).toBeGreaterThan(minutes);

  // The Print tab of the ribbon slices too, and goes back to the part.
  await page.getByRole("button", { name: "Show the part again" }).click();
  await expect(host(page)).not.toHaveAttribute("data-layers", /.*/);
  await page.getByRole("button", { name: "Slice the part" }).click();
  await expect(page.getByTestId("slice-layers")).toHaveText("250");
});
