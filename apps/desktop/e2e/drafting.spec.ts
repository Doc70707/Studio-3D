import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const canvas = (page: Page) => page.getByTestId("sketch-canvas");
const profiles = (page: Page) => page.getByTestId("sketch-profile");

/** Where a sketch point (in mm) is on screen, once the drawing and its canvas have stopped moving (they ease after a
 * panel closes, and the canvas can still be laying out when the sketch opens). */
async function at(page: Page, u: number, v: number): Promise<[number, number]> {
  const c = canvas(page);
  let last = "";
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await c.boundingBox());
        const now = `${box} ${await c.getAttribute("data-origin")} ${await c.getAttribute("data-scale")}`;
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
const moveTo = async (page: Page, u: number, v: number) => page.mouse.move(...(await at(page, u, v)), { steps: 3 });
const clickAt = async (page: Page, u: number, v: number) => page.mouse.click(...(await at(page, u, v)));
/** Types text into the sketch, key by key, then Enter. */
async function enter(page: Page, text: string) {
  for (const ch of text) await page.keyboard.press(ch === "<" ? "Shift+Comma" : ch);
  await page.keyboard.press("Enter");
}

async function outlineOnPlate(page: Page) {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Outline tool" }).click();
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
}

/** Finishes the sketch 10 mm high, removes the starting box and checks the part's volume. */
async function finishAndCheck(page: Page, areaMm2: number) {
  await field(page, "Sketch height").fill("10");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Remove Box" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(areaMm2 * 10));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("an outline typed AutoCAD style: x,y from the origin, @dx,dy and @length<angle from the last corner", async ({
  page,
}) => {
  await outlineOnPlate(page);
  await moveTo(page, 70, 70); // the pointer is far away: the typed points decide
  await page.keyboard.press("0");
  await expect(page.getByTestId("typed-point")).toContainText("0");
  await page.keyboard.press(",");
  await enter(page, "0");
  await enter(page, "@40,0");
  await enter(page, "@25<90");
  await enter(page, "0,25");
  await page.screenshot({ path: `${OUT}drafting-typed.png` });
  await page.keyboard.press("Enter"); // nothing typed: close the outline
  await expect(profiles(page)).toHaveCount(1);
  await finishAndCheck(page, 40 * 25);
});

test("Escape while drawing an outline leaves nothing behind", async ({ page }) => {
  await outlineOnPlate(page);
  await clickAt(page, 0, 0);
  await clickAt(page, 30, 0);
  await clickAt(page, 30, 20);
  await page.keyboard.press("Escape");
  await expect(profiles(page)).toHaveCount(0);
  await expect(page.locator(".sketch-canvas .pending path")).toHaveCount(0);
  // A half-typed point is cleared first, then Escape again stops.
  await page.keyboard.press("@");
  await expect(page.getByTestId("typed-point")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("typed-point")).toHaveCount(0);
  await expect(profiles(page)).toHaveCount(0);
});

test("F8 ortho holds sides straight across or up; angle steps click to the nearest step", async ({ page }) => {
  await outlineOnPlate(page);
  await clickAt(page, 0, 0);
  await page.keyboard.press("F8");
  await expect(page.getByRole("button", { name: "Ortho" })).toHaveAttribute("aria-pressed", "true");
  await moveTo(page, 30, 4.3); // a little off level
  await expect(page.getByTestId("angle-guide")).toHaveAttribute("data-angle", "0");
  await expect(page.getByTestId("sketch-cursor")).toContainText("Front / back 0 mm");
  await clickAt(page, 30, 4.3);
  await moveTo(page, 33.6, 20);
  await expect(page.getByTestId("angle-guide")).toHaveAttribute("data-angle", "90");
  await clickAt(page, 33.6, 20);
  // Shift flips ortho off while held.
  await page.keyboard.down("Shift");
  await moveTo(page, 12.3, 27.1);
  await expect(page.getByTestId("angle-guide")).toHaveCount(0);
  await page.keyboard.up("Shift");
  await page.keyboard.press("F8");
  await expect(page.getByRole("button", { name: "Ortho" })).toHaveAttribute("aria-pressed", "false");

  await page.getByLabel("Angle steps").selectOption("45");
  await moveTo(page, 20.4, 29.2); // from the last corner (30, 20) that's 136.2°, near 135°
  await expect(page.getByTestId("angle-guide")).toHaveAttribute("data-angle", "135");
  await page.keyboard.press("Escape");
});

