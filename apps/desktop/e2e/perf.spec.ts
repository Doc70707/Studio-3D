// Time from a change to the model being up to date, in the real app (geometry in its worker, drawing in WebGL).
// Skipped unless PERF=1, since times depend on the machine: `PERF=1 npx playwright test perf` (PERF_GRID=off to compare
// drawing without the grid).
import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test.skip(process.env.PERF !== "1", "timings only on request");
test.describe.configure({ timeout: 600_000 });

/**
 * Changes a field and waits for the model to be up to date again; returns how long that took, in ms, measured in the
 * page (from the keystroke to the moment the view says it is current), so the test's own polling doesn't count.
 */
async function timed(page: Page, label: string, value: string): Promise<number> {
  await expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 120_000 });
  const input = field(page, label);
  await input.focus();
  const done = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const el = document.querySelector("main.viewport-host")!;
        let start = 0;
        let left = false;
        document.addEventListener("input", () => (start = performance.now()), { once: true, capture: true });
        new MutationObserver((_, obs) => {
          const state = el.getAttribute("data-geometry");
          if (state !== "current") left = true;
          else if (left && start) {
            obs.disconnect();
            resolve(performance.now() - start);
          }
        }).observe(el, { attributes: true, attributeFilter: ["data-geometry"] });
      }),
  );
  await input.fill(value);
  return Math.round(await done);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

test("edit to up-to-date times", async ({ page }) => {
  await page.goto("/");
  const rows: Record<string, string | number>[] = [];
  const measure = async (what: string, label: string, values: string[]) => {
    const times = [];
    for (const v of values) times.push(await timed(page, label, v));
    rows.push({ what, "first (ms)": times[0]!, "median of the rest (ms)": median(times.slice(1)) });
  };
  await measure("open box: change width", "Width", ["61", "62", "63", "64", "65", "66"]);
  await field(page, "Wall thickness").fill("0");
  await page.getByRole("button", { name: "Add hole" }).click();
  await page.keyboard.press("Enter"); // the hole goes in the middle
  await page.getByLabel("Hole 1 thread").selectOption("M6");
  await measure("block + M6 thread: move the hole", "Hole 1 left / right position", ["1", "2", "3", "4", "5", "6"]);
  console.table(rows);
  writeFileSync(`${OUT}perf-app.json`, JSON.stringify(rows, null, 2));
});

test("start-up and drawing times", async ({ page }) => {
  const started = Date.now();
  await page.goto("/");
  await expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 120_000 });
  const ready = Date.now() - started;
  if (process.env.PERF_GRID === "off") await page.keyboard.press("F7");

  // Frames drawn while the view is orbited for two seconds (left-drag), and the slowest frame among them.
  const view = (await host(page).boundingBox())!;
  const frames = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        const end = performance.now() + 2000;
        const tick = (t: number) => {
          times.push(t);
          if (t < end) requestAnimationFrame(tick);
          else resolve(times);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    await page.mouse.move(view.x + view.width / 2 + i * 4, view.y + view.height / 2 + Math.sin(i / 6) * 30);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const times = await frames;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const rows = {
    "start to model up to date (ms)": ready,
    "frames per second while orbiting": Math.round((gaps.length / (times.at(-1)! - times[0]!)) * 1000),
    "slowest frame (ms)": Math.round(Math.max(...gaps)),
    "median frame (ms)": Math.round(median(gaps)),
  };
  console.table(rows);
  writeFileSync(`${OUT}perf-drawing.json`, JSON.stringify(rows, null, 2));
});
