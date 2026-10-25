import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  PART_COLORS,
  THEMES,
  accentColors,
  cssVariables,
  parseAppearance,
  viewportColors,
  type AccentId,
  type ThemeId,
} from "./appearance";

// Text must stay readable (WCAG AA: 4.5:1 for normal text) in every theme with every accent. Glass panels are checked
// with the worst part colour behind them, since the part can sit under a floating panel.
type RGB = [number, number, number];

function parse(v: string): { rgb: RGB; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [n >> 16, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (!rgba) throw new Error(`unsupported colour: ${v}`);
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

const rgbOf = (n: number): RGB => [n >> 16, (n >> 8) & 255, n & 255];
const parts = Object.values(PART_COLORS).map((p) => rgbOf(p.color));
const themes = Object.keys(THEMES) as ThemeId[];
const accents = Object.keys(ACCENTS) as AccentId[];

describe("text contrast in every theme", () => {
  for (const theme of themes) {
    const c = THEMES[theme].colors;
    for (const accent of accents) {
      const a = accentColors({ ...DEFAULT_APPEARANCE, theme, accent });
      for (const surface of ["chrome", "chrome-2"] as const) {
        it(`${theme}, ${accent}: the accent is readable on ${surface}`, () => {
          expect(contrast(parse(a.accent).rgb, parse(c[surface]).rgb)).toBeGreaterThanOrEqual(4.5);
        });
      }
      it(`${theme}, ${accent}: the accent is readable on glass over any part colour`, () => {
        for (const part of parts)
          expect(contrast(parse(a.accent).rgb, over(parse(c["glass-strong"]), part))).toBeGreaterThanOrEqual(4.5);
      });
      it(`${theme}, ${accent}: text on the main buttons is readable`, () => {
        // Bold button text, measured on the lighter of the button's two colours (WCAG AA large text: 3:1).
        for (const bg of [a.button, a["button-strong"]])
          expect(contrast(parse(a["on-accent"]).rgb, parse(bg).rgb)).toBeGreaterThanOrEqual(3);
      });
    }
    for (const surface of ["chrome", "chrome-2"] as const)
      for (const text of ["text", "muted", "error", "warning", "success"] as const)
        it(`${theme}: ${text} on the docked ${surface} is at least 4.5:1`, () => {
          expect(contrast(parse(c[text]).rgb, parse(c[surface]).rgb)).toBeGreaterThanOrEqual(4.5);
        });
    for (const surface of ["glass", "glass-strong"] as const)
      for (const text of ["text", "muted", "error", "warning", "success"] as const)
        it(`${theme}: ${text} on ${surface} is at least 4.5:1 whatever colour the part is`, () => {
          for (const part of parts)
            expect(contrast(parse(c[text]).rgb, over(parse(c[surface]), part))).toBeGreaterThanOrEqual(4.5);
        });
  }
});

describe("appearance", () => {
  it("styles.css starts with the default theme's colours, so the first paint matches", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    for (const [name, value] of Object.entries(cssVariables(DEFAULT_APPEARANCE)))
      expect(root, `--${name}`).toContain(`--${name}: ${value};`);
  });

  it("nothing stored, or anything unknown, gives the default; a stored choice comes back", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("{bad")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(JSON.stringify({ theme: "neon", accent: "teal", part: "toString" }))).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: "teal",
    });
    const a = { ...DEFAULT_APPEARANCE, theme: "light", accent: "coral", part: "charcoal" } as const;
    expect(parseAppearance(JSON.stringify(a))).toEqual(a);
  });

  it("the plate, its size, the grid and the background come back; settings saved before them get the defaults", () => {
    const old = parseAppearance(JSON.stringify({ theme: "graphite", accent: "blue", part: "sky" }));
    expect(old).toMatchObject({ plate: true, plateSize: 1000, grid: true, background: "theme" });
    const a = { ...DEFAULT_APPEARANCE, plate: false, plateSize: 2000, grid: false, background: "#000000" };
    expect(parseAppearance(JSON.stringify(a))).toEqual(a);
    expect(parseAppearance(JSON.stringify({ plateSize: 3, background: "red", plate: "no" }))).toMatchObject({
      plate: true,
      plateSize: 1000,
      background: "theme",
    });
    expect(parseAppearance(JSON.stringify({ background: "#A0B0C0" })).background).toBe("#a0b0c0");
    expect(parseAppearance(JSON.stringify({ density: "compact" })).density).toBe("compact");
    expect(parseAppearance(JSON.stringify({ density: "tiny" })).density).toBe("comfortable");
  });

  it("on any background picked by hand, the grid and the measurement lines show", () => {
    for (const background of ["#000000", "#212830", "#3b3f45", "#ffffff", "#ff0000", "#00ff66", "#2040ff", "#808080"]) {
      const v = viewportColors({ ...DEFAULT_APPEARANCE, plate: false, background });
      const bg = rgbOf(parseInt(background.slice(1), 16));
      expect(contrast(rgbOf(v.gridMajor), bg), background).toBeGreaterThanOrEqual(1.7);
      expect(contrast(rgbOf(v.gridMinor), bg), background).toBeGreaterThanOrEqual(1.3);
      expect(contrast(rgbOf(v.dimension!), bg), background).toBeGreaterThanOrEqual(3);
    }
  });

  it("part edges stand out from the part: darker on a light part, lighter on a dark one", () => {
    for (const part of Object.keys(PART_COLORS) as (keyof typeof PART_COLORS)[]) {
      const v = viewportColors({ ...DEFAULT_APPEARANCE, part });
      expect(contrast(rgbOf(v.part), rgbOf(v.edge)), part).toBeGreaterThanOrEqual(2.5);
    }
  });
});
