// How the app looks: a theme for the frame and panels, an accent colour for buttons and highlights, the colour the
// part is drawn in (pick your filament's), and what lies around it: a build plate of a chosen size, or a plain
// background of any colour with just a grid, as in Civil 3D's model space. Kept per computer, like the workspace
// layout, and applied before the first paint so the app never flashes the wrong colours.
import { DEFAULT_VIEWPORT_COLORS, type ViewportColors } from "@studio3d/viewport";

export type ThemeId = "midnight" | "graphite" | "light";
export type AccentId = "blue" | "teal" | "green" | "amber" | "coral" | "violet";
export type PartColorId = "sky" | "white" | "grey" | "charcoal" | "red" | "orange" | "yellow" | "green" | "purple";

export interface Appearance {
  theme: ThemeId;
  accent: AccentId;
  part: PartColorId;
  /** Show the build plate while designing. Off, the part floats over the background, as in model space. */
  plate: boolean;
  /** The design plate's width and depth, in mm. Print Studio always shows the printer's own plate. */
  plateSize: number;
  /** The grid on the plate or in model space (F7 or GRID). */
  grid: boolean;
  /** Behind the part: "theme" for the theme's own, or a colour as #rrggbb. */
  background: string;
}

/** The CSS colour variables a theme sets. Every text colour is checked against every surface in contrast.test.ts. */
export interface ThemeColors {
  "bg-1": string;
  "bg-2": string;
  "glow-1": string;
  "glow-2": string;
  glass: string;
  "glass-strong": string;
  "glass-edge": string;
  "glass-highlight": string;
  /** Lines and light fills (hover, pressed, dividers) are this colour at low opacity: white on dark, ink on light. */
  "ink-rgb": string;
  text: string;
  muted: string;
  chrome: string;
  "chrome-2": string;
  "chrome-edge": string;
  /** Behind the docked palettes and bars: the window's own frame. */
  frame: string;
  "menu-bg": string;
  scrim: string;
  well: string;
  "well-focus": string;
  success: string;
  error: string;
  warning: string;
}

export interface Theme {
  label: string;
  dark: boolean;
  colors: ThemeColors;
  plate: Pick<ViewportColors, "plate" | "gridMinor" | "gridMajor">;
}

