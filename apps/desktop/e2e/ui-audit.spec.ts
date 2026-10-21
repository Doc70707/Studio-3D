import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { findLayoutProblems, type LayoutProblem } from "./support/layout";

// Walks through the app's main screens at four window sizes and checks that no text is cut off, sticks out of its
// panel, sits on other text or hangs off the window (see support/layout.ts). Screenshots go to test-output to look at.
const OUT = new URL("../../../test-output/ui-audit/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");

const SIZES = [
  [1024, 640],
  [1280, 800],
  [1366, 768],
  [1920, 1080],
] as const;

const found: Record<string, LayoutProblem[]> = {};
async function look(page: Page, name: string) {
  await page.waitForTimeout(250);
  const size = page.viewportSize()!;
  const key = `${size.width}x${size.height} ${name}`;
  found[key] = await findLayoutProblems(page);
  await page.screenshot({ path: `${OUT}${size.width}-${name}.png` });
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}problems.json`, JSON.stringify(found, null, 1));
});

for (const [width, height] of SIZES)
  test(`audit at ${width}×${height}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await current(page);
    await look(page, "start");
    await page.getByRole("button", { name: "Add cylinder" }).click();
    await current(page);
    await page.getByLabel("Cylinder 1 thread").selectOption("M8");
    await current(page);
    await look(page, "threaded-cylinder");
    await page.getByRole("button", { name: "Add hole" }).click();
    await current(page);
    await page.getByLabel("Hole 1 diameter", { exact: true }).fill("12.3456789");
    await current(page);
    await look(page, "hole-long-number");
    await page.getByRole("button", { name: "Thread this hole…" }).click();
    await look(page, "thread-dialog");
    await page.getByRole("dialog", { name: "Thread Hole 1" }).getByRole("button", { name: "Cancel" }).click();
    // The dialog's preview of an M12 thread may still be building; it is dropped once done.
    await expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 120_000 });
    await page.getByRole("menubar").getByRole("menuitem", { name: "File", exact: true }).click();
    await look(page, "file-menu");
    await page.keyboard.press("Escape");
    await page.locator(".topbar").getByRole("button", { name: "Appearance" }).click();
    await look(page, "appearance");
    await page.getByRole("radio", { name: "Light" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await look(page, "light");
    await page.getByRole("button", { name: "Print Studio" }).click();
    await page.getByRole("button", { name: "Slice", exact: true }).click();
    await expect(page.getByTestId("slice-result")).toBeVisible({ timeout: 60_000 });
    await look(page, "print-sliced");
    await page.getByRole("button", { name: "Back to design" }).click();
    await page.getByRole("button", { name: "Draw on the plate" }).click();
    await page.getByRole("button", { name: "Outline tool" }).click();
    await look(page, "sketch-outline");
    await page.getByRole("button", { name: "Snaps", exact: true }).click();
    await look(page, "sketch-snaps");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rectangle tool" }).click();
    const c = page.getByTestId("sketch-canvas");
    const b = (await c.boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.4);
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.6);
    await look(page, "sketch-shape");
    // The right-click menu near the bottom-right corner: it must open inside the drawing and fit.
    await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30, { button: "right" });
    await expect(page.getByRole("menu", { name: "Right-click menu" })).toBeVisible();
    await look(page, "sketch-menu");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel" }).click();
    for (const shape of ["Add box", "Add tube", "Add cone", "Add sphere"]) {
      await page.getByRole("button", { name: shape }).click();
      await current(page);
    }
    await look(page, "many-steps");
    const v = (await page.getByTestId("viewport-canvas").boundingBox())!;
    await page.mouse.click(v.x + v.width / 2, v.y + v.height / 2, { button: "right" });
    await expect(page.getByRole("menu", { name: "Right-click menu" })).toBeVisible();
    await look(page, "menu-3d");
    await page.getByRole("menuitem", { name: "Measure from here" }).click();
    await page.mouse.click(v.x + v.width / 2 + 60, v.y + v.height / 2 + 40);
    await expect(page.getByTestId("measure-result")).toBeVisible();
    await look(page, "measuring");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "View", exact: true }).click();
    await page
      .getByTestId("ribbon")
      .getByRole("button", { name: /Floating/ })
      .click();
    await look(page, "floating");
    // The command line with its list of matches open, between the palettes and over the status bar.
    await page.keyboard.press("Control+9");
    await page.getByTestId("command-line").getByRole("combobox").fill("round the edges");
    await expect(page.getByRole("listbox", { name: "Matching commands" })).toBeVisible();
    await look(page, "command-line");
    const here = Object.entries(found).filter(([k, v]) => k.startsWith(`${width}x${height} `) && v.length);
    expect(Object.fromEntries(here)).toEqual({});
  });
