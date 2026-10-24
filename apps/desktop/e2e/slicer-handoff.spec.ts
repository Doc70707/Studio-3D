import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const check = (page: Page, id: string) => page.locator(`[data-testid="print-check"][data-check="${id}"]`);
const openPrintStudio = async (page: Page) => {
  await page.getByRole("button", { name: "Print Studio" }).click();
  await expect(check(page, "fits")).toHaveAttribute("data-status", "ok");
};

/** The files in a ZIP of stored entries (what a 3MF is), read from its local headers. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Record<string, string> = {};
  for (let at = 0; view.getUint32(at, true) === 0x04034b50; ) {
    expect(view.getUint16(at + 8, true)).toBe(0); // stored
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    files[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    at = start + size;
  }
  return files;
}

/** The lowest corner of the placed part: the mesh's lowest corner moved by the build item's transform. */
function placedMin(model: string): number[] {
  const t = model.match(/<item objectid="1" transform="([^"]+)"/)![1]!.split(" ").map(Number);
  const min = [Infinity, Infinity, Infinity];
  for (const m of model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g))
    [1, 2, 3].forEach((i) => (min[i - 1] = Math.min(min[i - 1]!, Number(m[i]))));
  return min.map((v, i) => v + t[9 + i]!);
}

const materialVolume = async (page: Page) =>
  Number((await page.getByTestId("print-facts").innerText()).match(/([\d.]+) cm³/)![1]) * 1000;

