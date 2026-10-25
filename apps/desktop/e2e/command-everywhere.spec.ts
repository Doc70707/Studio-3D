import { expect, test, type Page } from "@playwright/test";
import { findLayoutProblems } from "./support/layout";

// The command line works wherever you are: the 3D view, the sketch screen, Print Studio and Focus canvas.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const line = (page: Page) => page.getByTestId("command-line");
const input = (page: Page) => line(page).getByRole("combobox");
const said = (page: Page) => page.getByTestId("command-said");
const steps = (page: Page) => page.getByRole("complementary", { name: "Browser" }).getByRole("listitem");
const app = (page: Page) => page.locator(".app");

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();
});

test("in the sketch screen: the sketch's own commands by AutoCAD names, letters typed go to it, Ctrl+9 hides it", async ({
  page,
}) => {
  await input(page).fill("REC");
  await page.keyboard.press("Enter");
  const sketch = page.getByTestId("sketch-editor");
  await expect(sketch).toBeVisible();
  await expect(line(page)).toBeVisible();

  // CIRCLE (and C) pick the circle tool, PL the outline tool.
  await input(page).fill("circle");
  await page.keyboard.press("Enter");
  await expect(sketch.getByRole("button", { name: "Circle tool" })).toHaveAttribute("aria-pressed", "true");
  await expect(said(page)).toHaveText("Circle  ·  Sketch › Drawing tools");
  await input(page).fill("PL");
  await page.keyboard.press("Enter");
  await expect(sketch.getByRole("button", { name: "Outline tool" })).toHaveAttribute("aria-pressed", "true");

  // ORTHO is AutoCAD's ortho lock here, and OSNAP turns the snaps off and on.
  await input(page).fill("ORTHO");
  await page.keyboard.press("Enter");
  await expect(sketch.getByRole("button", { name: "Ortho" })).toHaveAttribute("aria-pressed", "true");
  await input(page).fill("OSNAP");
  await page.keyboard.press("Enter");
  await expect(sketch.getByRole("button", { name: "Snaps" })).toHaveAttribute("aria-pressed", "false");
  await input(page).fill("OSNAP");
  await page.keyboard.press("Enter");
  await expect(sketch.getByRole("button", { name: "Snaps" })).toHaveAttribute("aria-pressed", "true");

  // A letter that isn't a tool's own key, typed over the drawing, starts a command.
  await input(page).blur();
  await page.getByTestId("sketch-canvas").hover();
  await page.keyboard.press("o");
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue("o");
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("");

  // Commands that can't run say why, here as everywhere.
  await input(page).fill("ERASE");
  await page.keyboard.press("Enter");
  await expect(said(page)).toHaveText("Delete: Click a shape or a hole first");

  // A rectangle drawn, then DONE finishes the sketch as the Done button does.
  await input(page).fill("rec");
  await page.keyboard.press("Enter");
  await input(page).blur();
  const box = (await page.getByTestId("sketch-canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx - 60, cy - 40);
  await page.mouse.click(cx + 60, cy + 40);
  await page.mouse.move(cx, box.y + box.height + 4); // off the drawing, so the readout counts shapes
  await expect(page.getByTestId("sketch-cursor")).toContainText("1 shape drawn");
  await page.screenshot({ path: `${OUT}command-line-sketch.png` });
  expect(await findLayoutProblems(page)).toEqual([]);

  // Ctrl+9 hides and shows it while sketching too.
  await page.keyboard.press("Control+9");
  await expect(line(page)).toHaveCount(0);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();

  await input(page).fill("DONE");
  await page.keyboard.press("Enter");
  await expect(sketch).toHaveCount(0);
  await expect(steps(page).filter({ hasText: "Sketch 1" })).toHaveCount(1);
  await expect(line(page)).toBeVisible();
});

test("in Print Studio: typed letters go to it, and a design command goes back to Design and runs", async ({ page }) => {
  await input(page).fill("print");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Print Studio" })).toBeVisible();
  await expect(line(page)).toBeVisible();
  await page.screenshot({ path: `${OUT}command-line-print-studio.png` });

  await host(page).hover();
  await page.keyboard.type("cyl");
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue("cyl");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Print Studio" })).toHaveCount(0);
  await expect(steps(page).filter({ hasText: "Cylinder 1" })).toHaveCount(1);
});

test("in Focus canvas, and with the status bar hidden, it still shows, types and runs", async ({ page }) => {
  await input(page).blur();
  await page.keyboard.press("Control+0");
  await expect(app(page)).toHaveClass(/\bfocus\b/);
  await expect(line(page)).toBeVisible();
  await host(page).hover();
  await page.keyboard.type("sphere");
  await page.keyboard.press("Enter");
  await expect(said(page)).toHaveText("Sphere  ·  Home › Shapes");
  await page.screenshot({ path: `${OUT}command-line-focus.png` });
  await page.keyboard.press("Control+9");
  await expect(line(page)).toHaveCount(0);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();
});

test("while measuring, letters still go to it", async ({ page }) => {
  await input(page).fill("dist");
  await page.keyboard.press("Enter");
  await expect(app(page)).toHaveAttribute("data-mode", "measure");
  await host(page).hover();
  await page.keyboard.type("top");
  await expect(input(page)).toHaveValue("top");
});
