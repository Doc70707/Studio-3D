import { expect, test, type Page } from "@playwright/test";

// The command line as in AutoCAD and Civil 3D: Space is Enter, HOLE is placed by a click on the part, and the
// picked piece is moved, copied, turned and scaled by typing MOVE, COPY, ROTATE and SCALE (M, CO, RO, SC).
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const line = (page: Page) => page.getByTestId("command-line");
const input = (page: Page) => line(page).getByRole("combobox");
const said = (page: Page) => page.getByTestId("command-said");
const steps = (page: Page) => page.getByRole("complementary", { name: "Browser" }).getByRole("listitem");
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  const wall = field(page, "Wall thickness");
  await wall.fill("0"); // a solid 60 × 40 × 30 block
  await wall.blur();
  await current(page);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();
});

/** Types into the command line as in AutoCAD: each word ended with Space. */
async function type(page: Page, ...words: string[]) {
  for (const w of words) {
    await page.keyboard.type(w);
    await page.keyboard.press("Space");
  }
}

test("Space works as Enter after a command's name or a value; after everyday words it is a space", async ({ page }) => {
  await input(page).focus();
  await type(page, "box");
  await expect(steps(page).filter({ hasText: "Box 1" })).toHaveCount(1);
  // Space on an empty line runs the last command again.
  await page.keyboard.press("Space");
  await expect(steps(page).filter({ hasText: "Box 2" })).toHaveCount(1);
  await page.keyboard.type("round the");
  await expect(input(page)).toHaveValue("round the");
});

test("HOLE: click on the part where it goes, snapping to the face's centre, then its size is asked for", async ({
  page,
}) => {
  await page.keyboard.press("Escape");
  await host(page).hover();
  await type(page, "hole");
  await expect(page.getByRole("status").filter({ hasText: "where the hole goes" })).toBeVisible();

  // Straight down from above, click right of the middle of the top face.
  await input(page).blur();
  await page.keyboard.press("1");
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const cx = view.x + left + (view.width - left - right) / 2;
  const cy = view.y + top + (view.height - top - bottom) / 2;
  await page.mouse.move(cx + 60, cy);
  await page.mouse.click(cx + 60, cy);
  await expect(steps(page).filter({ hasText: "Hole 1" })).toHaveCount(1);
  const x = Number(await field(page, "Hole 1 left / right position").inputValue());
  expect(x).toBeGreaterThan(3);
  expect(x).toBeLessThan(30);

  // Its diameter is asked for at the command line, as FILLET asks for its radius.
  await expect(line(page)).toContainText("Hole diameter <5 mm>:");
  await input(page).focus();
  await type(page, "8");
  await expect(field(page, "Hole 1 diameter")).toHaveValue("8");
  await current(page);
  await page.screenshot({ path: `${OUT}command-line-hole-click.png` });

  // Enter while placing puts the next one in the middle; Esc leaves without one.
  await input(page).focus();
  await type(page, "h");
  await input(page).blur();
  await page.keyboard.press("Enter");
  await expect(steps(page).filter({ hasText: "Hole 2" })).toHaveCount(1);
  await expect(field(page, "Hole 2 left / right position")).toHaveValue("0");
});

test("ROTATE, MOVE, SCALE and COPY on the picked piece, each asking for its value", async ({ page }) => {
  await steps(page).filter({ hasText: "Box" }).first().click();
  const before = await volume(page).textContent();

  await input(page).focus();
  await type(page, "ro", "45");
  await expect(field(page, "Box turn")).toHaveValue("45");
  await current(page);
  await expect(volume(page)).toHaveText(before!);
  await page.screenshot({ path: `${OUT}command-line-rotate.png` });

  await type(page, "m", "10,5");
  await expect(field(page, "Left / right")).toHaveValue("10");
  await expect(field(page, "Front / back")).toHaveValue("5");

  await type(page, "sc", "2");
  await expect(field(page, "Width")).toHaveValue("120");
  await current(page);

  await type(page, "co", "0,100");
  await expect(steps(page)).toHaveCount(2);
  await expect(said(page)).toContainText("by x,y,z 0, 100, 0 mm");
  await current(page);

  // A cylinder looks the same turned, so ROTATE says so instead of doing nothing.
  await type(page, "cyl");
  await type(page, "ro");
  await expect(said(page)).toHaveText("Rotate: Cylinder 1 is round, so it looks the same turned");

  // Nothing picked: MOVE says what to do first.
  await type(page, "deselect", "m");
  await expect(said(page)).toHaveText("Move: Click a shape, hole or sketch first, then type MOVE");
});

test("in a sketch: PL for a polyline outline, O for OFFSET of the picked shape, RO to turn it", async ({ page }) => {
  await input(page).focus();
  await type(page, "rec");
  const sketch = page.getByTestId("sketch-editor");
  await expect(sketch).toBeVisible();
  await input(page).blur();
  const box = (await page.getByTestId("sketch-canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx - 60, cy - 40);
  await page.mouse.click(cx + 60, cy + 40);
  await expect(sketch.getByText("Rectangle 1", { exact: true }).first()).toBeVisible(); // picked once drawn

  // O typed over the drawing goes to the command line; Space runs it and asks how far.
  await page.mouse.move(cx, box.y + box.height + 4);
  await page.keyboard.press("o");
  await page.keyboard.press("Space");
  await expect(line(page)).toContainText("Offset by (minus shrinks)");
  await type(page, "-2");
  await expect(page.getByTestId("sketch-cursor")).toContainText("2 shapes drawn");

  await input(page).focus();
  await type(page, "ro", "30");
  await expect(said(page)).toHaveText(/by \(anticlockwise\) 30°$/);

  await type(page, "pl");
  await expect(sketch.getByRole("button", { name: "Outline tool" })).toHaveAttribute("aria-pressed", "true");
});