test.describe("in the browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await current(page);
  });

  test("Export 3MF saves the checked part in millimetres, named, on the printer's plate", async ({ page }) => {
    await openPrintStudio(page);
    // The browser can't start programs, so there's no "Open in"; the file is the way across.
    await expect(page.getByRole("button", { name: /^Open in/ })).toHaveCount(0);
    await expect(page.getByTestId("handoff-note")).toHaveText(
      "Only the part's shape is sure to go across. Pick your printer, filament and settings in the slicer.",
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export 3MF" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("Untitled.3mf");
    const bytes = new Uint8Array(readFileSync(await file.path()));
    const parts = unzip(bytes);
    expect(Object.keys(parts)).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    const model = parts["3D/3dmodel.model"]!;
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('<object id="1" name="Untitled" type="model">');
    expect(model).toMatch(/<metadata name="Application">Studio 3D \d+\.\d+\.\d+<\/metadata>/);
    // The 60 × 40 box centred on the A1's 256 × 256 plate, sitting on it.
    expect(placedMin(model).map((v) => Math.round(v * 1000) / 1000)).toEqual([98, 108, 0]);
    // For the independent trimesh check.
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}app-export.3mf`, bytes);
    writeFileSync(
      `${OUT}app-export.3mf.expected.json`,
      JSON.stringify({ volume: await materialVolume(page), size: [60, 40, 30], name: "Untitled", min: [98, 108, 0] }),
    );
  });

  test("the 3MF goes on the chosen printer's plate, and the File menu has it too", async ({ page }) => {
    await page.getByRole("button", { name: "Print Studio" }).click();
    await page.getByLabel("Printer").selectOption("bambu-a1-mini");
    await expect(check(page, "fits")).toHaveAttribute("data-status", "ok");
    await page.getByRole("button", { name: "Back to design" }).click();
    await page.getByRole("menuitem", { name: "File" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export 3MF…" }).click();
    const model = unzip(new Uint8Array(readFileSync(await (await download).path())))["3D/3dmodel.model"]!;
    expect(placedMin(model).map((v) => Math.round(v * 1000) / 1000)).toEqual([60, 70, 0]); // the 180 mm plate
  });
});

test.describe("on the desktop", () => {
  // Stands in for the desktop shell: the interface talks to it exactly as it talks to the real one, and each call is
  // recorded so the test can see what would reach the Rust side.
  const desktop = (page: Page, found: { name: string; path: string }[], located: string | null) =>
    page.addInitScript(
      ({ found, located }) => {
        const w = window as unknown as Record<string, unknown>;
        const calls: { cmd: string; args: Record<string, unknown> }[] = [];
        let next = 1;
        w.__calls = calls;
        w.isTauri = true;
        w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        w.__TAURI_INTERNALS__ = {
          metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
          transformCallback: () => next++,
          unregisterCallback() {},
          convertFileSrc: (p: string) => p,
          async invoke(cmd: string, args: Record<string, unknown>) {
            calls.push({ cmd, args });
            if (cmd === "find_slicers") return found;
            if (cmd === "plugin:dialog|open") return located;
            if (cmd === "open_in_slicer") return `C:\\Users\\shane\\AppData\\Local\\studio3d\\handoff\\${args.name}.3mf`;
            if (cmd === "plugin:window|is_fullscreen") return false;
            if (cmd === "plugin:event|listen") return next++;
            return null;
          },
        };
      },
      { found, located },
    );
  const calls = (page: Page, cmd: string) =>
    page.evaluate(
      (cmd) =>
        (window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }).__calls
          .filter((c) => c.cmd === cmd)
          .map((c) => ({ ...c.args, bytes: Array.isArray(c.args.bytes) ? c.args.bytes.length : undefined })),
      cmd,
    );
  const bambu = { name: "Bambu Studio", path: "C:\\Program Files\\Bambu Studio\\bambu-studio.exe" };
  const orca = { name: "OrcaSlicer", path: "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe" };

  test("Open in Bambu Studio hands over the checked part as a 3MF", async ({ page }) => {
    await desktop(page, [orca, bambu], null);
    await page.goto("/");
    await current(page);
    await openPrintStudio(page);
    // Both found; Bambu Studio first.
    await expect(page.getByLabel("Slicer")).toHaveValue(bambu.path);
    await expect(page.getByLabel("Slicer").locator("option")).toHaveText(["Bambu Studio", "OrcaSlicer"]);
    await page.screenshot({ path: `${OUT}print-studio-slicer.png` });
    await page.getByRole("button", { name: "Open in Bambu Studio" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opened" })).toHaveText(
      "Opened Untitled.3mf in Bambu Studio. Pick your printer, filament and settings there.",
    );
    const [sent] = await calls(page, "open_in_slicer");
    expect(sent).toMatchObject({ program: bambu.path, name: "Untitled", ext: "3mf" });
    // The bytes sent are the same 3MF that Export 3MF saves.
    const bytes = await page.evaluate(() => {
      const c = (window as unknown as { __calls: { cmd: string; args: { bytes: number[] } }[] }).__calls;
      return c.find((x) => x.cmd === "open_in_slicer")!.args.bytes;
    });
    const model = unzip(new Uint8Array(bytes))["3D/3dmodel.model"]!;
    expect(model).toContain('<object id="1" name="Untitled" type="model">');
    expect(placedMin(model).map((v) => Math.round(v * 1000) / 1000)).toEqual([98, 108, 0]);

    // Choosing OrcaSlicer is remembered on this computer.
    await page.getByLabel("Slicer").selectOption(orca.path);
    await expect(page.getByRole("button", { name: "Open in OrcaSlicer" })).toBeVisible();
    await page.reload();
    await current(page);
    await openPrintStudio(page);
    await expect(page.getByLabel("Slicer")).toHaveValue(orca.path);
  });

  test("with no slicer found, the user can locate one, and it is remembered", async ({ page }) => {
    await desktop(page, [], "D:\\Apps\\PrusaSlicer-2.9\\prusa-slicer.exe");
    await page.goto("/");
    await current(page);
    await openPrintStudio(page);
    await expect(page.getByTestId("no-slicer")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open in/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Locate slicer…" }).click();
    await expect(page.getByRole("button", { name: "Open in PrusaSlicer" })).toBeVisible();
    expect((await calls(page, "plugin:dialog|open"))[0]).toMatchObject({
      options: { filters: [{ name: "Programs", extensions: ["exe"] }] },
    });
    await page.reload();
    await current(page);
    await openPrintStudio(page);
    await expect(page.getByLabel("Slicer")).toHaveValue("D:\\Apps\\PrusaSlicer-2.9\\prusa-slicer.exe");
    await page.getByRole("button", { name: "Open in PrusaSlicer" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opened" })).toContainText("in PrusaSlicer");
    expect((await calls(page, "open_in_slicer"))[0]).toMatchObject({
      program: "D:\\Apps\\PrusaSlicer-2.9\\prusa-slicer.exe",
      ext: "3mf",
    });
  });

  test("the slicer can't be opened before the checks have run", async ({ page }) => {
    await desktop(page, [bambu], null);
    await page.goto("/");
    await current(page);
    await page.getByLabel("Width", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Print Studio" }).click();
    await expect(page.getByTestId("print-blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open in Bambu Studio" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Export 3MF" })).toBeDisabled();
    expect(await calls(page, "open_in_slicer")).toEqual([]);
  });
});
