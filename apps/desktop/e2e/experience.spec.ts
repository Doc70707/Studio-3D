import { expect, test, type Page } from "@playwright/test";

// Kids, Easy and Advanced: picked at the first start, changed in Settings, kept on this computer. A mode only decides
// which tools are in view; the design, its steps and Undo are the same in all three.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const ribbon = (page: Page) => page.getByTestId("ribbon");
const welcome = (page: Page) => page.getByRole("dialog", { name: "Welcome to Studio 3D" });
const settings = (page: Page) => page.getByRole("dialog", { name: "Settings" });
const steps = (page: Page) => page.getByRole("list", { name: "Steps" }).locator(":scope > li");

async function pickMode(page: Page, mode: string) {
  await page.locator(".topbar").getByRole("button", { name: "Settings" }).click();
  await settings(page).getByRole("tab", { name: "Experience" }).click();
  await settings(page).getByRole("radio", { name: mode }).click();
  await settings(page).getByRole("button", { name: "Done" }).click();
  await expect(settings(page)).toHaveCount(0);
}

test.describe("the first start", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("asks Kids, Easy or Advanced, with Easy picked, and remembers the answer", async ({ page }) => {
    await page.goto("/");
    await expect(welcome(page)).toBeVisible();
    const easy = welcome(page).getByRole("radio", { name: "Easy" });
    await expect(easy).toHaveAttribute("aria-checked", "true");
    await expect(easy).toBeFocused();
    await expect(easy).toContainText("Recommended");
    await page.screenshot({ path: `${OUT}welcome.png` });

    // Arrow keys move between the three; Enter starts.
    await page.keyboard.press("ArrowRight");
    await expect(welcome(page).getByRole("radio", { name: "Advanced" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowRight");
    await expect(welcome(page).getByRole("radio", { name: "Kids" })).toHaveAttribute("aria-checked", "true");
    await expect(welcome(page).getByRole("button", { name: "Start in Kids" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(welcome(page)).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-experience", "kids");

    // Kids: a few big shape buttons, no menus, no command line, no AI helper.
    await current(page);
    await expect(ribbon(page).getByRole("button", { name: "Add box" })).toBeVisible();
    await expect(ribbon(page).getByRole("button", { name: "Add sphere" })).toBeVisible();
    await expect(ribbon(page).getByRole("button", { name: "Add tube" })).toHaveCount(0);
    await expect(ribbon(page).getByRole("button", { name: "Draw on the plate" })).toHaveCount(0);
    await expect(ribbon(page).getByRole("button", { name: "Fillet" })).toHaveCount(0);
    await expect(page.getByRole("menubar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Command line" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Blurry/ })).toHaveCount(0);
    await page.keyboard.press("Control+9");
    await expect(page.getByTestId("command-line")).toHaveCount(0);
    const box = (await ribbon(page).getByRole("button", { name: "Add box" }).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(76); // bigger buttons
    await page.screenshot({ path: `${OUT}kids-mode.png` });

    // Kept for next time: no question at the next start.
    await page.reload();
    await current(page);
    await expect(welcome(page)).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-experience", "kids");
  });

  test("starting with Easy keeps the everyday tools in the ribbon and the rest in the menus", async ({ page }) => {
    await page.goto("/");
    await welcome(page).getByRole("button", { name: "Start in Easy" }).click();
    await expect(welcome(page)).toHaveCount(0);
    await current(page);
    for (const name of ["Add box", "Add tube", "Add hole", "Draw on the plate", "Hollow out", "Fillet"])
      await expect(ribbon(page).getByRole("button", { name, exact: true }).first()).toBeVisible();
    for (const name of ["Revolve", "Chamfer", "Pattern", "Mirror"])
      await expect(ribbon(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    // One menu away.
    await page.getByRole("menubar").getByRole("menuitem", { name: "Modify", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /^Pattern/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Chamfer/ })).toBeVisible();
    await page.keyboard.press("Escape");
    // The command line is still there for whoever wants it.
    await page.keyboard.press("Control+9");
    await expect(page.getByTestId("command-line")).toBeVisible();
    await page.screenshot({ path: `${OUT}easy-mode.png` });
  });
});

test("switching mode keeps the design, its steps and Undo exactly as they were", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(welcome(page)).toHaveCount(0); // Advanced was picked before (see playwright.config.ts)
  await current(page);
  await ribbon(page).getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  await ribbon(page).getByRole("button", { name: "Pattern", exact: true }).click();
  await current(page);
  const before = await steps(page).allTextContents();
  expect(before.length).toBe(3);

  await pickMode(page, "Kids");
  await expect(ribbon(page).getByRole("button", { name: "Pattern", exact: true })).toHaveCount(0);
  await current(page);
  expect(await steps(page).allTextContents()).toEqual(before);

  // Undo still steps back through what was done in Advanced.
  await page.keyboard.press("Control+z");
  await current(page);
  await expect(steps(page)).toHaveCount(2);

  // Back in Advanced, Redo brings the pattern back.
  await pickMode(page, "Advanced");
  await page.keyboard.press("Control+y");
  await current(page);
  expect(await steps(page).allTextContents()).toEqual(before);
  await expect(ribbon(page).getByRole("button", { name: "Pattern", exact: true })).toBeVisible();
});

test("Cancel in Settings puts the mode back as it was", async ({ page }) => {
  await page.goto("/");
  await current(page);
  await page.keyboard.press("Control+,");
  await settings(page).getByRole("tab", { name: "Experience" }).click();
  await expect(settings(page).getByRole("radio", { name: "Advanced" })).toHaveAttribute("aria-checked", "true");
  await settings(page).getByRole("radio", { name: "Kids" }).click();
  await expect(page.getByRole("menubar")).toHaveCount(0); // shown at once
  await settings(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("menubar")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-experience", "advanced");
});
