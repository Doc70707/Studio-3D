import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.getByRole("dialog", { name: "Blurry" });
const steps = (page: Page) => page.getByRole("complementary", { name: "Browser" }).getByRole("listitem");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("Blurry opens from the status bar, explains how to thread a hole, and adds the hole when asked", async ({
  page,
}) => {
  // Nothing of his is over the 3D view until asked: his button is in the status bar.
  await expect(page.locator("footer.statusbar").getByRole("button", { name: "Ask Blurry" })).toBeVisible();
  const before = Number((await host(page).getAttribute("data-safe-area"))!.split(",")[3]);
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("Hi, I'm Blurry");
  // Open, his panel takes a column on the right and the part slides over, clear of it.
  const right = async () => Number((await host(page).getAttribute("data-safe-area"))!.split(",")[3]);
  await expect.poll(right).toBeGreaterThan(before + 300);
  const box = (await panel(page).boundingBox())!;
  const view = (await host(page).boundingBox())!;
  expect(view.x + view.width - (await right())).toBeLessThanOrEqual(box.x + 1);

  await panel(page).getByRole("button", { name: "How do I thread a hole?" }).click();
  await expect(panel(page).getByRole("listitem").first()).toContainText("Add a hole");
  await page.screenshot({ path: `${OUT}blurry-thread.png` });
  // His button runs the real command: an ordinary step, in the list like any other.
  await panel(page).getByRole("button", { name: "Hole Home › Shapes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "where the hole goes" })).toBeVisible();
  await page.keyboard.press("Enter"); // in the middle of the part
  await expect(steps(page).filter({ hasText: "Hole 1" })).toHaveCount(1);
  await expect(panel(page)).toContainText("Done: Hole. Ctrl+Z takes it back.");
  await current(page);

  // Plain words find commands too.
  await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill("make a cube");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: "Box Home › Shapes", exact: true })).toBeVisible();

  // Esc puts him away; Ctrl+K brings him back, and again puts him away.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(panel(page)).toHaveCount(0);
});

test("Blurry answers honestly when he doesn't know, and keeps out of the way while sketching", async ({ page }) => {
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill("what is the weather");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("I don't know that one yet");
  await page.getByRole("button", { name: "Close Blurry" }).first().click();
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await expect(page.getByTestId("blurry")).toHaveCount(0);
});
