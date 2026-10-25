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
  await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill("measure the distance");
  await page.keyboard.press("Enter");
  await expect(
    panel(page)
      .getByRole("button", { name: /^Measure/ })
      .first(),
  ).toBeVisible();

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

test("without Claude, Blurry makes simple things he's asked for, and takes back what doesn't build", async ({
  page,
}) => {
  const say = async (text: string) => {
    await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill(text);
    await page.keyboard.press("Enter");
  };
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  await say("add a cylinder 12 wide and 10 tall"); // stood on the part's top, where it shows
  const reply = panel(page).getByTestId("blurry-says").last();
  await expect(reply).toContainText("Done.");
  await expect(reply).toContainText("The part is now 60 mm wide, 40 mm deep, 40 mm tall.");
  await expect(reply.getByRole("list", { name: "What Blurry did" })).toContainText("Added Cylinder 1");
  await expect(steps(page).filter({ hasText: "Cylinder 1" })).toHaveCount(1);
  await current(page);
  await page.screenshot({ path: `${OUT}blurry-offline-make.png` });

  // A cut bigger than the part can't be built: he says so, shows it as not done, and the part is left as it was.
  await say("cut a 300 mm cube");
  const no = panel(page).getByTestId("blurry-says").last();
  await expect(no).toContainText("didn't build with that, so I took it back");
  await expect(no.locator("li.failed")).toContainText("would cut away the whole part");
  await expect(steps(page)).toHaveCount(2);
  await current(page);

  // A question still gets the how-to, not a guess.
  await say("how do I round the edges?");
  await expect(panel(page).getByTestId("blurry-says").last()).toContainText("Here's how to");

  await panel(page).getByRole("button", { name: "Close Blurry" }).click();
  await page.keyboard.press("Control+z"); // the cylinder, in one step
  await expect(steps(page).filter({ hasText: "Cylinder 1" })).toHaveCount(0);
});

test("Blurry glows in the accent colour picked in Settings, at once, on light and dark themes", async ({ page }) => {
  const glow = () =>
    page
      .locator("footer.statusbar .blurry-face .blurry-body > g[filter] > g")
      .first()
      .evaluate((g) => getComputedStyle(g).stroke);
  const glowsIn = (rgb: string) => expect.poll(glow).toBe(rgb);
  await glowsIn("rgb(94, 168, 255)"); // blue
  await page.locator(".topbar").getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("radio", { name: "Coral" }).click();
  await glowsIn("rgb(255, 148, 128)");
  // On a light theme he keeps the same glow, and his own dark inside keeps his white line readable.
  await settings.getByRole("radio", { name: "Light" }).click();
  await glowsIn("rgb(255, 148, 128)");
  await settings.getByRole("radio", { name: "Teal" }).click();
  await glowsIn("rgb(69, 211, 203)");
  await settings.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  // His panel's buttons and your own messages take the accent too, readable on the light theme.
  await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill("hello");
  await page.keyboard.press("Enter");
  const mine = panel(page).locator(".blurry-message.from-you p").last();
  expect(await mine.evaluate((p) => getComputedStyle(p).backgroundColor)).toBe("rgb(13, 127, 122)");
  expect(await mine.evaluate((p) => getComputedStyle(p).color)).toBe("rgb(255, 255, 255)");
  await page.screenshot({ path: `${OUT}blurry-teal-light.png` });
});
