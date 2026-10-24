import { expect, test, type Page } from "@playwright/test";

// The Threaded hole tool: click where the hole goes (Enter: the middle), then the Thread dialog picks the thread,
// the depth, the fit and a drill point. Cancel takes the hole back.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 90_000 });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Thread Hole 1" });
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
const cone = (r: number) => (Math.PI * r * r * (r / Math.tan((59 * Math.PI) / 180))) / 3;
const steps = (page: Page) => page.getByRole("list", { name: "Steps" }).locator(":scope > li");

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await field(page, "Wall thickness").blur();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
});

test("Threaded hole: place it, pick an M5 blind hole with a drill point, apply as one step", async ({ page }) => {
  await page.getByTestId("ribbon").getByRole("button", { name: "Threaded hole" }).click();
  await page.keyboard.press("Enter"); // in the middle of the part
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Size")).toHaveValue("M5");
  await dialog(page).getByRole("button", { name: "Cosmetic" }).click(); // the 4.2 mm tap drill, quick to build
  await dialog(page).getByRole("button", { name: "Blind" }).click();
  await field(page, "Hole depth").fill("12");
  await dialog(page).getByRole("checkbox", { name: "Drill point at the bottom" }).check();
  await page.screenshot({ path: `${OUT}threaded-hole-dialog.png` });
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await current(page);
  // The 4.2 mm tap drill 12 mm deep, and the 118° point below it.
  await expect(volume(page)).toHaveText(cm3(72000 - Math.PI * 2.1 ** 2 * 12 - cone(2.1)));
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("M5");
  await expect(page.getByRole("checkbox", { name: "Drill point at the bottom (118°)" })).toBeChecked();

  // Flat-bottomed again from its properties.
  await page.getByRole("checkbox", { name: "Drill point at the bottom (118°)" }).uncheck();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - Math.PI * 2.1 ** 2 * 12));
});

test("Cancel in the Threaded hole's dialog takes the hole back", async ({ page }) => {
  await page.getByTestId("ribbon").getByRole("button", { name: "Threaded hole" }).click();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(steps(page)).toHaveCount(2);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(steps(page)).toHaveCount(1);
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
  // A plain Hole afterwards is just a hole: no dialog.
  await page.getByTestId("ribbon").getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter");
  await expect(steps(page)).toHaveCount(2);
  await expect(dialog(page)).toHaveCount(0);
});
