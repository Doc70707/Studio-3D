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
  // Only the cylinder's own sizes: Ø20 (once, not as a width and a depth) × 20 high, 20 mm from the left and 10 from
  // the front, lifted 30. The part's overall size stays in Properties, so the labels don't crowd each other.
  expect(await texts(page)).toEqual(["10 mm", "20 mm", "20 mm", "30 mm", "Ø20 mm"]);
  await page.screenshot({ path: `${OUT}measure-shape.png` });
});

test("a hole shows its diameter and distance from the edges when it's being edited", async ({ page }) => {
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await page.getByLabel("Hole 1 left / right position").fill("-15");
  await current(page);
  await expect(labels(page).filter({ hasText: "Ø5 mm" })).toHaveCount(1);
  await expect(labels(page).filter({ hasText: /^15 mm$/ })).toHaveCount(1); // from the left edge
  await expect(labels(page).filter({ hasText: /^20 mm$/ })).toHaveCount(1); // from the front edge
  await page.screenshot({ path: `${OUT}measure-hole.png` });
});

test("the status bar says where the pointer is on the part", async ({ page }) => {
  await page.getByRole("button", { name: "Top", exact: true }).click();
  const view = (await page.locator("main.viewport-host").boundingBox())!;
  const [top, left, bottom, right] = (await page.locator("main.viewport-host").getAttribute("data-safe-area"))!
    .split(",")
    .map(Number) as [number, number, number, number];
  await page.mouse.move(view.x + (left + view.width - right) / 2, view.y + (top + view.height - bottom) / 2);
  // Looking down into the open box, the pointer is on its floor, 2 mm up.
  await expect(page.getByTestId("pointer-readout")).toHaveText("X 0.00   Y 0.00   Z 2.00 mm");
  await page.mouse.move(view.x + left + 40, view.y + top + 40); // over empty plate
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
