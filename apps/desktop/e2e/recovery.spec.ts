import { expect, test, type Page } from "@playwright/test";

// A crash is simulated by closing the page without any warning (no "unsaved changes" prompt runs), then starting
// the app again in the same browser profile, where the backup copy lives.
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const status = (page: Page) => page.getByTestId("save-status");
const recovery = (page: Page) => page.getByRole("alertdialog", { name: "Restore your unsaved work?" });

async function start(page: Page) {
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 30_000 });
}

/** Changes the box, waits until the change is backed up, then "crashes" and starts the app again. */
async function editAndCrash(page: Page): Promise<Page> {
  await start(page);
  await expect(recovery(page)).toHaveCount(0);
  await field(page, "Width").fill("73.5");
  await field(page, "Wall thickness").fill("1.6");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(status(page)).toContainText("Unsaved changes (backed up)");
  const next = await page.context().newPage();
  await page.close();
  await start(next);
  return next;
}

test("after a crash, unsaved work can be restored exactly", async ({ page }) => {
  await start(page);
  await field(page, "Width").fill("73.5");
  await field(page, "Wall thickness").fill("1.6");
  await expect(host(page)).toHaveAttribute("data-geometry", "current");
  await expect(status(page)).toContainText("Unsaved changes (backed up)");
  const lostVolume = await page.getByTestId("volume").innerText();

  const next = await page.context().newPage();
  await page.close();
  await start(next);
  await expect(recovery(next)).toBeVisible();
  await expect(recovery(next)).toContainText("closed before your design was saved");
  // Untouched until the user chooses.
  await expect(field(next, "Width")).toHaveValue("60");

  await recovery(next).getByRole("button", { name: "Restore" }).click();
  await expect(recovery(next)).toHaveCount(0);
  await expect(field(next, "Width")).toHaveValue("73.5");
  await expect(field(next, "Wall thickness")).toHaveValue("1.6");
  await expect(host(next)).toHaveAttribute("data-geometry", "current");
  await expect(next.getByTestId("volume")).toHaveText(lostVolume);
  await expect(status(next)).toContainText("Unsaved changes");
  await expect(next.getByRole("status").filter({ hasText: "Restored your unsaved work" })).toBeVisible();

  // Saving makes the backup unnecessary, so the next start is clean.
  const download = next.waitForEvent("download");
  await next.getByRole("button", { name: "Download project" }).click();
  await download;
  await expect(status(next)).toContainText("All changes saved");
  await expect.poll(() => next.evaluate(() => localStorage.getItem("studio3d.recovery"))).toBeNull();
  await next.reload();
  await expect(host(next)).toHaveAttribute("data-geometry", "current", { timeout: 30_000 });
  await expect(recovery(next)).toHaveCount(0);
});

test("discarding the backup starts fresh and doesn't ask again", async ({ page }) => {
  const next = await editAndCrash(page);
  await recovery(next).getByRole("button", { name: "Discard" }).click();
  await expect(recovery(next)).toHaveCount(0);
  await expect(field(next, "Width")).toHaveValue("60");
  await expect(status(next)).toContainText("Not saved yet");
  await next.reload();
  await expect(host(next)).toHaveAttribute("data-geometry", "current", { timeout: 30_000 });
  await expect(recovery(next)).toHaveCount(0);
});

test("edits made before choosing don't overwrite the backup", async ({ page }) => {
  const next = await editAndCrash(page);
  await field(next, "Height").fill("45");
  await expect(host(next)).toHaveAttribute("data-geometry", "current");
  await next.waitForTimeout(3000); // longer than the backup delay
  await expect(status(next)).not.toContainText("backed up");
  next.on("dialog", (d) => void d.accept()); // "discard the changes you just made?" → yes
  await recovery(next).getByRole("button", { name: "Restore" }).click();
  await expect(field(next, "Width")).toHaveValue("73.5");
  await expect(field(next, "Height")).toHaveValue("30");
});

test("a damaged backup is explained and removed, and the app starts normally", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("studio3d.recovery", '{"format":"studio3d-recovery","formatVersion":1,"savedAt":');
    }
  });
  await start(page);
  await expect(page.getByRole("alert").filter({ hasText: "backup of your unsaved work is damaged" })).toBeVisible();
  await expect(recovery(page)).toHaveCount(0);
  await expect(field(page, "Width")).toHaveValue("60");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("studio3d.recovery"))).toBeNull();
});
