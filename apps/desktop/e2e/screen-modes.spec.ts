import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const app = (page: Page) => page.locator(".app");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.locator("aside.panel");
const screen = (page: Page) => page.getByRole("navigation", { name: "Screen" });
const bar = (page: Page) => page.getByTestId("selection-bar");
/** The view publishes its camera after drawing the next frame; wait for it so a read isn't one frame old. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const camera = async (page: Page) => ({
  position: await host(page).getAttribute("data-camera-position"),
  target: await host(page).getAttribute("data-camera-target"),
});

/** Orbits away from the standard views, so the camera is somewhere only the user put it. */
async function orbit(page: Page) {
  const box = (await page.getByTestId("viewport-canvas").boundingBox())!;
  const [x, y] = [box.x + box.width - 120, box.y + box.height - 160];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y - 30, { steps: 8 });
  await page.mouse.up();
  await settled(page);
  await expect(host(page)).toHaveAttribute("data-camera-view", "custom");
}

/** The canvas covers the whole 3D view: it was resized with it. */
async function canvasFillsView(page: Page) {
  await settled(page);
  const view = (await host(page).boundingBox())!;
  const canvas = (await page.getByTestId("viewport-canvas").boundingBox())!;
  expect(canvas.width).toBeCloseTo(view.width, 0);
  expect(canvas.height).toBeCloseTo(view.height, 0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("Focus canvas puts the panels away and brings them back without touching the design or camera", async ({
  page,
}) => {
  await field(page, "Width").fill("72"); // an unsaved change
  await current(page);
  await orbit(page);
  const before = await camera(page);

  await screen(page).getByRole("button", { name: "Focus canvas" }).click();
  await expect(app(page)).toHaveClass(/\bfocus\b/);
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("menubar")).toBeHidden();
  await expect(page.locator("footer.statusbar")).toBeHidden();
  // Navigation stays to hand, and the way out is labelled.
  await expect(page.getByRole("navigation", { name: "Camera views" })).toBeVisible();
  await expect(screen(page).getByRole("button", { name: "Exit focus canvas" })).toContainText("Exit focus");
  await canvasFillsView(page);
  expect(await camera(page)).toEqual(before); // same place, same direction: only the space around it changed
  await page.screenshot({ path: `${OUT}focus-canvas.png` });

  await screen(page).getByRole("button", { name: "Exit focus canvas" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await expect(field(page, "Width")).toHaveValue("72");
  expect(await camera(page)).toEqual(before);
  await canvasFillsView(page);
});

test("Ctrl+0 and Escape go in and out of Focus canvas, and the panel comes up for a selected piece", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await expect(bar(page)).toContainText("Cylinder 1"); // a new shape is picked
  await page.keyboard.press("Control+0");
  await expect(app(page)).toHaveClass(/\bfocus\b/);
  // Something is selected, so its sizes are on screen to type into.
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("properties")).toHaveAccessibleName("Cylinder 1 properties");
  // Typing in a box: Escape and letters belong to the box, not the screen mode.
  await field(page, "Diameter").fill("24");
  await field(page, "Diameter").press("Enter");
  await field(page, "Diameter").press("Escape");
  await expect(app(page)).toHaveClass(/\bfocus\b/);
  await expect(panel(page)).toBeVisible();
  await field(page, "Diameter").blur();
  await page.keyboard.press("Escape"); // let go of the cylinder: the panel goes with it
  await expect(bar(page)).toBeHidden();
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press("Escape"); // nothing left to let go of: leave Focus canvas
  await expect(app(page)).not.toHaveClass(/\bfocus\b/);
  await expect(panel(page)).toBeVisible();
  await expect(field(page, "Diameter")).toHaveValue("24"); // the typed size was kept
});

test("the side panel hides and comes back with Ctrl+B, the screen button and the View menu", async ({ page }) => {
  await page.keyboard.press("Control+b");
  await expect(panel(page)).toBeHidden();
  await expect(screen(page).getByRole("button", { name: "Side panel" })).toHaveAttribute("aria-pressed", "false");
  await canvasFillsView(page);
  await screen(page).getByRole("button", { name: "Side panel" }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Side panel" }).click();
  await expect(panel(page)).toBeHidden();
  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Side panel" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemcheckbox", { name: "Side panel" }).click();
  await expect(panel(page)).toBeVisible();
});

test("F11 goes full screen and back, keeping the design, the camera and an open sketch", async ({ page }) => {
  await field(page, "Height").fill("44");
  await current(page);
  await orbit(page);
  const before = await camera(page);

  await page.keyboard.press("F11");
  await expect(app(page)).toHaveClass(/full-screen/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const exit = screen(page).getByRole("button", { name: "Exit full screen" });
  await expect(exit).toContainText("Exit full screen");
  await canvasFillsView(page);
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await expect(host(page)).toHaveAttribute("data-camera-view", "custom"); // not put back to a standard view
  await exit.click();
  await expect(app(page)).not.toHaveClass(/full-screen/);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  expect(await camera(page)).toEqual(before);
  await expect(field(page, "Height")).toHaveValue("44");

  // While sketching, F11 changes the screen and nothing else.
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await expect(page.getByTestId("sketch-editor")).toBeVisible();
  await page.keyboard.press("F11");
  await expect(app(page)).toHaveClass(/full-screen/);
  await expect(page.getByTestId("sketch-editor")).toBeVisible();
  await page.keyboard.press("F11");
  await expect(app(page)).not.toHaveClass(/full-screen/);
  await expect(page.getByTestId("sketch-editor")).toBeVisible();
});

test("Full screen and Focus canvas work on their own and together", async ({ page }) => {
  await screen(page).getByRole("button", { name: "Full screen" }).click();
  await page.keyboard.press("Control+0");
  await expect(app(page)).toHaveClass(/full-screen/);
  await expect(app(page)).toHaveClass(/\bfocus\b/);
  await canvasFillsView(page);
  await page.screenshot({ path: `${OUT}full-screen-focus.png` });
  await screen(page).getByRole("button", { name: "Exit full screen" }).click();
  await expect(app(page)).not.toHaveClass(/full-screen/);
  await expect(app(page)).toHaveClass(/\bfocus\b/); // leaving one leaves the other as it was
  await page.keyboard.press("Control+0");
  await expect(app(page)).not.toHaveClass(/\bfocus\b/);
  await expect(panel(page)).toBeVisible();
});
