// Print Studio: which printer the part is going to, and the checks run on the exact file that would be handed to a
// slicer. Print settings are kept beside the design, never in it: changing them never changes or rebuilds the part.
export interface Printer {
  id: string;
  maker: string;
  name: string;
  /** Build volume across (X), front to back (Y) and up (Z), in mm, as the maker publishes it. */
  volume: [number, number, number];
  /** The maker's spec page the volume comes from. */
  source: string;
}

/** Printers whose build volume we have from the maker's own spec page (see `source`). */
export const PRINTERS: Printer[] = [
  {
    id: "bambu-a1",
    maker: "Bambu Lab",
    name: "A1",
    volume: [256, 256, 256],
    source: "https://bambulab.com/en/a1/tech-specs",
  },
  {
    id: "bambu-a1-mini",
    maker: "Bambu Lab",
    name: "A1 mini",
    volume: [180, 180, 180],
    source: "https://us.store.bambulab.com/products/a1-mini",
  },
  {
    id: "bambu-p1p",
    maker: "Bambu Lab",
    name: "P1P",
    volume: [256, 256, 256],
    source: "https://us.store.bambulab.com/products/p1p",
  },
  {
    id: "bambu-p1s",
    maker: "Bambu Lab",
    name: "P1S",
    volume: [256, 256, 256],
    source: "https://us.store.bambulab.com/products/p1s",
  },
  {
    id: "bambu-x1c",
    maker: "Bambu Lab",
    name: "X1 Carbon",
    volume: [256, 256, 256],
    source: "https://jp.store.bambulab.com/en/products/x1-carbon",
  },
  {
    // One nozzle: 325 mm across. Both nozzles in one print reach 300 mm, so this is the most a single-nozzle print gets.
    id: "bambu-h2d",
    maker: "Bambu Lab",
    name: "H2D (one nozzle)",
    volume: [325, 320, 325],
    source: "https://us.store.bambulab.com/products/h2d",
  },
  {
    id: "prusa-mk4s",
    maker: "Prusa",
    name: "MK4 / MK4S",
    volume: [250, 210, 220],
    source: "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer/",
  },
  {
    id: "prusa-core-one",
    maker: "Prusa",
    name: "CORE One",
    volume: [250, 220, 270],
    source: "https://www.prusa3d.com/product/prusa-core-one/",
  },
  {
    id: "prusa-mini",
    maker: "Prusa",
    name: "MINI+",
    volume: [180, 180, 180],
    source: "https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-printer/",
  },
  {
    id: "prusa-xl",
    maker: "Prusa",
    name: "XL (single tool)",
    volume: [360, 360, 360],
    source: "https://www.prusa3d.com/product/original-prusa-xl-single-toolhead-3d-printer-3/",
  },
  {
    id: "creality-ender3-v3-se",
    maker: "Creality",
    name: "Ender-3 V3 SE",
    volume: [220, 220, 250],
    source: "https://www.creality.com/compare/compare-ender-3-v3-series",
  },
  {
    id: "creality-k1c",
    maker: "Creality",
    name: "K1C",
    volume: [220, 220, 250],
    source: "https://www.creality.com/products/k1c-carbon-3d-printer",
  },
  {
    id: "elegoo-neptune4-pro",
    maker: "Elegoo",
    name: "Neptune 4 Pro",
    volume: [225, 225, 265],
    source: "https://us.elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer",
  },
];

/** The printer used until one is chosen. */
export const DEFAULT_PRINTER = "bambu-a1";

export interface PrintSetup {
  printer: string;
  /** Height of each printed layer, mm. Absent means the default. */
  layerHeight?: number;
  /** Walls round every outline. Absent means the default. */
  walls?: number;
  /** How much of the inside is filled, 0 to 1. Absent means the default. */
  infill?: number;
}

/** Layer heights offered for a 0.4 mm nozzle, the size every listed printer ships with: fine detail to fast drafts. */
export const LAYER_HEIGHTS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];
export const DEFAULT_LAYER_HEIGHT = 0.2;
export const WALL_COUNTS = [1, 2, 3, 4];
export const DEFAULT_WALLS = 2;
export const INFILL_DENSITIES = [0, 0.1, 0.15, 0.2, 0.3, 0.5, 1];
export const DEFAULT_INFILL = 0.15;
/** Width of one printed line from a 0.4 mm nozzle: a little wider than the nozzle, so lines press into each other. */
export const LINE_WIDTH = 0.42;

