import { expect, test, type Page } from "@playwright/test";

// The other tests run with "reduce motion" on, so things jump straight to where they end. These run with motion,
// checking that the camera, the segmented controls and the menus really move, and still end exactly in place.
test.use({ contextOptions: { reducedMotion: "no-preference" } });

const host = (page: Page) => page.locator("main.viewport-host");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(host(page)).not.toHaveAttribute("data-camera-gliding", "true");
});

test("the camera glides to a new view, ends exactly on it, and a grab stops the glide", async ({ page }) => {
  const start = await host(page).getAttribute("data-camera-position");
  await page.keyboard.press("1"); // Top
  // On its way: a frame or two later the camera is somewhere between the two views.
  await expect(host(page)).toHaveAttribute("data-camera-gliding", "true");
  await expect(host(page)).toHaveAttribute("data-camera-view", "top");
  await expect(host(page)).not.toHaveAttribute("data-camera-gliding", "true", { timeout: 3000 });
  const glided = await host(page).getAttribute("data-camera-position");
  expect(glided).not.toBe(start);

  // The same view with motion off is the same place: the glide ends where the jump would.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("0"); // 3D
  await page.keyboard.press("1");
  await expect(host(page)).toHaveAttribute("data-camera-position", glided!);

  // Grabbing the view mid-glide stops it there, and the view becomes the person's own.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press("0");
  await expect(host(page)).toHaveAttribute("data-camera-gliding", "true");
  const box = (await host(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(host(page)).not.toHaveAttribute("data-camera-gliding", "true");
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(host(page)).toHaveAttribute("data-camera-view", "custom");
});

test("a segmented control's thumb slides to the option picked", async ({ page }) => {
  await page.getByRole("button", { name: "Add cylinder" }).click();
  const group = page.getByRole("group", { name: "Cylinder 1 adds or cuts" });
  await expect(group).toHaveClass(/has-thumb/);
  const x = () => group.evaluate((g) => parseFloat(getComputedStyle(g).getPropertyValue("--thumb-x")));
  const before = await x();
  const cut = group.getByRole("button", { name: "Cut away" });
  await cut.click();
  await expect.poll(x).toBeGreaterThan(before);
  // The thumb lines up with the button it sits under.
  const b = (await cut.boundingBox())!;
  const g = (await group.boundingBox())!;
  expect(Math.abs(g.x + (await x()) - b.x)).toBeLessThan(1.5);
  // And it slides there, rather than jumping.
  const moving = await group.evaluate((g) => getComputedStyle(g, "::before").transitionDuration);
  expect(moving).not.toBe("0s");
});

test("menus grow out of where they were opened", async ({ page }) => {
  await page.getByRole("menubar").getByRole("menuitem", { name: "File", exact: true }).click();
  const list = page.locator(".menu-list");
  await expect(list).toBeVisible();
  const anim = await list.evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, origin: s.transformOrigin };
  });
  expect(anim.name).toBe("pop-in");
  expect(anim.origin).toBe("0px 0px");
});
