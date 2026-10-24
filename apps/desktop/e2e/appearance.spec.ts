import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const open = (page: Page) => page.locator(".topbar").getByRole("button", { name: "Settings" }).click();
const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
/** The view publishes its camera after drawing the next frame; wait for it so a read isn't one frame old. */
const settled = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The average colour of a small patch in the middle of the 3D view's open area, where the part sits in top view. */
async function partColour(page: Page): Promise<[number, number, number]> {
  await settled(page);
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const x = Math.round(view.x + (left + view.width - right) / 2);
  const y = Math.round(view.y + (top + view.height - bottom) / 2);
  const png = await page.screenshot({ clip: { x: x - 4, y: y + 6, width: 8, height: 8 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    return sum.map((v) => Math.round(v / (d.length / 4))) as [number, number, number];
  }, png.toString("base64"));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("Settings changes the theme, the accent and the part's colour at once, and keeps them", async ({ page }) => {
  test.setTimeout(90_000); // it rebuilds the part after a restart, which a busy test machine can take a while over
  await page.keyboard.press("1"); // top view: the part fills the middle of the view
  const blue = await partColour(page);
  expect(blue[2]).toBeGreaterThan(blue[0] + 40); // the default sky-blue part

  await open(page);
  await expect(panel(page).getByRole("radio", { name: "Midnight" })).toHaveAttribute("aria-checked", "true");
  await panel(page).getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await cssVar(page, "--text")).toBe("#111827");
  expect(await cssVar(page, "--chrome")).toBe("#f6f7f9");

  await panel(page).getByRole("radio", { name: "Coral" }).click();
  expect(await cssVar(page, "--accent")).toBe("#b1361c"); // coral worked out for a light theme
  await panel(page).getByRole("radio", { name: "Orange" }).click();
  await panel(page).getByRole("button", { name: "Done" }).click();
  await expect(panel(page)).toHaveCount(0);
  const orange = await partColour(page);
  expect(orange[0]).toBeGreaterThan(orange[2] + 60); // the part is drawn orange now

  // Restarting brings the same colours back, before anything is drawn.
  await page.reload();
  await current(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await cssVar(page, "--accent")).toBe("#b1361c");
  await page.keyboard.press("1");
  const again = await partColour(page);
  expect(again[0]).toBeGreaterThan(again[2] + 60);

  // Reset puts all three back.
  await open(page);
  await panel(page).getByRole("button", { name: "Reset appearance" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  expect(await cssVar(page, "--accent")).toBe("#5ea8ff");
  await expect(panel(page).getByRole("radio", { name: "Sky blue" })).toHaveAttribute("aria-checked", "true");
});

test("Settings works from the keyboard: arrows pick, Escape cancels every change, Done keeps them", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "View", exact: true }).click();
  await page.getByTestId("ribbon").getByRole("button", { name: "Settings" }).click();
  await expect(panel(page)).toBeVisible();
  // The open category has the focus; up and down move between categories.
  const appearance = panel(page).getByRole("tab", { name: "Appearance" });
  await expect(appearance).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(panel(page).getByRole("tab", { name: "Viewport and grid" })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByRole("tab", { name: "Viewport and grid" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(appearance).toHaveAttribute("aria-selected", "true");

  // Arrow keys move along the choices and pick as they go, shown on the app at once.
  await panel(page).getByRole("radio", { name: "Midnight" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByRole("radio", { name: "Graphite" })).toHaveAttribute("aria-checked", "true");
  await expect(panel(page).getByRole("radio", { name: "Graphite" })).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  // A change in another category, then Escape: everything goes back as it was.
  await panel(page).getByRole("tab", { name: "Units" }).click();
  await panel(page).getByRole("radio", { name: "Inches", exact: true }).click();
  await expect(page.getByTestId("dimension").first()).toContainText("in");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await expect(page.getByTestId("dimension").first()).toContainText("mm");

  // Ctrl+, opens it too; clicking the app behind leaves it open, so the view can be turned to judge a change.
  await page.keyboard.press("Control+,");
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("radio", { name: "Graphite" }).click();
  await page.getByTestId("browser").click({ position: { x: 20, y: 200 } });
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Done" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");

  // And from the View menu, as Settings…
  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings…" }).click();
  await expect(panel(page)).toBeVisible();
});

test("Settings' other categories change the snaps, the workspace and the density, and Reset puts one back", async ({
  page,
}) => {
  await open(page);
  await panel(page).getByRole("tab", { name: "Snaps and navigation" }).click();
  const midpoint = panel(page).getByRole("checkbox", { name: "Middle" });
  await expect(midpoint).toBeChecked();
  await midpoint.uncheck();
  await panel(page).getByRole("radio", { name: "Snaps off" }).click();
  await expect(midpoint).toBeDisabled();
  await expect(panel(page).getByText("Undo / Redo")).toBeVisible(); // the mouse and keys list

  await panel(page).getByRole("tab", { name: "Workspace" }).click();
  await panel(page).getByRole("radio", { name: "Compact" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await panel(page).getByRole("radio", { name: "Shown" }).click();
  await expect(page.getByTestId("command-line")).toBeVisible();
  await panel(page).getByRole("button", { name: "Reset workspace" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  await expect(page.getByTestId("command-line")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Done" }).click();

  // The snaps were kept: off, and without midpoints, until put back.
  await open(page);
  await panel(page).getByRole("tab", { name: "Snaps and navigation" }).click();
  await expect(panel(page).getByRole("radio", { name: "Snaps off" })).toHaveAttribute("aria-checked", "true");
  await expect(midpoint).not.toBeChecked();
  await panel(page).getByRole("button", { name: "Reset snaps and navigation" }).click();
  await expect(midpoint).toBeChecked();
  await expect(panel(page).getByRole("radio", { name: "Snaps on" })).toHaveAttribute("aria-checked", "true");
});

test("with a piece picked, only its own sizes are labelled, so the labels don't crowd", async ({ page }) => {
  const labels = page.getByTestId("dimension");
  await expect(labels).toHaveCount(3); // the part's overall size
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await expect(labels.filter({ hasText: /^20 mm$/ }).first()).toBeVisible(); // its diameter and height
  await expect(labels.filter({ hasText: /^60 mm$/ })).toHaveCount(0); // the part's width is in Properties
  // Picking the box shows the box's own sizes in place of the cylinder's.
  await page.getByTestId("browser").getByRole("button", { name: /^Box/ }).click();
  await expect(labels).toHaveCount(3);
  expect((await labels.allTextContents()).sort()).toEqual(["30 mm", "40 mm", "60 mm"]);
});
