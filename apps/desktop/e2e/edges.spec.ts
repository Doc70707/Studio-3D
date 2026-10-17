import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  await field(page, "Wall thickness").fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await current(page);
});

test("round the upright edges of a block, then make them rounder", async ({ page }) => {
  await page.getByRole("button", { name: "Fillet", exact: true }).click();
  await current(page);
  const card = page.getByTestId("edge-step");
  await expect(card).toContainText("Fillet 1");
  await card.getByLabel("Edges").selectOption("vertical");
  await field(page, "Fillet 1 size").fill("5");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 4 * (1 - Math.PI / 4) * 25 * 30));
  await expect(page.getByTestId("measurements")).toContainText("60 × 40 × 30 mm");
  await page.screenshot({ path: `${OUT}fillet.png` });

  // Too big is explained, and the last good part stays on screen.
  await field(page, "Fillet 1 size").fill("25");
  await expect(card.getByRole("alert")).toContainText("try a smaller size");
  await expect(volume(page)).toHaveText(cm3(72000 - 4 * (1 - Math.PI / 4) * 25 * 30));
  await page.getByRole("button", { name: "Undo" }).click();
  await current(page);
});

test("Modify > Chamfer bevels the bottom edges, and removing it makes them sharp again", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "Modify", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Chamfer (bevel edges)" }).click();
  await current(page);
  await field(page, "Chamfer 1 size").fill("1");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - 0.5 * 2 * (60 - 2 / 3 + 40 - 2 / 3)));
  await page.getByRole("button", { name: "Remove Chamfer 1" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000));
});

test("a fillet is saved with the project and comes back when it is opened", async ({ page }) => {
  await page.getByRole("button", { name: "Fillet", exact: true }).click();
  await field(page, "Fillet 1 size").fill("2");
  await current(page);
  const shown = await volume(page).innerText();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project" }).click();
  const file = await (await download).path();
  await page.getByRole("button", { name: "New" }).click();
  await current(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(file);
  await current(page);
  await expect(page.getByTestId("edge-step")).toContainText("Fillet 1");
  await expect(volume(page)).toHaveText(shown);
});