export const printerById = (id: string | undefined): Printer =>
  PRINTERS.find((p) => p.id === id) ?? PRINTERS.find((p) => p.id === DEFAULT_PRINTER)!;

/** What's wrong with a stored print setup, or null when it can be read. An unknown printer is read as the default. */
export function printSetupProblem(p: unknown): string | null {
  if (typeof p !== "object" || !p) return "isn't a print setup";
  if (typeof (p as Record<string, unknown>).printer !== "string") return "doesn't say which printer";
  const h = (p as Record<string, unknown>).layerHeight;
  if (h !== undefined && !(typeof h === "number" && h > 0 && h <= 1)) return "has a layer height that isn't 0 to 1 mm";
  const w = (p as Record<string, unknown>).walls;
  if (w !== undefined && !(Number.isInteger(w) && (w as number) >= 1 && (w as number) <= 20))
    return "has a wall count that isn't a whole number from 1 to 20";
  const f = (p as Record<string, unknown>).infill;
  if (f !== undefined && !(typeof f === "number" && f >= 0 && f <= 1)) return "has an infill that isn't 0 to 100%";
  return null;
}

/** What is known about the exported mesh: its bounds and whether it is a closed, printable surface. */
export interface MeshFacts {
  min: [number, number, number];
  max: [number, number, number];
  watertight: boolean;
  consistentWinding: boolean;
  /** Separate pieces that don't touch each other. */
  bodies: number;
}

export type CheckStatus = "ok" | "warning" | "error";
export interface PrintCheck {
  id: "closed" | "pieces" | "fits" | "plate";
  status: CheckStatus;
  text: string;
}

const mm = (n: number) => `${Math.round(n * 10) / 10 + 0} mm`;
const AXES = ["wide", "deep", "tall"] as const;
/** How far off the plate (or into it) the lowest point may be and still count as sitting on it. */
const ON_PLATE = 0.01;

/** The checks shown before printing, in the order they matter. Each says what to do when it isn't fine. */
export function printChecks(m: MeshFacts, printer: Printer): PrintCheck[] {
  const checks: PrintCheck[] = [];
  checks.push(
    m.watertight && m.consistentWinding
      ? { id: "closed", status: "ok", text: "Closed solid: the surface has no gaps, so a slicer can fill it." }
      : {
          id: "closed",
          status: "error",
          text: "The surface has gaps or flipped faces, so a slicer may fill it wrongly. Check the last step you changed.",
        },
  );
  checks.push(
    m.bodies <= 1
      ? { id: "pieces", status: "ok", text: "One piece." }
      : {
          id: "pieces",
          status: "warning",
          text: `${m.bodies} separate pieces that don't touch. They print as ${m.bodies} parts; join them if that isn't meant.`,
        },
  );
  const size = [0, 1, 2].map((i) => m.max[i]! - m.min[i]!);
  const over = [0, 1, 2].filter((i) => size[i]! > printer.volume[i]! + 1e-6);
  checks.push(
    over.length === 0
      ? {
          id: "fits",
          status: "ok",
          text: `Fits the ${printer.name}: ${size.map(mm).join(" × ")} in ${printer.volume.map(mm).join(" × ")}.`,
        }
      : {
          id: "fits",
          status: "error",
          text: `Too big for the ${printer.name}: ${over
            .map((i) => `${mm(size[i]!)} ${AXES[i]}, the most is ${mm(printer.volume[i]!)}`)
            .join("; ")}. Make it smaller, split it, or pick a bigger printer.`,
        },
  );
  const bottom = m.min[2];
  checks.push(
    Math.abs(bottom) <= ON_PLATE
      ? { id: "plate", status: "ok", text: "Sits flat on the plate." }
      : bottom > 0
        ? {
            id: "plate",
            status: "warning",
            text: `The lowest point is ${mm(bottom)} above the plate. Lower it to 0 so it sits on the plate as designed.`,
          }
        : {
            id: "plate",
            status: "warning",
            text: `${mm(-bottom)} of the part is below the plate. Raise it to 0 so all of it is above the plate.`,
          },
  );
  return checks;
}
