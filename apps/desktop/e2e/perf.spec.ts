// Time from a change to the model being up to date, in the real app (geometry in its worker, drawing in WebGL).
// Skipped unless PERF=1, since times depend on the machine: `PERF=1 npx playwright test perf`.
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
  await page.getByLabel("Hole 1 thread").selectOption("M6");
  await measure("block + M6 thread: move the hole", "Hole 1 left / right position", ["1", "2", "3", "4", "5", "6"]);
  console.table(rows);
  writeFileSync(`${OUT}perf-app.json`, JSON.stringify(rows, null, 2));
});
