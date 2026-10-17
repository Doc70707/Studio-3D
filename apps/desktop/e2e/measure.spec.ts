import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const labels = (page: Page) => page.getByTestId("dimension");
const texts = async (page: Page) => (await labels(page).allTextContents()).sort();

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("the part's overall size is labelled in the 3D view, and Sizes turns it off and on", async ({ page }) => {
  await expect(labels(page)).toHaveCount(3);
  expect(await texts(page)).toEqual(["30 mm", "40 mm", "60 mm"]);
  for (const l of await labels(page).all()) await expect(l).toBeVisible();

  await page.getByRole("button", { name: "Sizes" }).click();
  await expect(labels(page)).toHaveCount(0);
  await page.keyboard.press("m");
  await expect(labels(page)).toHaveCount(3);
});

test("labels follow the design when a size changes", async ({ page }) => {
  await page.getByLabel("Width", { exact: true }).fill("75");
  await current(page);
  await expect(labels(page).filter({ hasText: /^75 mm$/ })).toHaveCount(1);
});

test("the selected shape shows its size and where it sits", async ({ page }) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  await current(page);
  // Overall 60 × 40 × 50, plus the cylinder: 20 × 20 × 20, 20 mm from the left and 10 from the front, lifted 30.
  expect(await texts(page)).toEqual(["10 mm", "20 mm", "20 mm", "20 mm", "20 mm", "30 mm", "40 mm", "50 mm", "60 mm"]);
  await page.screenshot({ path: `${OUT}measure-shape.png` });
});

test("a hole shows its diameter and distance from the edges when it's being edited", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.getByLabel("Hole 1 left / right position").fill("-15");
  await current(page);
  await expect(labels(page).filter({ hasText: "Ø5 mm" })).toHaveCount(1);
  await expect(labels(page).filter({ hasText: /^15 mm$/ })).toHaveCount(1); // from the left edge
  await expect(labels(page).filter({ hasText: /^20 mm$/ })).toHaveCount(1); // from the front edge
  await page.screenshot({ path: `${OUT}measure-hole.png` });
});

test("the status bar says where the pointer is on the part", async ({ page }) => {
  await page.getByRole("button", { name: "Top", exact: true }).click();
  const panel = (await page.locator(".panel").boundingBox())!;
  const top = (await page.locator(".topbar").boundingBox())!;
  const status = (await page.locator(".statusbar").boundingBox())!;
  const vp = page.viewportSize()!;
  await page.mouse.move((panel.x + panel.width + vp.width) / 2, (top.y + top.height + status.y) / 2);
  // Looking down into the open box, the pointer is on its floor, 2 mm up.
  await expect(page.getByTestId("pointer-readout")).toContainText("left/right 0.0 · front/back 0.0 · height 2.0 mm");
  await page.mouse.move(vp.width - 40, top.y + top.height + 40); // over empty plate
  await expect(page.getByTestId("pointer-readout")).toHaveText("");
});

test("the standard views frame the part, not the whole plate, so its sizes are readable", async ({ page }) => {
  const canvas = (await page.getByTestId("viewport-canvas").boundingBox())!;
  await expect(labels(page)).toHaveCount(3);
  const measure = async () => Promise.all((await labels(page).all()).map((l) => l.boundingBox()));
  const spread = async () => {
    const xs = (await measure()).flatMap((b) => [b!.x, b!.x + b!.width]);
    return Math.max(...xs) - Math.min(...xs);
  };
  // The labels spread over a good part of the screen rather than bunching on a tiny part. Under load the first
  // frames can still be framing the part, so wait for the view to settle rather than reading it once.
  await expect.poll(spread).toBeGreaterThan(canvas.width * 0.2);
  const boxes = await measure();
  // And none of them cover each other.
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
});
