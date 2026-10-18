import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text on the glass panels must stay readable (WCAG AA: 4.5:1 for normal text) even when something bright,
// like the blue model, sits behind the glass. We check against that worst case, using the colours in styles.css.
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

type RGB = [number, number, number];

function variable(name: string): { rgb: RGB; alpha: number } {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
  if (!m) throw new Error(`--${name} not found`);
  const v = m[1]!.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [n >> 16, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (!rgba) throw new Error(`--${name} has an unsupported value: ${v}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

const over = (top: { rgb: RGB; alpha: number }, under: RGB): RGB =>
  top.rgb.map((c, i) => c * top.alpha + under[i]! * (1 - top.alpha)) as RGB;

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const MODEL_BLUE: RGB = [0x6c, 0xb4, 0xff]; // the brightest large thing that can sit behind a panel (Viewport.ts)

describe("text contrast on glass", () => {
  for (const surface of ["glass", "glass-strong"]) {
    const bg = over(variable(surface), MODEL_BLUE);
    for (const text of ["text", "muted", "error", "warning", "success"]) {
      it(`${text} on ${surface} is at least 4.5:1`, () => {
        expect(contrast(variable(text).rgb, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  // Docked palettes and bars are solid, so nothing behind them changes how they read.
  for (const surface of ["chrome", "chrome-2"]) {
    for (const text of ["text", "muted", "accent", "error", "warning", "success"]) {
      it(`${text} on the docked ${surface} is at least 4.5:1`, () => {
        expect(contrast(variable(text).rgb, variable(surface).rgb)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("the measured volume (accent) is readable on the panel", () => {
    expect(contrast(variable("accent").rgb, over(variable("glass-strong"), MODEL_BLUE))).toBeGreaterThanOrEqual(4.5);
  });

  it("white text on the Export button is readable", () => {
    // Large bold text (WCAG AA large: 3:1); measured on the lighter end of the button's gradient.
    expect(contrast(variable("on-accent").rgb, variable("button").rgb)).toBeGreaterThanOrEqual(3);
  });
});
