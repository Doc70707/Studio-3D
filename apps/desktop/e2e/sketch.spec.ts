import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkBinaryStl } from "../../../packages/geometry/src/stl-check";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const canvas = (page: Page) => page.getByTestId("sketch-canvas");

/** Where a sketch point (in mm) is on screen, once the drawing and its canvas have stopped moving. */
async function at(page: Page, u: number, v: number): Promise<[number, number]> {
  const c = canvas(page);
  let last = "";
  await expect
    .poll(
      async () => {
        const now = `${JSON.stringify(await c.boundingBox())} ${await c.getAttribute("data-origin")} ${await c.getAttribute("data-scale")}`;
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [150] },
    )
    .toBe(true);
  const box = (await c.boundingBox())!;
  const k = Number(await c.getAttribute("data-scale"));
  const [ox, oy] = (await c.getAttribute("data-origin"))!.split(",").map(Number) as [number, number];
  return [box.x + ox + u * k, box.y + oy - v * k];
}
const clickAt = async (page: Page, u: number, v: number) => page.mouse.click(...(await at(page, u, v)));

/** The middle of the part of the 3D view the bars and palettes leave open, where the views centre the part. */
async function middleOfView(page: Page): Promise<[number, number]> {
  const view = (await page.locator("main.viewport-host").boundingBox())!;
  const [top, left, bottom, right] = (await page.locator("main.viewport-host").getAttribute("data-safe-area"))!
    .split(",")
    .map(Number) as [number, number, number, number];
  return [view.x + (left + view.width - right) / 2, view.y + (top + view.height - bottom) / 2];
}

/** Picks the top face of the part by clicking it in the top view. */
async function sketchOnTop(page: Page) {
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await page.getByRole("button", { name: "Sketch on a face" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Click a flat face" })).toBeVisible();
  const [x, y] = await middleOfView(page);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(page.getByTestId("sketch-editor")).toBeVisible();
  await expect(page.getByTestId("sketch-editor")).toContainText("on the top face");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("click the top face, drag a rectangle and cut it in as a pocket", async ({ page }) => {
  await sketchOnTop(page);
  // The face is shown with its size, measured from its bottom-left corner.
  await expect(canvas(page)).toContainText("60 mm");
  await expect(canvas(page)).toContainText("40 mm");
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  const [x1, y1] = await at(page, 10, 10);
  const [x2, y2] = await at(page, 30, 20);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await expect(canvas(page)).toContainText("20 mm"); // live size while dragging
  await page.mouse.up();
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await expect(field(page, "Rectangle width")).toHaveValue("20");
  await expect(field(page, "Rectangle left edge")).toHaveValue("10");

  await page.getByRole("button", { name: "Cut in" }).click();
  await field(page, "Sketch depth").fill("5");
  await page.screenshot({ path: `${OUT}sketch-editor.png` });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("sketch-editor")).toBeHidden();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 20 * 10 * 5));
  await expect(page.getByTestId("sketch")).toContainText("On the top face · 1 rectangle · cut 5 mm deep");

  // One undo removes the whole sketch.
  await page.getByRole("button", { name: "Undo" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
});

test("draw an outline corner by corner and push it out of the face", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Outline tool" }).click();
  for (const [u, v] of [
    [10, 10],
    [40, 10],
    [40, 30],
  ] as const)
    await clickAt(page, u, v);
  await expect(canvas(page)).toContainText("30 mm"); // the length of the first side
  await clickAt(page, 10, 10); // back to the first corner closes it
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await field(page, "Sketch height").fill("8");
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + ((30 * 20) / 2) * 8));
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 38 mm");
});

test("circles are drawn by centre and edge, and the exact size can be typed", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Circle tool" }).click();
  await clickAt(page, 30, 20);
  await clickAt(page, 34, 20);
  await expect(field(page, "Circle diameter")).toHaveValue("8");
  await field(page, "Circle diameter").fill("6");
  await page.getByRole("button", { name: "Cut in" }).click();
  await page.getByLabel("All the way through").check();
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - cyl(6, 30)));
});

test("sizes can be typed while drawing, like AutoCAD's input boxes at the pointer", async ({ page }) => {
  await sketchOnTop(page);
  const boxes = page.getByTestId("typed-sizes");
  // Circle: click the centre, type the diameter, Enter.
  await page.getByRole("button", { name: "Circle tool" }).click();
  await clickAt(page, 15, 20);
  await page.mouse.move(...(await at(page, 19, 20)));
  await expect(page.getByTestId("typed-diameter")).toContainText("8 mm"); // follows the pointer until typed
  await page.keyboard.type("12.5");
  await expect(page.getByTestId("typed-diameter")).toContainText("12.5 mm");
  await page.keyboard.press("Enter");
  await expect(boxes).toHaveCount(0);
  await expect(field(page, "Circle diameter")).toHaveValue("12.5");

  // Rectangle: first corner, width, Tab, height, Enter. It goes towards the pointer.
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, 30, 5);
  await page.mouse.move(...(await at(page, 40, 15)));
  await page.keyboard.type("22");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("typed-height")).toHaveAttribute("data-active", "true");
  await page.keyboard.type("14");
  await page.screenshot({ path: `${OUT}sketch-typed-sizes.png` });
  await page.keyboard.press("Enter");
  await expect(field(page, "Rectangle width")).toHaveValue("22");
  await expect(field(page, "Rectangle height")).toHaveValue("14");
  await expect(field(page, "Rectangle left edge")).toHaveValue("30");
  await expect(field(page, "Rectangle bottom edge")).toHaveValue("5");

  await expect(page.getByTestId("sketch-profile")).toHaveCount(2);
  // Outline: a length and an angle for each side; Enter with nothing typed closes it.
  await page.getByRole("button", { name: "Outline tool" }).click();
  await clickAt(page, 5, 30);
  for (const [length, angle] of [
    ["10", "0"],
    ["5", "90"],
  ]) {
    await page.keyboard.type(length!);
    await page.keyboard.press("Tab");
    await page.keyboard.type(angle!);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("sketch-profile")).toHaveCount(3);

  await page.getByRole("button", { name: "Cut in" }).click();
  await field(page, "Sketch depth").fill("2");
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - (cyl(12.5, 2) + 22 * 14 * 2 + ((10 * 5) / 2) * 2)));
});