export const THEMES: Record<ThemeId, Theme> = {
  midnight: {
    label: "Midnight",
    dark: true,
    colors: {
      "bg-1": "#0b1020",
      "bg-2": "#121a33",
      "glow-1": "rgba(88, 130, 255, 0.28)",
      "glow-2": "rgba(160, 96, 255, 0.18)",
      glass: "rgba(20, 26, 44, 0.78)",
      "glass-strong": "rgba(18, 23, 40, 0.86)",
      "glass-edge": "rgba(255, 255, 255, 0.12)",
      "glass-highlight": "rgba(255, 255, 255, 0.22)",
      "ink-rgb": "255 255 255",
      text: "#f4f6fb",
      muted: "#b7c0d6",
      chrome: "#141a2b",
      "chrome-2": "#1a2136",
      "chrome-edge": "rgba(255, 255, 255, 0.08)",
      frame: "#0d1222",
      "menu-bg": "rgba(16, 21, 37, 0.97)",
      scrim: "rgba(4, 8, 20, 0.45)",
      well: "rgba(0, 0, 0, 0.28)",
      "well-focus": "rgba(0, 0, 0, 0.36)",
      success: "#6ee7a8",
      error: "#ffaba4",
      warning: "#ffd36b",
    },
    plate: { plate: DEFAULT_VIEWPORT_COLORS.plate, gridMinor: 0x2f3a52, gridMajor: 0x4a5878 },
  },
  graphite: {
    label: "Graphite",
    dark: true,
    colors: {
      "bg-1": "#101113",
      "bg-2": "#1c1e22",
      "glow-1": "rgba(255, 255, 255, 0.06)",
      "glow-2": "rgba(255, 255, 255, 0.03)",
      glass: "rgba(30, 32, 36, 0.8)",
      "glass-strong": "rgba(26, 28, 32, 0.88)",
      "glass-edge": "rgba(255, 255, 255, 0.11)",
      "glass-highlight": "rgba(255, 255, 255, 0.18)",
      "ink-rgb": "255 255 255",
      text: "#f2f3f5",
      muted: "#b6bac2",
      chrome: "#1d1f23",
      "chrome-2": "#24262b",
      "chrome-edge": "rgba(255, 255, 255, 0.08)",
      frame: "#141518",
      "menu-bg": "rgba(32, 34, 38, 0.98)",
      scrim: "rgba(0, 0, 0, 0.5)",
      well: "rgba(0, 0, 0, 0.3)",
      "well-focus": "rgba(0, 0, 0, 0.4)",
      success: "#6ee7a8",
      error: "#ffaba4",
      warning: "#ffd36b",
    },
    plate: { plate: 0x222428, gridMinor: 0x34373d, gridMajor: 0x50545c },
  },
  light: {
    label: "Light",
    dark: false,
    colors: {
      "bg-1": "#dfe4ec",
      "bg-2": "#f3f5f9",
      "glow-1": "rgba(94, 140, 255, 0.14)",
      "glow-2": "rgba(160, 96, 255, 0.08)",
      glass: "rgba(255, 255, 255, 0.86)",
      "glass-strong": "rgba(255, 255, 255, 0.92)",
      "glass-edge": "rgba(15, 23, 42, 0.1)",
      "glass-highlight": "rgba(255, 255, 255, 0.9)",
      "ink-rgb": "15 23 42",
      text: "#111827",
      muted: "#4b5563",
      chrome: "#f6f7f9",
      "chrome-2": "#ffffff",
      "chrome-edge": "rgba(15, 23, 42, 0.1)",
      frame: "#e6e9ef",
      "menu-bg": "rgba(255, 255, 255, 0.98)",
      scrim: "rgba(15, 23, 42, 0.3)",
      well: "#ffffff",
      "well-focus": "#ffffff",
      success: "#0b6b3a",
      error: "#b42318",
      warning: "#7a4f00",
    },
    plate: { plate: 0xd5dbe5, gridMinor: 0xbcc4d1, gridMajor: 0x8e99ad },
  },
};

/** One accent, worked out for dark and for light themes so it stays readable on both. */
export interface AccentColors {
  /** Icons, links and highlighted text on the panels. */
  accent: string;
  /** Main buttons, with on-accent text on them. */
  button: string;
  "button-strong": string;
  "on-accent": string;
}

export interface Accent {
  label: string;
  dark: AccentColors;
  light: AccentColors;
}

export const ACCENTS: Record<AccentId, Accent> = {
  blue: {
    label: "Blue",
    dark: { accent: "#5ea8ff", button: "#3b82f6", "button-strong": "#2563eb", "on-accent": "#ffffff" },
    light: { accent: "#1d5fd1", button: "#2563eb", "button-strong": "#1d4ed8", "on-accent": "#ffffff" },
  },
  teal: {
    label: "Teal",
    dark: { accent: "#45d3cb", button: "#0f8f8a", "button-strong": "#0b7570", "on-accent": "#ffffff" },
    light: { accent: "#0b6e69", button: "#0d7f7a", "button-strong": "#0a6662", "on-accent": "#ffffff" },
  },
  green: {
    label: "Green",
    dark: { accent: "#62d68e", button: "#15803d", "button-strong": "#166534", "on-accent": "#ffffff" },
    light: { accent: "#15703a", button: "#15803d", "button-strong": "#166534", "on-accent": "#ffffff" },
  },
  amber: {
    label: "Amber",
    dark: { accent: "#ffc65c", button: "#f5a524", "button-strong": "#e08e0b", "on-accent": "#1a1200" },
    light: { accent: "#8a4b00", button: "#b45309", "button-strong": "#92400e", "on-accent": "#ffffff" },
  },
  coral: {
    label: "Coral",
    dark: { accent: "#ff9480", button: "#dc4a2f", "button-strong": "#c23a20", "on-accent": "#ffffff" },
    light: { accent: "#b1361c", button: "#c8401f", "button-strong": "#a8341a", "on-accent": "#ffffff" },
  },
  violet: {
    label: "Violet",
    dark: { accent: "#b89dff", button: "#7c4dff", "button-strong": "#6a35f0", "on-accent": "#ffffff" },
    light: { accent: "#6534d1", button: "#7c3aed", "button-strong": "#6d28d9", "on-accent": "#ffffff" },
  },
};

