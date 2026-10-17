import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const host = (page: Page) => page.locator("main.viewport-host");
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current", { timeout: 30_000 });

/** A 200 × 100 pixel PNG: white, with a black bar along the middle, made here so the test needs no files. */
function png(width = 200, height = 100): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0;
    if (Math.abs(y - height / 2) < 3) row.fill(0, 1);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function addPicture(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Create" }).click();
  await page.getByRole("menuitem", { name: "Reference picture…" }).click();
  await (await chooser).setFiles({ name: "bracket.png", mimeType: "image/png", buffer: png() });
}

/** Clicks a point of the picture in the calibration dialog, in the picture's own pixels. */
async function clickPixel(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("calibrate-picture").boundingBox())!;
  await page.mouse.click(box.x + (x / 200) * box.width, box.y + (y / 100) * box.height);
}

async function exportedStl(page: Page): Promise<Buffer> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export STL" }).click();
  return readFileSync((await (await download).path())!);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("a reference picture is calibrated from two points and a known distance", async ({ page }) => {
  await addPicture(page);
  const dialog = page.getByRole("dialog", { name: "Calibrate bracket" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  // Two clicks 160 pixels apart along the bar; the bar is really 80 mm long, so a pixel is 0.5 mm.
  await clickPixel(page, 20, 50);
  await clickPixel(page, 180, 50);
  await dialog.getByLabel("Real distance between the points").fill("0");
  await expect(dialog.getByRole("alert")).toHaveText("Type the real distance between the points, more than 0 mm.");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await dialog.getByLabel("Real distance between the points").fill("80");
  await expect(page.getByTestId("calibrate-result")).toContainText("so the picture is 100 × 50 mm");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId("reference-size")).toHaveText(
    "100 × 50 mm (0.5 mm per pixel). Sized from a known distance.",
  );
  await expect(host(page)).toHaveAttribute("data-references", "1");
  await expect(page.getByTestId("reference")).toContainText("100 × 50 mm");

  // Typing the width is the other way to size it, and undo takes it back like any other edit.
  await field(page, "bracket width").fill("150");
  await expect(page.getByTestId("reference-size")).toContainText("150 × 75 mm");
  await page.getByTestId("reference-size").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("reference-size")).toContainText("100 × 50 mm");

  // Hiding it takes it out of the view.
  await page.getByRole("button", { name: "Hide bracket" }).click();
  await expect(host(page)).toHaveAttribute("data-references", "0");
  await page.getByRole("button", { name: "Show bracket" }).click();
  await expect(host(page)).toHaveAttribute("data-references", "1");
});

test("a picture is never part of the model: the STL is byte for byte the same", async ({ page }) => {
  const before = await exportedStl(page);
  const volume = await page.getByTestId("volume").innerText();
  await addPicture(page);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByLabel("bracket solid").fill("100");
  await page.getByLabel("Show over the part").check();
  await current(page);
  await expect(page.getByTestId("volume")).toHaveText(volume);
  expect((await exportedStl(page)).equals(before)).toBe(true);
});

test("pictures are saved with the project and shown under a drawing facing the same way", async ({ page }) => {
  await addPicture(page);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await field(page, "bracket width").fill("100");
  await field(page, "bracket across").fill("10");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download project" }).click();
  const path = await (await download).path();
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "New" }).click();
  await expect(host(page)).toHaveAttribute("data-references", "0");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles(path);
  await expect(host(page)).toHaveAttribute("data-references", "1");
  await page.getByRole("button", { name: /^bracket/ }).click();
  await expect(field(page, "bracket across")).toHaveValue("10");

  // On the plate the picture lies under the drawing at its real size: 100 mm across, its middle 10 mm right.
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  const canvas = page.getByTestId("sketch-canvas");
  const underlay = page.getByTestId("reference-underlay");
  await expect(underlay).toHaveCount(1);
  const k = Number(await canvas.getAttribute("data-scale"));
  const [ox] = (await canvas.getAttribute("data-origin"))!.split(",").map(Number);
  const box = (await underlay.boundingBox())!;
  const svg = (await canvas.boundingBox())!;
  expect(box.width).toBeCloseTo(100 * k, 0);
  expect(box.x - svg.x + box.width / 2).toBeCloseTo(ox! + 10 * k, 0);

  // Turned to face the front, it isn't under a drawing on the plate.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByLabel("bracket faces").selectOption("front");
  await page.getByRole("button", { name: "Draw on the plate" }).click();
  await expect(page.getByTestId("sketch-canvas")).toBeVisible();
  await expect(page.getByTestId("reference-underlay")).toHaveCount(0);
});
