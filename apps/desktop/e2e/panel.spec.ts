import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const steps = (page: Page) => page.getByRole("list", { name: "Steps" });
const step = (page: Page, name: string) => steps(page).getByRole("button", { name: new RegExp(`^${name}\\b`) });
const props = (page: Page) => page.getByTestId("properties");
const mode = (page: Page) => page.locator(".app");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("the panel lists every step on one line and shows the settings of one step at a time", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  // Box, hole and cylinder each have one line; only the new cylinder's settings are open.
  await expect(steps(page).getByRole("listitem")).toHaveCount(3);
  await expect(props(page)).toHaveAccessibleName("Cylinder 1 properties");
  await expect(field(page, "Hole 1 diameter")).toHaveCount(0);
  await expect(field(page, "Wall thickness")).toHaveCount(0);

  // Clicking a line shows that step instead.
  await step(page, "Hole 1").click();
  await expect(props(page)).toHaveAccessibleName("Hole 1 properties");
  await expect(field(page, "Hole 1 diameter")).toBeVisible();
  await expect(field(page, "Diameter")).toHaveCount(0); // the cylinder's are gone
  await page.screenshot({ path: `${OUT}panel-hole.png` });

  // No paragraphs of explanation: help is in tooltips, kept for screen readers.
  await step(page, "Box").click();
  await expect(page.locator(".panel .help")).toHaveCount(0);
  await expect(page.getByText("Width", { exact: true })).toHaveAttribute("title", /red X axis/);
});

test("rarely needed settings stay folded under More until asked for", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await page.getByLabel("Hole 1 thread").selectOption("M5");
  const fit = field(page, "Hole 1 fit clearance");
  await expect(fit).toBeHidden();
  await props(page).getByText("More").click();
  await expect(fit).toBeVisible();
  await expect(fit).toHaveValue("0.3");
});

test("a problem in a step that isn't open still shows on its line", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await field(page, "Hole 1 left / right position").fill("-29");
  await step(page, "Box").click();
  const row = page.getByTestId("hole");
  await expect(row).toHaveClass(/has-error/);
  await expect(row).toContainText("runs off the left edge");
});

test("the part's size is a measurement, not a box to type in", async ({ page }) => {
  const facts = page.getByTestId("measurements");
  await expect(facts).toHaveAccessibleName("Part size (measured)");
  await expect(facts.getByRole("textbox")).toHaveCount(0);
});

test("one mode at a time: picking a face doesn't select pieces, and Escape goes back", async ({ page }) => {
  await expect(mode(page)).toHaveAttribute("data-mode", "model");
  await page.getByRole("button", { name: "Sketch on a face" }).click();
  await expect(mode(page)).toHaveAttribute("data-mode", "pick-face");
  // Arrow keys don't move anything while picking; Escape stops picking.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(mode(page)).toHaveAttribute("data-mode", "model");
  await step(page, "Box").click();
  await expect(field(page, "Left / right")).toHaveValue("0");

  // The sketch screen owns the keys: Delete there doesn't remove the selected box.
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await expect(mode(page)).toHaveAttribute("data-mode", "sketch");
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(mode(page)).toHaveAttribute("data-mode", "model");
  await expect(page.getByTestId("shape")).toHaveCount(1);
});
