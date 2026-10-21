import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.getByRole("dialog", { name: "Appearance" });
const open = (page: Page) => page.locator(".topbar").getByRole("button", { name: "Appearance" }).click();
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

test("Appearance changes the theme, the accent and the part's colour at once, and keeps them", async ({ page }) => {
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

  // Default colours puts all three back.
  await open(page);
  await panel(page).getByRole("button", { name: "Default colours" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  expect(await cssVar(page, "--accent")).toBe("#5ea8ff");
  await expect(panel(page).getByRole("radio", { name: "Sky blue" })).toHaveAttribute("aria-checked", "true");
});

test("the colours can be picked from the keyboard, and Escape or a click outside closes the panel", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "View", exact: true }).click();
  await page.getByTestId("ribbon").getByRole("button", { name: "Appearance" }).click();
  await expect(panel(page)).toBeVisible();
  // The chosen theme has the focus; arrow keys move along the choices and pick as they go.
  await expect(panel(page).getByRole("radio", { name: "Midnight" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByRole("radio", { name: "Graphite" })).toHaveAttribute("aria-checked", "true");
  await expect(panel(page).getByRole("radio", { name: "Graphite" })).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await page.getByRole("menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Appearance…" }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByTestId("browser").click({ position: { x: 20, y: 200 } });
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
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