test("object snaps: ends, middles, centres, crossings and square to a side, with Alt to ignore them", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  // A 40 x 20 rectangle and a circle at (60, 10) to snap to.
  await clickAt(page, 0, 0);
  await clickAt(page, 40, 20);
  await page.getByRole("button", { name: "Circle tool" }).click();
  await clickAt(page, 60, 10);
  await clickAt(page, 63, 10);
  await expect(profiles(page)).toHaveCount(2);
  await page.keyboard.press("Escape"); // deselect the circle, so its settings panel doesn't cover the drawing
  await current(page); // the sketch's checks are back, so the bar under the drawing (and the drawing) stop moving

  await page.getByRole("button", { name: "Outline tool" }).click();
  const snapAt = async (u: number, v: number, kind: string) => {
    await moveTo(page, u, v);
    await expect(page.getByTestId("snap")).toHaveAttribute("data-snap", kind);
  };
  await snapAt(39.6, 19.7, "end");
  await snapAt(20.3, 0.2, "middle");
  await snapAt(59.7, 10.3, "centre");
  await page.screenshot({ path: `${OUT}drafting-snap.png` });
  // Square to the rectangle's top side from a corner placed above it.
  await clickAt(page, 13.3, 35.3);
  await snapAt(13.4, 20.4, "perpendicular");
  await page.mouse.click(...(await at(page, 13.4, 20.4)));
  await expect(page.getByTestId("sketch-cursor")).toContainText("Left / right 13 mm · Front / back 20 mm · Square to");
  // Where the side being drawn crosses the rectangle's right side: from (13, 20) to (50, 5) it meets x = 40 at y = 9.05.
  await clickAt(page, 50, 5);
  await snapAt(40, 9.1, "intersection");
  // Alt: no snaps at all.
  await page.keyboard.down("Alt");
  await moveTo(page, 20.3, 0.2);
  await expect(page.getByTestId("snap")).toHaveCount(0);
  await page.keyboard.up("Alt");
  await page.keyboard.press("Escape");
});

test("changing one side's length moves the corners after it; a bad length is explained", async ({ page }) => {
  await outlineOnPlate(page);
  // An L: 40 across, 10 up, 30 back, 20 up, 10 back, closed.
  await enter(page, "0,0");
  for (const p of ["@40,0", "@0,10", "@-30,0", "@0,20", "@-10,0"]) await enter(page, p);
  await page.keyboard.press("Enter");
  await expect(profiles(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Select tool" }).click();
  await clickAt(page, 5, 5);
  const sides = page.getByRole("group", { name: "Sides" });
  await expect(field(page, "Side 1 length")).toHaveValue("40");
  await expect(field(page, "Side 3 angle")).toHaveValue("180");
  await expect(page.getByTestId("closing-side")).toHaveText("Side 6 closes the outline: 30 mm at 270°");

  await field(page, "Side 1 length").fill("50");
  // Side 3 (back 30) keeps its length; the corners after side 1 moved 10 mm right.
  await expect(field(page, "Side 3 length")).toHaveValue("30");
  await expect(page.getByTestId("closing-side")).toHaveText("Side 6 closes the outline: 31.62 mm at 251.57°");
  await page.screenshot({ path: `${OUT}drafting-sides.png` });

  await field(page, "Side 2 length").fill("0");
  await expect(sides.getByRole("alert")).toHaveText("Side 2 needs a length above 0 mm.");
  await expect(field(page, "Side 3 length")).toHaveValue("30"); // nothing changed
  await field(page, "Side 2 length").fill("10");
  await expect(sides.getByRole("alert")).toHaveCount(0);

  // The corners are now these; the closing side slopes from (10, 30) back to (0, 0). Area by the shoelace formula.
  const pts = [
    [0, 0],
    [50, 0],
    [50, 10],
    [20, 10],
    [20, 30],
    [10, 30],
  ];
  const area =
    Math.abs(pts.reduce((a, p, i) => a + p[0]! * pts[(i + 1) % 6]![1]! - pts[(i + 1) % 6]![0]! * p[1]!, 0)) / 2;
  await finishAndCheck(page, area);
});
