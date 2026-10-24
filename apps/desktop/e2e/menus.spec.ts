import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const menu = (page: Page, name: string) =>
  page.getByRole("menubar").getByRole("menuitem", { name, exact: true });
const item = (page: Page, name: string) => page.getByRole("menu").getByRole("menuitem", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("the menu bar has the usual desktop menus, and Create adds real shapes", async ({ page }) => {
  for (const name of ["File", "Edit", "View", "Create", "Modify", "Help"]) await expect(menu(page, name)).toBeVisible();
  await menu(page, "Create").click();
  await expect(page.getByRole("menu", { name: "Create" })).toBeVisible();
  await page.waitForTimeout(300); // let it fade in
  await page.screenshot({ path: `${OUT}menu-create.png` });
  await item(page, "Cylinder").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await current(page);
  await expect(page.getByTestId("shape").filter({ hasText: "Cylinder 1" })).toHaveCount(1);
  await expect(page.getByTestId("selection-bar")).toContainText("Cylinder 1");

  // Edit > Undo takes it away again; Modify > Hollow out works once, then says why it's greyed out.
  await menu(page, "Edit").click();
  await item(page, "Undo").click();
  await expect(page.getByTestId("shape").filter({ hasText: "Cylinder 1" })).toHaveCount(0);
  await page.getByLabel("Wall thickness", { exact: true }).fill("0"); // a solid block to hollow
  await current(page);
  await menu(page, "Modify").click();
  await item(page, "Hollow out").click();
  await current(page);
  await expect(page.getByRole("button", { name: "Remove Hollow 1" })).toBeVisible();
  await menu(page, "Modify").click();
  await expect(item(page, "Hollow out")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "Hollow out")).toHaveAttribute("title", /already hollowed/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("menus work from the keyboard: Alt + letter, arrows, Enter, Escape", async ({ page }) => {
  await page.keyboard.press("Alt+v");
  await expect(page.getByRole("menu", { name: "View" })).toBeVisible();
  await expect(item(page, "3D view")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // Top view
  await page.keyboard.press("Enter");
  await expect(host(page)).toHaveAttribute("data-camera-view", "top");
  // Right arrow moves to the next menu; Escape closes and leaves the focus on the menu bar.
  await page.keyboard.press("Alt+v");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("menu", { name: "Create" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menu(page, "Create")).toBeFocused();
  // View > Show sizes is a check item that follows the M key.
  await page.keyboard.press("Alt+v");
  await expect(page.getByRole("menuitemcheckbox", { name: "Show sizes" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemcheckbox", { name: "Show sizes" }).click();
  await expect(page.getByRole("button", { name: "Sizes" })).toHaveAttribute("aria-pressed", "false");
});

test("File menu matches the toolbar, and Export is greyed out on an empty plate", async ({ page }) => {
  await menu(page, "File").click();
  await expect(item(page, "Export STL…")).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await menu(page, "Edit").click();
  await expect(item(page, "Delete")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Remove Box" }).click();
  await expect(host(page)).toHaveAttribute("data-geometry", "empty");
  await menu(page, "File").click();
  await expect(item(page, "Export STL…")).toHaveAttribute("aria-disabled", "true");
  await item(page, "Export STL…").click({ force: true }); // does nothing
  await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
  // Clicking elsewhere closes the menu.
  await page.mouse.click(700, 500);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Help lists the keyboard and mouse controls, and About shows the version", async ({ page }) => {
  await menu(page, "Help").click();
  await item(page, "Keyboard and mouse").click();
  const dialog = page.getByRole("dialog", { name: "Keyboard and mouse" });
  await expect(dialog).toContainText("Wheel-drag, or right-drag");
  await expect(dialog).toContainText("Type the number, Tab to the next box, Enter");
  await page.screenshot({ path: `${OUT}help-shortcuts.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await menu(page, "Help").click();
  await item(page, "About Studio 3D").click();
  await expect(page.getByRole("dialog", { name: "About Studio 3D" })).toContainText(/Version \d+\.\d+\.\d+/);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
