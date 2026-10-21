import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const line = (page: Page) => page.getByTestId("command-line");
const input = (page: Page) => line(page).getByRole("combobox");
const steps = (page: Page) => page.getByRole("complementary", { name: "Browser" }).getByRole("listitem");

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

/** A solid 60 × 40 × 30 block, seen straight down without perspective. */
async function topView(page: Page) {
  const wall = page.getByLabel("Wall thickness", { exact: true });
  await wall.fill("0");
  await wall.blur(); // so the view keys reach the view, not the box
  await current(page);
  await page.keyboard.press("1");
  await page.keyboard.press("5");
  await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");
}

/** Moves the pointer right from the middle of the view until it is over an edge; returns where. */
async function findEdge(page: Page, middle: string) {
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const y = view.y + top + (view.height - top - bottom) / 2;
  const x0 = view.x + left + (view.width - left - right) / 2;
  const x1 = view.x + view.width - right - 10;
  for (let x = x0; x < x1; x += 3) {
    await page.mouse.move(x, y);
    if ((await host(page).getAttribute("data-edge-hover")) === middle) return { x, y };
  }
  throw new Error(`no edge with its middle at ${middle}`);
}

test("Ctrl+9 shows the command line; typing finds Fillet by name and shows where it lives; the radius is asked for", async ({
  page,
}) => {
  const wall = page.getByLabel("Wall thickness", { exact: true });
  await wall.fill("0"); // a solid block, so every edge can take a 2 mm round
  await current(page);
  await expect(line(page)).toHaveCount(0);
  await page.keyboard.press("Control+9");
  await expect(line(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Command line", exact: true })).toHaveAttribute("aria-pressed", "true");

  await input(page).click();
  await page.keyboard.type("fil");
  const first = line(page).getByRole("option").first();
  await expect(first).toContainText("Fillet");
  await expect(first).toContainText("FILLET");
  await expect(first).toContainText("Home › Modify");
  await page.screenshot({ path: `${OUT}command-line-suggestions.png` });
  await page.keyboard.press("Enter");

  // A fillet step is added, and its radius is asked for right there, with the default kept on Enter.
  await expect(steps(page).filter({ hasText: "Fillet 1" })).toHaveCount(1);
  await expect(line(page)).toContainText("Fillet radius <1 mm>:");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Fillet 1 size", { exact: true })).toHaveValue("2");
  await expect(page.getByTestId("command-said")).toHaveText("Fillet radius 2 mm");
  await current(page);

  // Everyday words work too, and a lone letter only runs a command called just that.
  await input(page).fill("make it hollow");
  await expect(line(page).getByRole("option").first()).toContainText("Hollow out");
  await input(page).fill("s");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("command-said")).toHaveText("Type more of the name, or pick one from the list.");

  // Hidden again from its own button; the choice is remembered.
  await line(page).getByRole("button", { name: "Hide the command line" }).click();
  await expect(line(page)).toHaveCount(0);
  await page.reload();
  await current(page);
  await expect(line(page)).toHaveCount(0);
});

test("click an edge, type FILLET: just that edge is rounded, by the radius typed", async ({ page }) => {
  await topView(page);
  // The block's right side, seen from above: its top edge (the bottom one is hidden behind the block).
  const at = await findEdge(page, "30,0,30");
  await page.mouse.click(at.x, at.y);
  await expect(host(page)).toHaveAttribute("data-edge-picks", "30,0,30");
  await expect(page.getByTestId("edge-bar")).toContainText("1 edge picked");

  await page.keyboard.press("Control+9");
  // Typing over the view goes to the command line, as in AutoCAD.
  await host(page).hover();
  await page.keyboard.type("FILLET");
  await expect(input(page)).toHaveValue("FILLET");
  await page.keyboard.press("Enter");
  await expect(line(page)).toContainText("Fillet radius <1 mm>:");
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");
  await current(page);

  // The step is on the picked edge only: 60 × 40 × 30 less a 3 mm round along one 40 mm edge.
  await expect(page.getByLabel("Edges", { exact: true })).toHaveValue("picked");
  await expect(page.getByTestId("edge-bar")).toHaveCount(0);
  const removed = 9 * (1 - Math.PI / 4) * 40;
  await expect(page.getByTestId("volume")).toHaveText(`${((72000 - removed) / 1000).toFixed(2)} cm³`);
  await page.screenshot({ path: `${OUT}command-line-edge-fillet.png` });
});

test("picked edges can be let go, and the bar's Chamfer works on them without the command line", async ({ page }) => {
  await topView(page);
  const at = await findEdge(page, "30,0,30");
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("edge-bar")).toBeVisible();
  // A second click lets it go; Esc lets go of all of them.
  await page.mouse.click(at.x, at.y);
  await expect(host(page)).toHaveAttribute("data-edge-picks", "");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("edge-bar")).toHaveCount(0);

  await page.mouse.click(at.x, at.y);
  await page.getByTestId("edge-bar").getByRole("button", { name: "Chamfer" }).click();
  await current(page);
  await expect(page.getByLabel("Edges", { exact: true })).toHaveValue("picked");
  // A 0.6 mm chamfer along one 40 mm edge.
  await expect(page.getByTestId("volume")).toHaveText(`${((72000 - 0.18 * 40) / 1000).toFixed(2)} cm³`);
});

test("typed commands: BOX adds a box, Enter on an empty line repeats it, REC and CIRCLE start a sketch with that tool", async ({
  page,
}) => {
  await page.keyboard.press("Control+9");
  await input(page).fill("box");
  await page.keyboard.press("Enter");
  await expect(steps(page).filter({ hasText: "Box 1" })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(steps(page).filter({ hasText: "Box 2" })).toHaveCount(1);

  await input(page).fill("REC");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("sketch-editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rectangle tool" })).toHaveAttribute("aria-pressed", "true");
  // The command line stays while drawing, with the sketch's own commands.
  await expect(line(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await input(page).fill("c");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Circle tool" })).toHaveAttribute("aria-pressed", "true");
});