/** Filament-like colours for the part in the 3D view. */
export const PART_COLORS: Record<PartColorId, { label: string; color: number }> = {
  sky: { label: "Sky blue", color: DEFAULT_VIEWPORT_COLORS.part },
  white: { label: "White", color: 0xf0f0ea },
  grey: { label: "Grey", color: 0x9ca3ad },
  charcoal: { label: "Charcoal", color: 0x3b3e44 },
  red: { label: "Red", color: 0xe5484d },
  orange: { label: "Orange", color: 0xf5822a },
  yellow: { label: "Yellow", color: 0xf2d230 },
  green: { label: "Green", color: 0x46b964 },
  purple: { label: "Purple", color: 0x8e6cf0 },
};

/** Plate sizes to pick from (mm): a printer's, and room for bigger designs. */
export const PLATE_SIZES = [256, 500, 1000, 2000] as const;

/** Backgrounds to pick from, besides the theme's own and any colour picked by hand. */
export const BACKGROUNDS: { id: string; label: string }[] = [
  { id: "theme", label: "Theme" },
  { id: "#000000", label: "Black" },
  { id: "#212830", label: "Model space" }, // Civil 3D and AutoCAD's dark model space (33, 40, 48)
  { id: "#3b3f45", label: "Grey" },
  { id: "#ffffff", label: "White" },
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "midnight",
  accent: "blue",
  part: "sky",
  plate: true,
  plateSize: 1000,
  grid: true,
  background: "theme",
};
export const APPEARANCE_KEY = "studio3d.appearance";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const channels = (color: string): [number, number, number] => {
  const n = parseInt(color.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const mix = (a: number, b: number, t: number) => {
  const [ar, ag, ab] = channels(hex(a));
  const [br, bg, bb] = channels(hex(b));
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
};
/** WCAG contrast between two colours: 1 (the same) to 21 (black on white). */
const contrastOf = (a: number, b: number) => {
  const lum = (n: number) => {
    const [r, g, bl] = channels(hex(n)).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const brightness = (n: number) => {
  const [r, g, b] = channels(hex(n));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

export const accentColors = (a: Appearance): AccentColors => ACCENTS[a.accent][THEMES[a.theme].dark ? "dark" : "light"];

/** The colour behind the part as a number, or null for the theme's own background. */
export const backgroundColor = (a: Appearance): number | null =>
  a.background === "theme" ? null : parseInt(a.background.slice(1), 16);

/**
 * The part, plate and grid colours for the 3D view: edges darker than a light part, lighter than a dark one. On a
 * background picked by hand, the grid and measurement lines are worked out from it so they show on any colour.
 */
export function viewportColors(a: Appearance): ViewportColors {
  const part = PART_COLORS[a.part].color;
  const edge = brightness(part) > 0.3 ? mix(part, 0x000000, 0.68) : mix(part, 0xffffff, 0.45);
  const bg = backgroundColor(a);
  if (bg === null)
    return { part, edge, ...THEMES[a.theme].plate, dimension: THEMES[a.theme].dark ? 0xdfe6f5 : 0x2a3346 };
  // Lines go towards black or white, whichever stands out more, only as far as they need to show.
  const ink = contrastOf(bg, 0x000000) > contrastOf(bg, 0xffffff) ? 0x000000 : 0xffffff;
  const toward = (least: number) => {
    let t = 0.06;
    while (t < 1 && contrastOf(mix(bg, ink, t), bg) < least) t += 0.02;
    return mix(bg, ink, Math.min(t, 1));
  };
  const plateColors = a.plate ? THEMES[a.theme].plate : null;
  return {
    part,
    edge,
    plate: plateColors?.plate ?? mix(bg, ink, 0.06),
    gridMinor: plateColors?.gridMinor ?? toward(1.3),
    gridMajor: plateColors?.gridMajor ?? toward(1.75),
    dimension: ink === 0x000000 ? 0x2a3346 : 0xdfe6f5,
  };
}

/** Every CSS variable the appearance sets, by name without the leading dashes. */
export function cssVariables(a: Appearance): Record<string, string> {
  const accent = accentColors(a);
  return { ...THEMES[a.theme].colors, ...accent, "accent-rgb": channels(accent.accent).join(" ") };
}

export function parseAppearance(text: string | null): Appearance {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends string>(v: unknown, table: Record<K, unknown>, d: K): K =>
    typeof v === "string" && Object.hasOwn(table, v) ? (v as K) : d;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    theme: pick(r.theme, THEMES, DEFAULT_APPEARANCE.theme),
    accent: pick(r.accent, ACCENTS, DEFAULT_APPEARANCE.accent),
    part: pick(r.part, PART_COLORS, DEFAULT_APPEARANCE.part),
    plate: bool(r.plate, DEFAULT_APPEARANCE.plate),
    plateSize:
      typeof r.plateSize === "number" && (PLATE_SIZES as readonly number[]).includes(r.plateSize)
        ? r.plateSize
        : DEFAULT_APPEARANCE.plateSize,
    grid: bool(r.grid, DEFAULT_APPEARANCE.grid),
    background:
      typeof r.background === "string" && (r.background === "theme" || /^#[0-9a-f]{6}$/i.test(r.background))
        ? r.background.toLowerCase()
        : DEFAULT_APPEARANCE.background,
  };
}

export function readAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearance(a: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    // Private windows can refuse storage; the colours then last until the app closes.
  }
}

/**
 * Sets the colours on the page; the 3D view's colours are applied by the view itself. They go in a style sheet of
 * their own (html:root) rather than inline, so the high-contrast and reduced-transparency settings in styles.css
 * (written more specifically) still win over a dark theme.
 */
export function applyAppearance(a: Appearance, doc: Document = document): void {
  let sheet = doc.getElementById("appearance") as HTMLStyleElement | null;
  if (!sheet) {
    sheet = doc.createElement("style");
    sheet.id = "appearance";
    doc.head.appendChild(sheet);
  }
  const vars = Object.entries(cssVariables(a))
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
  sheet.textContent = `html:root {\n${vars}\n  color-scheme: ${THEMES[a.theme].dark ? "dark" : "light"};\n}`;
  doc.documentElement.dataset.theme = a.theme;
  doc.documentElement.dataset.accent = a.accent;
  doc.documentElement.dataset.partColor = a.part;
  // A background picked by hand replaces the theme's behind the part, in the 3D view and the sketch screen alike. The
  // sketch's lines and words take the colours of a theme of the background's own lightness, so they show on it.
  const bg = backgroundColor(a);
  if (bg !== null) {
    const ink = THEMES[contrastOf(bg, 0x000000) > contrastOf(bg, 0xffffff) ? "light" : "midnight"].colors;
    const inkVars = (["ink-rgb", "text", "muted", "success", "warning"] as const)
      .map((k) => `--${k}: ${ink[k]};`)
      .join(" ");
    sheet.textContent += `\nhtml:root { --viewport-bg: ${a.background}; }\nhtml:root .sketch-canvas { ${inkVars} }`;
  }
  doc.documentElement.dataset.background = a.background === "theme" ? "theme" : "custom";
}
