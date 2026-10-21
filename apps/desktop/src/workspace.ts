// The workspace layout the user has arranged: which palettes show, how wide they are, which side each sits on, the
// ribbon and the panel style. Kept per computer (not in the design file), like a CAD program's workspace.

export type PaletteId = "browser" | "properties";
export type Side = "left" | "right";

export interface PaletteLayout {
  shown: boolean;
  /** Folded down to a thin strip at the edge; a click opens it again. */
  collapsed: boolean;
  width: number;
}

export interface Workspace {
  /** Which side the Browser is on; Properties takes the other. */
  browserSide: Side;
  browser: PaletteLayout;
  properties: PaletteLayout;
  /** Only the ribbon's tab names show; a tab opens on click. */
  ribbonMinimized: boolean;
  /** Docked: solid palettes against the window's edges. Floating: frosted glass over the 3D view. */
  style: "docked" | "floating";
  /** The command line under the 3D view (Ctrl+9), for typing commands by name as in AutoCAD. */
  commandLine: boolean;
}

export const PALETTE_MIN_WIDTH = 220;
export const PALETTE_MAX_WIDTH = 520;

export const DEFAULT_WORKSPACE: Workspace = {
  browserSide: "left",
  browser: { shown: true, collapsed: false, width: 260 },
  properties: { shown: true, collapsed: false, width: 300 },
  ribbonMinimized: false,
  style: "docked",
  commandLine: false,
};

export const WORKSPACE_KEY = "studio3d.workspace";

export const clampWidth = (w: number) =>
  Math.round(Math.min(PALETTE_MAX_WIDTH, Math.max(PALETTE_MIN_WIDTH, Number.isFinite(w) ? w : PALETTE_MIN_WIDTH)));

export const sideOf = (ws: Workspace, id: PaletteId): Side =>
  id === "browser" ? ws.browserSide : ws.browserSide === "left" ? "right" : "left";

/** A stored workspace, with anything missing or damaged taken from the default. */
export function parseWorkspace(text: string | null): Workspace {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const palette = (v: unknown, d: PaletteLayout): PaletteLayout => {
    const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return {
      shown: typeof p.shown === "boolean" ? p.shown : d.shown,
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : d.collapsed,
      width: typeof p.width === "number" ? clampWidth(p.width) : d.width,
    };
  };
  const d = DEFAULT_WORKSPACE;
  return {
    browserSide: r.browserSide === "right" ? "right" : "left",
    browser: palette(r.browser, d.browser),
    properties: palette(r.properties, d.properties),
    ribbonMinimized: typeof r.ribbonMinimized === "boolean" ? r.ribbonMinimized : d.ribbonMinimized,
    commandLine: typeof r.commandLine === "boolean" ? r.commandLine : d.commandLine,
    style: r.style === "floating" ? "floating" : "docked",
  };
}

export function readWorkspace(): Workspace {
  try {
    return parseWorkspace(localStorage.getItem(WORKSPACE_KEY));
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function writeWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
  } catch {
    // Private windows can refuse storage; the layout then lasts until the app closes.
  }
}
