import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const canvas = (page: Page) => page.getByTestId("sketch-canvas");
const marker = (page: Page) => page.getByTestId("snap");
const menu = (page: Page) => page.getByRole("dialog", { name: "Snap settings" });

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
const moveTo = async (page: Page, u: number, v: number) => page.mouse.move(...(await at(page, u, v)), { steps: 3 });
const clickAt = async (page: Page, u: number, v: number) => page.mouse.click(...(await at(page, u, v)));

/** A circle 20 mm across with its centre on the plate's middle. */
async function circleOnPlate(page: Page) {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Circle tool" }).click();
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
  await clickAt(page, 0, 0);
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Circle diameter")).toHaveValue("20");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("snaps to a circle's quadrant, and the Snaps menu turns each kind of snap on or off", async ({ page }) => {
  await circleOnPlate(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await moveTo(page, 9.7, 0.4);
  await expect(marker(page)).toHaveAttribute("data-snap", "quadrant");
  await expect(page.getByTestId("sketch-cursor")).toContainText("Left / right 10 mm · Front / back 0 mm · Quadrant");

  await page.getByRole("button", { name: "Snaps", exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await menu(page)
    .getByRole("checkbox", { name: /Quadrant/ })
    .uncheck();
  await page.keyboard.press("Escape");
  await moveTo(page, 9.6, 0.5);
  await moveTo(page, 9.7, 0.4);
  await expect(marker(page)).toHaveCount(0);

  // "On the line" is off at first; turned on, the pointer lands on the circle itself.
  await page.getByRole("button", { name: "Snaps", exact: true }).click();
  await menu(page)
    .getByRole("checkbox", { name: /On the line/ })
    .check();
  await page.keyboard.press("Escape");
  await moveTo(page, 7.2, 7.4);
  await expect(marker(page)).toHaveAttribute("data-snap", "nearest");

  // The choices are kept for next time.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("studio3d.snaps")!));
  expect(stored.kinds).toContain("nearest");
  expect(stored.kinds).not.toContain("quadrant");
});

test("F3 turns all snaps off and on again", async ({ page }) => {
  await circleOnPlate(page);
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await moveTo(page, 0.3, 0.2);
  await expect(marker(page)).toHaveAttribute("data-snap", "centre");
  await page.keyboard.press("F3");
  await expect(page.getByRole("button", { name: "Snaps", exact: true })).toHaveAttribute("aria-pressed", "false");
  await moveTo(page, 0.4, 0.3);
  await moveTo(page, 0.3, 0.2);
  await expect(marker(page)).toHaveCount(0);
  await page.keyboard.press("F3");
  await moveTo(page, 0.4, 0.3);
  await expect(marker(page)).toHaveAttribute("data-snap", "centre");
});

test("mid between 2 points puts the next point halfway between two clicks", async ({ page }) => {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Rectangle tool" }).click();
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
  await clickAt(page, -20, -10);
  await clickAt(page, 20, 10);
  await expect(page.getByLabel("Rectangle width")).toHaveValue("40");

  // A circle whose centre is halfway between two corners of the rectangle: its middle.
  await page.getByRole("button", { name: "Circle tool" }).click();
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "Mid of 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sketch-hint")).toContainText("click the first point");
  await clickAt(page, -19.8, -9.8); // snaps to the corner
  await expect(page.getByTestId("m2p-first")).toBeVisible();
  await expect(page.locator(".sketch-hint")).toContainText("click the second point");
  await clickAt(page, 19.8, 9.8);
  await expect(page.getByRole("button", { name: "Mid of 2" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Circle centre across")).toHaveValue("0");
  await expect(page.getByLabel("Circle centre up")).toHaveValue("0");
  await expect(page.getByLabel("Circle diameter")).toHaveValue("6");

  // From the Snaps menu too, and Escape lets go of it.
  await page.getByRole("button", { name: "Snaps", exact: true }).click();
  await menu(page)
    .getByRole("button", { name: /Mid between 2 points/ })
    .click();
  await expect(page.getByRole("button", { name: "Mid of 2" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Mid of 2" })).toHaveAttribute("aria-pressed", "false");
});

test("an outline drawn side by side from typed lengths and bearings, like Civil 3D's line by bearing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await page.getByRole("button", { name: "Outline tool" }).click();
  await expect(canvas(page)).toHaveAttribute("data-origin", /\d/);
  const next = page.getByRole("form", { name: "Next side" });
  await expect(next).toContainText("from the origin");

  await next.getByLabel("Side length").fill("30");
  await next.getByLabel("Side direction").fill("N 90 E");
  await expect(page.getByTestId("side-reads")).toHaveText("E · 0°");
  await expect(page.getByTestId("side-preview")).toHaveCount(1); // a flat line has no height, so not "visible"
  await next.getByRole("button", { name: "Add side" }).click();
  await expect(next).toContainText("from the last corner");

  await next.getByLabel("Side length").fill("20");
  await next.getByLabel("Side direction").fill("n0e");
  await expect(page.getByTestId("side-reads")).toHaveText("N · 90°");
  await next.getByLabel("Side direction").press("Enter"); // Enter adds the side too

  // A bad direction is shown as such and can't be added.
  await next.getByLabel("Side direction").fill("N 95 E");
  await expect(next.getByLabel("Side direction")).toHaveAttribute("aria-invalid", "true");
  await expect(next.getByRole("button", { name: "Add side" })).toBeDisabled();
  // An angle in degrees works as well: back towards the start.
  await next.getByLabel("Side length").fill("10");
  await next.getByLabel("Side direction").fill("180");
  await expect(page.getByTestId("side-reads")).toHaveText("W · 180°");
  await next.getByRole("button", { name: "Add side" }).click();
  await next.getByRole("button", { name: "Close outline" }).click();

  await expect(page.getByTestId("sketch-profile")).toHaveCount(1);
  await expect(page.getByLabel("Side 1 length")).toHaveValue("30");
  await expect(page.getByLabel("Side 1 angle")).toHaveValue("0");
  await expect(page.getByLabel("Side 2 length")).toHaveValue("20");
  await expect(page.getByLabel("Side 2 angle")).toHaveValue("90");
  await expect(page.getByLabel("Side 3 length")).toHaveValue("10");
  await expect(page.getByLabel("Side 3 angle")).toHaveValue("180");
});
