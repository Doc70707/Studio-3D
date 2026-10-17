import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const card = (page: Page, name: string) => page.getByTestId("shape").filter({ hasText: name });
const bar = (page: Page) => page.getByTestId("selection-bar");

/** The middle of the part of the 3D view the panels don't cover, where the views centre the part. */
async function middle(page: Page) {
  const panel = (await page.locator("aside.panel").boundingBox())!;
  const top = (await page.locator("header.topbar").boundingBox())!;
  const status = (await page.locator("footer.statusbar").boundingBox())!;
  const view = (await host(page).boundingBox())!;
  return {
    x: (panel.x + panel.width + view.x + view.width) / 2,
    y: (top.y + top.height + status.y) / 2,
  };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block
  await page.getByRole("button", { name: "Add cylinder" }).click(); // stands on top, in the middle
  await current(page);
  await expect(bar(page)).toContainText("Cylinder 1"); // a new shape is picked, ready to move
  await bar(page).getByRole("button", { name: "Deselect" }).click();
  await expect(bar(page)).toBeHidden();
  await page.keyboard.press("1"); // top view: the cylinder is in the middle of the view
});

test("click a piece to select it, nudge it with the keys, drag its arrow, then remove it", async ({ page }) => {
  const m = await middle(page);
  await page.mouse.click(m.x, m.y);
  await expect(bar(page)).toContainText("Cylinder 1 · top face");
  await expect(card(page, "Cylinder 1")).toHaveClass(/picked/);
  await expect(card(page, "Cylinder 1")).toHaveClass(/open/); // its settings are ready to edit

  // Arrow keys move it 1 mm, Shift 10 mm; every move is one undo step.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(field(page, "Left / right")).toHaveValue("1");
  await expect(field(page, "Front / back")).toHaveValue("10");
  await current(page);
  await page.keyboard.press("Control+z");
  await expect(field(page, "Front / back")).toHaveValue("0");
  await current(page);

  // Drag the red (left/right) arrow to the right: the piece moves when it is let go.
  const p = await middle(page);
  await page.mouse.move(p.x + 1 + 60, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 1 + 90, p.y, { steps: 5 });
  await page.mouse.move(p.x + 1 + 120, p.y, { steps: 5 });
  await expect(bar(page)).toContainText(/Moving left\/right \+\d/);
  await page.screenshot({ path: `${OUT}select-move.png` });
  await page.mouse.up();
  await expect(bar(page)).not.toContainText("Moving");
  const x = Number(await field(page, "Left / right").inputValue());
  expect(x).toBeGreaterThan(3);
  await expect(field(page, "Front / back")).toHaveValue("0"); // only along the arrow
  await current(page);
  await page.keyboard.press("0"); // the 3D view, with the arrows on the selected piece
  await page.screenshot({ path: `${OUT}select.png` });

  // Delete removes it, and undo brings it back.
  await page.keyboard.press("Delete");
  await expect(card(page, "Cylinder 1")).toHaveCount(0);
  await expect(bar(page)).toBeHidden();
  await page.keyboard.press("Control+z");
  await expect(card(page, "Cylinder 1")).toHaveCount(1);
});

test("clicking the block picks the block; clicking empty space or Esc lets go", async ({ page }) => {
  const m = await middle(page);
  await page.mouse.click(m.x, m.y + 60); // the block's top, in front of the cylinder
  await expect(bar(page)).toContainText("Box");
  await expect(bar(page)).toContainText("top face");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeHidden();
  await page.mouse.click(m.x, m.y);
  await expect(bar(page)).toContainText("Cylinder 1");
  await page.mouse.click(m.x + 300, m.y + 200); // off the part
  await expect(bar(page)).toBeHidden();
});

test("sketch on a clicked face straight from the selection", async ({ page }) => {
  const m = await middle(page);
  await page.mouse.click(m.x, m.y + 60);
  await bar(page).getByRole("button", { name: "Sketch on this face" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
});

test("every shape can be removed, even the first one, leaving an empty plate", async ({ page }) => {
  const m = await middle(page);
  await page.mouse.click(m.x, m.y);
  await expect(bar(page)).toContainText("Cylinder 1");
  await page.keyboard.press("Delete");
  await current(page);
  await expect(card(page, "Cylinder 1")).toHaveCount(0);
  // The box was the shape the part started from; it can go too.
  await page.mouse.click(m.x, m.y);
  await expect(bar(page)).toContainText("Box");
  await expect(bar(page).getByRole("button", { name: "Remove" })).toBeEnabled();
  await bar(page).getByRole("button", { name: "Remove" }).click();
  await expect(host(page)).toHaveAttribute("data-geometry", "empty");
  await expect(page.getByTestId("shape")).toHaveCount(0);
  await expect(page.getByTestId("empty-plate")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export/ })).toBeDisabled();
  // A new part can be started from the empty plate, and undo brings the old one back.
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await expect(page.getByTestId("shape")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(host(page)).toHaveAttribute("data-geometry", "empty");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await current(page);
  await expect(card(page, "Box")).toHaveCount(1);
  await expect(card(page, "Cylinder 1")).toHaveCount(1);
});
