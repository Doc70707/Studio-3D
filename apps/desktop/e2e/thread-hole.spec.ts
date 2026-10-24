import { expect, test, type Page } from "@playwright/test";
import { threadProfile, threadVolume } from "../../../packages/document/src/threads";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const volume = (page: Page) => page.getByTestId("volume");
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(2)} cm³`;
// Threads take a few seconds to build, more on a slow test machine.
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 90_000 });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Thread Hole 1" });
const plain = 72000 - Math.PI * 2.5 ** 2 * 30;
const m5 = 72000 - threadVolume(threadProfile("M5", 0.3, false), 30);

test.describe.configure({ timeout: 300_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
  const wall = field(page, "Wall thickness");
  await wall.fill("0"); // a solid 60 × 40 × 30 block = 72000 mm³
  await wall.blur();
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await current(page);
  await expect(volume(page)).toHaveText(cm3(plain)); // a plain 5 mm hole through it
});

test("Thread this hole: a suggested size, a live preview, checks with a fix, and Cancel leaves the hole alone", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Thread this hole…" }).click();
  await expect(dialog(page)).toBeVisible();
  // The 5 mm hole is an M5 screw's size, so M5 is suggested, and it fits.
  await expect(dialog(page).getByLabel("Size")).toHaveValue("M5");
  await expect(page.getByTestId("thread-pitch")).toHaveText("0.8 mm pitch, Ø5 mm across the crests");
  await expect(page.getByTestId("thread-checks")).toContainText(
    "Fits: the Ø5 mm hole is the size of an M5 × 0.8 screw.",
  );
  // The 3D view already shows the real thread, before anything is applied.
  await current(page);
  await expect(volume(page)).toHaveText(cm3(m5));
  await page.screenshot({ path: `${OUT}thread-dialog.png` });

  // A size that doesn't suit the hole is explained, with the right one a click away.
  await dialog(page).getByLabel("Size").selectOption("M3");
  await expect(page.getByTestId("thread-checks")).toContainText("wider than the M3 × 0.5 thread's grooves");
  await dialog(page).getByRole("button", { name: "Use M5 × 0.8" }).click();
  await expect(dialog(page).getByLabel("Size")).toHaveValue("M5");

  // Cosmetic: a plain tap-drill hole (4.2 mm for M5), marked as a thread.
  await dialog(page).getByRole("button", { name: "Cosmetic" }).click();
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - Math.PI * 2.1 ** 2 * 30));
  await expect(page.getByTestId("thread-checks")).toContainText("printed as a plain Ø4.2 mm hole and marked M5 × 0.8");

  // A blind hole with a thread longer than it can't be applied.
  await dialog(page).getByRole("button", { name: "Blind" }).click();
  await dialog(page).getByRole("checkbox", { name: "Thread the whole hole" }).uncheck();
  await field(page, "Thread length").fill("12");
  await expect(page.getByTestId("thread-checks")).toContainText("The thread can't be longer than the hole: use 10 mm");
  await expect(dialog(page).getByRole("button", { name: "Apply" })).toBeDisabled();

  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await current(page);
  await expect(volume(page)).toHaveText(cm3(plain));
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("");
});

test("Apply a left-hand thread as one step: labelled, saved in the hole, and one undo takes it off", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Thread this hole…" }).click();
  await dialog(page).getByRole("button", { name: "Left-hand" }).click();
  await dialog(page).getByRole("button", { name: "Loose" }).click();
  await dialog(page).getByRole("button", { name: "Apply" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await current(page);
  await expect(volume(page)).toHaveText(cm3(72000 - threadVolume(threadProfile("M5", 0.5, false), 30)));
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("M5");
  await expect(field(page, "Hole 1 fit clearance")).toHaveValue("0.5");
  await expect(page.getByTestId("dimension").filter({ hasText: "M5 left-hand thread" })).toHaveCount(1);

  await page.locator("body").click({ position: { x: 5, y: 790 } }); // out of any box, so Ctrl+Z undoes a step
  await page.keyboard.press("Control+z");
  await current(page);
  await expect(volume(page)).toHaveText(cm3(plain));
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("");
});

test("right-click on a hole's rim offers Thread, which opens the same dialog", async ({ page }) => {
  await page.keyboard.press("1");
  await page.keyboard.press("5");
  await expect(host(page)).toHaveAttribute("data-camera-projection", "orthographic");
  // Find the hole's rim with the snaps: its centre, then a quadrant beside it.
  await page.keyboard.press("d");
  const view = (await host(page).boundingBox())!;
  const [top, left, bottom, right] = (await host(page).getAttribute("data-safe-area"))!.split(",").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const cx = view.x + (left + view.width - right) / 2;
  const cy = view.y + (top + view.height - bottom) / 2;
  const marker = page.getByTestId("snap3d");
  // The 5 mm hole is only a few pixels across at first: zoom in on it so its rim is clear of its centre.
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -200);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  let rim: { x: number; y: number } | null = null;
  // Upwards: the right-hand quadrant shares its spot with the hole wall's seam corner, which wins as an End.
  for (let dy = 0; dy < 300 && !rim; dy += 3) {
    await page.mouse.move(cx, cy - dy);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if ((await marker.count()) && (await marker.getAttribute("data-snap")) === "quadrant") {
      const b = (await marker.boundingBox())!;
      rim = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
  }
  expect(rim).not.toBeNull();
  await page.keyboard.press("Escape");
  await page.mouse.click(rim!.x, rim!.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "Right-click menu" });
  await expect(page.getByTestId("context-title")).toContainText("Circle, Ø5 mm of Hole 1");
  await menu.getByRole("menuitem", { name: "Thread Hole 1…" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Size")).toHaveValue("M5");
});
