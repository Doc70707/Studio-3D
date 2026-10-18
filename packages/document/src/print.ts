// Print Studio: which printer the part is going to, and the checks run on the exact file that would be handed to a
// slicer. Print settings are kept beside the design, never in it: changing them never changes or rebuilds the part.
export interface Printer {
  id: string;
  maker: string;
  name: string;
  /** Build volume across (X), front to back (Y) and up (Z), in mm, as the maker publishes it. */
  volume: [number, number, number];
  /** Stock nozzle diameter, mm, where the maker states it. */
  nozzle?: number;
  /** Hottest the nozzle and the bed go, °C, where the maker states it. */
  maxNozzleTemp?: number;
  maxBedTemp?: number;
  /** The printer's firmware, where the maker names it. */
  firmware?: string;
  /** The maker's own page the specifications come from. */
  source: string;
}

/**
 * Popular printers, with specifications only from the maker's own pages and manuals (see `source`), never from
 * another slicer's printer profiles. A value the maker doesn't publish is left out rather than guessed.
 */
export const PRINTERS: Printer[] = [
  {
    id: "bambu-a1",
    maker: "Bambu Lab",
    name: "A1",
    volume: [256, 256, 256],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    source: "https://bambulab.com/en/a1/tech-specs",
  },
  {
    id: "bambu-a1-mini",
    maker: "Bambu Lab",
    name: "A1 mini",
    volume: [180, 180, 180],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 80,
    source: "https://us.store.bambulab.com/products/a1-mini",
  },
  {
    id: "bambu-p1p",
    maker: "Bambu Lab",
    name: "P1P",
    volume: [256, 256, 256],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    source: "https://bambulab.com/en/p1",
  },
  {
    id: "bambu-p1s",
    maker: "Bambu Lab",
    name: "P1S",
    volume: [256, 256, 256],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    source: "https://us.store.bambulab.com/products/p1s",
  },
  {
    id: "bambu-p2s",
    maker: "Bambu Lab",
    name: "P2S",
    volume: [256, 256, 256],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    source:
      "https://blog.bambulab.com/the-icon-redefined-meet-the-p2s-a-completely-reengineered-version-of-the-ultra-productive-p1-series/",
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
    nozzle: 0.4,
    maxNozzleTemp: 350,
    source: "https://us.store.bambulab.com/products/h2d",
  },
  {
    id: "bambu-h2d-pro",
    maker: "Bambu Lab",
    name: "H2D Pro (one nozzle)",
    volume: [325, 320, 325],
    nozzle: 0.4,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    source: "https://bambulab.com/en-eu/h2d-pro/tech-specs",
  },
  {
    id: "bambu-h2s",
    maker: "Bambu Lab",
    name: "H2S",
    volume: [340, 320, 340],
    maxNozzleTemp: 350,
    source: "https://us.store.bambulab.com/products/h2s",
  },
  {
    // The left nozzle alone reaches furthest; the right one reaches 305 mm across, both together 300 mm.
    id: "bambu-h2c",
    maker: "Bambu Lab",
    name: "H2C (left nozzle)",
    volume: [325, 320, 320],
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    source: "https://bambulab.com/en/h2c/specs",
  },
  {
    id: "prusa-mk4s",
    maker: "Prusa",
    name: "MK4 / MK4S",
    volume: [250, 210, 220],
    nozzle: 0.4,
    maxNozzleTemp: 290,
    maxBedTemp: 120,
    source: "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/",
  },
  {
    id: "prusa-core-one",
    maker: "Prusa",
    name: "CORE One / CORE One+",
    volume: [250, 220, 270],
    nozzle: 0.4,
    maxNozzleTemp: 290,
    maxBedTemp: 120,
    source: "https://www.prusa3d.com/product/prusa-core-one/",
  },
  {
    id: "prusa-mini",
    maker: "Prusa",
    name: "MINI+",
    volume: [180, 180, 180],
    nozzle: 0.4,
    maxNozzleTemp: 280,
    maxBedTemp: 100,
    source: "https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-3d-printer-enclosure-bundle-5/",
  },
  {
    id: "prusa-xl",
    maker: "Prusa",
    name: "XL / XL+ (single tool)",
    volume: [360, 360, 360],
    maxNozzleTemp: 290,
    maxBedTemp: 115,
    source: "https://www.prusa3d.com/product/original-prusa-xl-assembled-single-toolhead-3d-printer/",
  },
  {
    id: "creality-ender3-v3-se",
    maker: "Creality",
    name: "Ender-3 V3 SE",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 260,
    maxBedTemp: 100,
    firmware: "Marlin",
    source: "https://www.creality.com/compare/compare-ender-3-v3-series",
  },
  {
    id: "creality-ender3-v3-ke",
    maker: "Creality",
    name: "Ender-3 V3 KE",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Klipper",
    source: "https://www.creality.com/compare/compare-ender-3-v3-series",
  },
  {
    id: "creality-ender3-v3",
    maker: "Creality",
    name: "Ender-3 V3",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    firmware: "Klipper",
    source: "https://www.creality.com/compare/compare-ender-3-v3-series",
  },
  {
    id: "creality-ender3-v3-plus",
    maker: "Creality",
    name: "Ender-3 V3 Plus",
    volume: [300, 300, 330],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Klipper",
    source: "https://www.creality.com/compare/compare-ender-3-v3-series",
  },
  {
    id: "creality-k1",
    maker: "Creality",
    name: "K1",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Creality OS",
    source: "https://www.creality.com/compare/compare-k1-flagship-series",
  },
  {
    id: "creality-k1c",
    maker: "Creality",
    name: "K1C",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Creality OS",
    source: "https://www.creality.com/compare/compare-k1-flagship-series",
  },
  {
    id: "creality-k1-max",
    maker: "Creality",
    name: "K1 Max",
    volume: [300, 300, 300],
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Creality OS",
    source: "https://www.creality.com/compare/compare-k1-flagship-series",
  },
  {
    id: "creality-k2-plus",
    maker: "Creality",
    name: "K2 Plus",
    volume: [350, 350, 350],
    nozzle: 0.4,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    firmware: "Creality OS",
    source: "https://www.creality.com/products/creality-k2-plus-cfs-combo",
  },
  {
    id: "creality-hi",
    maker: "Creality",
    name: "Hi",
    volume: [260, 260, 300],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Creality OS",
    source: "https://www.creality.com/products/creality-hi-combo",
  },
  {
    id: "elegoo-neptune4",
    maker: "Elegoo",
    name: "Neptune 4",
    volume: [225, 225, 265],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    source: "https://us.elegoo.com/products/elegoo-neptune-4-fdm-3d-printer",
  },
  {
    id: "elegoo-neptune4-pro",
    maker: "Elegoo",
    name: "Neptune 4 Pro",
    volume: [225, 225, 265],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    source: "https://us.elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer",
  },
  {
    id: "elegoo-neptune4-plus",
    maker: "Elegoo",
    name: "Neptune 4 Plus",
    volume: [320, 320, 385],
    source: "https://us.elegoo.com/products/neptune-4-plus-fdm-3d-printer",
  },
  {
    id: "elegoo-neptune4-max",
    maker: "Elegoo",
    name: "Neptune 4 Max",
    volume: [420, 420, 480],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 85,
    source: "https://www.elegoo.com/products/neptune-4-max-fdm-3d-printer",
  },
  {
    id: "elegoo-centauri-carbon",
    maker: "Elegoo",
    name: "Centauri Carbon",
    volume: [256, 256, 256],
    source: "https://www.elegoo.com/products/centauri-carbon",
  },
  {
    id: "anycubic-kobra3",
    maker: "Anycubic",
    name: "Kobra 3 / Kobra 3 Combo",
    volume: [250, 250, 260],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    firmware: "Kobra OS",
    source: "https://store.anycubic.com/products/anycubic-kobra-3",
  },
  {
    id: "anycubic-kobra-s1",
    maker: "Anycubic",
    name: "Kobra S1",
    volume: [250, 250, 250],
    nozzle: 0.4,
    maxNozzleTemp: 320,
    maxBedTemp: 120,
    firmware: "Kobra OS",
    source: "https://store.anycubic.com/collections/3d-printers/products/kobra-s1-combo",
  },
  {
    id: "anycubic-kobra3-max",
    maker: "Anycubic",
    name: "Kobra 3 Max",
    volume: [420, 420, 500],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 90,
    firmware: "Kobra OS",
    source: "https://store.anycubic.com/products/kobra-3-max-v2-combo-3d-printer",
  },
  {
    id: "anycubic-kobra2-neo",
    maker: "Anycubic",
    name: "Kobra 2 Neo",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 260,
    maxBedTemp: 110,
    source: "https://wiki.anycubic.com/kobra-2/user/Anycubic%20Kobra%202%20Neo_User%20Manual_V1.2-DE.pdf",
  },
  {
    id: "sovol-sv08",
    maker: "Sovol",
    name: "SV08",
    volume: [350, 350, 345],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Klipper",
    source: "https://www.sovol3d.com/products/sovol-sv08-3d-printer",
  },
  {
    id: "sovol-sv06-ace",
    maker: "Sovol",
    name: "SV06 ACE",
    volume: [220, 220, 250],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Klipper",
    source: "https://www.sovol3d.com/products/sovol-sv06-ace",
  },
  {
    id: "sovol-sv06-plus-ace",
    maker: "Sovol",
    name: "SV06 Plus ACE",
    volume: [300, 300, 350],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 100,
    firmware: "Klipper",
    source: "https://www.sovol3d.com/products/sovol-sv06-plus-ace-3d-printer",
  },
  {
    id: "qidi-q1-pro",
    maker: "QIDI",
    name: "Q1 Pro",
    volume: [245, 245, 240],
    nozzle: 0.4,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    firmware: "Klipper",
    source: "https://qidi3d.com/products/q1-pro-3d-printer",
  },
  {
    id: "qidi-plus4",
    maker: "QIDI",
    name: "Plus4",
    volume: [305, 305, 280],
    maxNozzleTemp: 370,
    firmware: "Klipper",
    source: "https://qidi3d.com/products/plus4-3d-printer",
  },
  {
    id: "qidi-x-max-3",
    maker: "QIDI",
    name: "X-Max 3",
    volume: [325, 325, 315],
    nozzle: 0.4,
    maxNozzleTemp: 350,
    maxBedTemp: 120,
    firmware: "Klipper",
    source: "https://us.qidi3d.com/products/qidi-x-max-3",
  },
  {
    id: "flashforge-ad5m",
    maker: "Flashforge",
    name: "Adventurer 5M",
    volume: [220, 220, 220],
    nozzle: 0.4,
    maxNozzleTemp: 280,
    maxBedTemp: 100,
    source: "https://www.flashforge.com/products/adventurer-5m-3d-printer",
  },
  {
    id: "flashforge-ad5m-pro",
    maker: "Flashforge",
    name: "Adventurer 5M Pro",
    volume: [220, 220, 220],
    maxNozzleTemp: 280,
    maxBedTemp: 100,
    source: "https://www.flashforge.com/products/adventurer-5m-pro-3d-printer",
  },
  {
    id: "flashforge-ad5x",
    maker: "Flashforge",
    name: "AD5X",
    volume: [220, 220, 220],
    nozzle: 0.4,
    maxNozzleTemp: 300,
    maxBedTemp: 110,
    source: "https://www.flashforge.com/products/flashforge-ad5x-3d-printer",
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