test("a sketch can be edited again, and Cancel leaves the design alone", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, 0, 0);
  await clickAt(page, 10, 10);
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + 100 * 5));

  await page.getByRole("button", { name: "Edit Sketch 1" }).click();
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await page.getByRole("button", { name: "Select tool" }).click();
  await clickAt(page, 5, 5);
  await field(page, "Rectangle width").fill("20");
  await page.getByRole("button", { name: "Cancel" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + 100 * 5)); // unchanged

  await page.getByRole("button", { name: "Edit Sketch 1" }).click();
  await page.getByRole("button", { name: "Select tool" }).click();
  await clickAt(page, 5, 5);
  await field(page, "Rectangle width").fill("20");
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + 200 * 5));
});

test("a bracket drawn on the plate, saved and exported as a watertight STL", async ({ page }) => {
  // Draw an L on the plate, then remove the starting box so the bracket is the whole part.
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Outline tool" }).click();
  for (const [u, v] of [
    [0, 0],
    [40, 0],
    [40, 5],
    [5, 5],
    [5, 30],
    [0, 30],
  ] as const)
    await clickAt(page, u, v);
  await page.keyboard.press("Enter");
  await field(page, "Sketch height").fill("20");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Remove Box" }).click();
  await current(page);
  const expected = (40 * 5 + 5 * 25) * 20;
  await expect(volume(page)).toHaveText(cm3(expected));
  await expect(page.getByTestId("measurements")).toContainText("40 × 30 × 20 mm");
  await page.screenshot({ path: `${OUT}sketch-bracket.png` });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print Studio" }).click();
  await page.getByRole("button", { name: "Export STL" }).click();
  const file = `${OUT}app-export-sketch.stl`;
  mkdirSync(OUT, { recursive: true });
  await (await download).saveAs(file);
  writeFileSync(`${OUT}app-export-sketch.expected.json`, JSON.stringify({ volume: expected, size: [40, 30, 20] }));
  const buf = readFileSync(file);
  const report = checkBinaryStl(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  expect(report.watertight).toBe(true);
  expect(Math.abs(report.volume - expected) / expected).toBeLessThan(0.005);
});

test("an outline that crosses itself can't be finished, and says why", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Outline tool" }).click();
  for (const [u, v] of [
    [10, 10],
    [30, 30],
    [30, 10],
    [10, 30],
  ] as const)
    await clickAt(page, u, v);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("sketch-editor")).toContainText("crosses over itself");
  await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
  await page.keyboard.press("Control+z"); // the sketch screen's own undo
  await expect(page.getByTestId("sketch-profile")).toHaveCount(0);
});

test("the sketch's 3D view shows it on the part", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, 10, 10);
  await clickAt(page, 50, 30);
  await page.getByRole("button", { name: "3D", exact: true }).last().click();
  await expect(canvas(page)).toBeHidden();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + 800 * 5)); // the preview includes the sketch
  await page.screenshot({ path: `${OUT}sketch-3d.png` });
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(canvas(page)).toBeVisible();
});

test("an offset copy inside a rectangle makes a frame, and too big an offset says why", async ({ page }) => {
  await sketchOnTop(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await clickAt(page, 10, 10);
  await clickAt(page, 50, 30);
  await expect(field(page, "Rectangle width")).toHaveValue("40");

  await field(page, "Offset distance").fill("-12");
  await page.getByRole("button", { name: "Make offset copy" }).click();
  await expect(page.getByRole("alert")).toContainText("too small to shrink by 12 mm");
  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);

  await field(page, "Offset distance").fill("-3");
  await page.getByRole("button", { name: "Make offset copy" }).click();
  await expect(page.getByTestId("sketch-profile")).toHaveCount(2);
  await expect(page.getByTestId("sketch-profile").nth(1)).toHaveAttribute("data-hole", "true");
  await expect(field(page, "Rectangle width")).toHaveValue("34");
  await expect(field(page, "Rectangle left edge")).toHaveValue("13");

  await field(page, "Sketch height").fill("5");
  await page.screenshot({ path: `${OUT}offset-frame.png` });
  await page.getByRole("button", { name: "Done" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 + (40 * 20 - 34 * 14) * 5));
});
