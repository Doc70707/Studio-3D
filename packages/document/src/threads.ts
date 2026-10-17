// Screw threads and the holes that go with screws, sized for 3D printing. Every size here comes from a published
// table. The standards themselves are paywalled, so the values come from these summaries of them, cross-checked
// (sizes only one source gave are left out, except the tap drills, which are marked):
// - pitches: https://en.wikipedia.org/wiki/ISO_metric_screw_thread,
//   https://amesweb.info/Screws/Tables/Metric-Thread-Pitch-Chart.aspx
// - unified threads: https://en.wikipedia.org/wiki/Unified_Thread_Standard,
//   https://www.engineeringtoolbox.com/unified-screw-threads-unc-unf-d_1809.html,
//   https://www.trfastenings.com/knowledge-base/thread-geometries/thread-conversion-table
// - tap drills: https://www.trfastenings.com/Knowledge-Base/Engineering-Data/tapping-sizes-and-clearance-holes,
//   https://www.engineeringtoolbox.com/iso-metric-thread-drill-tap-size-d_2045.html
// - ISO 273 clearance: https://www.albanycountyfasteners.com/media/6b/b8/g0/1764944339/clearance-hole-chart.pdf,
//   https://amesweb.info/Screws/Metric-Clearance-Hole-Chart.aspx
// - ISO 4762 heads and counterbores: https://engineersedge.com/iso_socket_head_screw.htm,
//   https://fasten.it/norms/norm/din_en_iso_4762, https://id.misumi-ec.com/pdf/tech/mech/p2847.pdf,
//   https://amesweb.info/Screws/Metric-Counterbore-Hole-Dimensions-Chart.aspx
// - ISO 10642 heads: https://engineersedge.com/hardware/bs_en_iso_10642_14583.htm,
//   https://eshop-cz.boellhoff.com/out/media/pdf/ISO_10642_Stahl_8.8___en.pdf
//
// The tooth is the basic profile shared by ISO 68-1 and Unified (ASME B1.1) threads: a 60° triangle of height
// H = (√3 / 2) × pitch, with H/8 cut off the crest (a flat p/8 wide at the major diameter) and H/4 off the root
// (a flat p/4 wide at the minor diameter). A printed thread also needs room to turn, so the whole profile is moved
// in by half the fit clearance for a bolt and out by half of it for a threaded hole.

export type ThreadStandard = "ISO coarse" | "ISO fine" | "UNC" | "UNF";
interface ThreadSpec {
  /** Major diameter, mm. */
  diameter: number;
  /** mm per turn. */
  pitch: number;
  standard: ThreadStandard;
  /** Drill for tapping, mm, where a sourced value exists (else the D − P rule is used). */
  tapDrill?: number;
}

const INCH = 25.4;
/** A Unified thread from its basic major diameter (inches) and threads per inch. */
const unified = (inches: number, tpi: number, standard: "UNC" | "UNF", tapDrillInches: number): ThreadSpec => ({
  diameter: inches * INCH,
  pitch: INCH / tpi,
  standard,
  tapDrill: tapDrillInches * INCH,
});

export const THREADS = {
  // ISO 261 / 262 coarse pitches; tap drills as TR Fastenings recommends (Engineering Toolbox agrees but for
  // M8 6.75 and M12 10.25, which are D − P exactly).
  M3: { diameter: 3, pitch: 0.5, standard: "ISO coarse", tapDrill: 2.5 },
  M4: { diameter: 4, pitch: 0.7, standard: "ISO coarse", tapDrill: 3.3 },
  M5: { diameter: 5, pitch: 0.8, standard: "ISO coarse", tapDrill: 4.2 },
  M6: { diameter: 6, pitch: 1, standard: "ISO coarse", tapDrill: 5 },
  M8: { diameter: 8, pitch: 1.25, standard: "ISO coarse", tapDrill: 6.8 },
  M10: { diameter: 10, pitch: 1.5, standard: "ISO coarse", tapDrill: 8.5 },
  M12: { diameter: 12, pitch: 1.75, standard: "ISO coarse", tapDrill: 10.2 },
  M16: { diameter: 16, pitch: 2, standard: "ISO coarse", tapDrill: 14 },
  M20: { diameter: 20, pitch: 2.5, standard: "ISO coarse", tapDrill: 17.5 },
  // ISO 262 fine pitches that at least two sources list.
  M8x1: { diameter: 8, pitch: 1, standard: "ISO fine" },
  "M10x1.25": { diameter: 10, pitch: 1.25, standard: "ISO fine" },
  M10x1: { diameter: 10, pitch: 1, standard: "ISO fine" },
  "M12x1.5": { diameter: 12, pitch: 1.5, standard: "ISO fine" },
  "M12x1.25": { diameter: 12, pitch: 1.25, standard: "ISO fine" },
  "M16x1.5": { diameter: 16, pitch: 1.5, standard: "ISO fine" },
  M20x2: { diameter: 20, pitch: 2, standard: "ISO fine" },
  "M20x1.5": { diameter: 20, pitch: 1.5, standard: "ISO fine" },
  // ASME B1.1 basic major diameters and threads per inch (Wikipedia, Engineering Toolbox and TR Fastenings agree);
  // tap drills are Wikipedia's preferred cutting tap drills, in inches as it gives them (single source).
  "#4-40 UNC": unified(0.112, 40, "UNC", 0.089),
  "#6-32 UNC": unified(0.138, 32, "UNC", 0.107),
  "#8-32 UNC": unified(0.164, 32, "UNC", 0.136),
  "#10-24 UNC": unified(0.19, 24, "UNC", 0.15),
  "1/4-20 UNC": unified(0.25, 20, "UNC", 0.201),
  "5/16-18 UNC": unified(0.3125, 18, "UNC", 0.257),
  "3/8-16 UNC": unified(0.375, 16, "UNC", 0.313),
  "1/2-13 UNC": unified(0.5, 13, "UNC", 0.422),
  "#4-48 UNF": unified(0.112, 48, "UNF", 0.094),
  "#6-40 UNF": unified(0.138, 40, "UNF", 0.113),
  "#8-36 UNF": unified(0.164, 36, "UNF", 0.136),
  "#10-32 UNF": unified(0.19, 32, "UNF", 0.159),
  "1/4-28 UNF": unified(0.25, 28, "UNF", 0.213),
  "5/16-24 UNF": unified(0.3125, 24, "UNF", 0.272),
  "3/8-24 UNF": unified(0.375, 24, "UNF", 0.332),
  "1/2-20 UNF": unified(0.5, 20, "UNF", 0.453),
} as const satisfies Record<string, ThreadSpec>;

export type ThreadSize = keyof typeof THREADS;
export const THREAD_SIZES = Object.keys(THREADS) as ThreadSize[];
export const isThreadSize = (v: unknown): v is ThreadSize => typeof v === "string" && v in THREADS;

/** How much bigger a printed threaded hole is (and smaller a printed bolt) than the ISO size, across. */
export const DEFAULT_FIT = 0.3;
export const MAX_FIT = 1;

/** The tooth's corners in the plane through the axis: [radius, height] pairs, centred on height 0. */
export interface ThreadProfile {
  pitch: number;
  /** Radius of the crests (the outside of a bolt, the inside of the groove of a hole). */
  major: number;
  /** Radius of the core the teeth stand on. */
  minor: number;
  /** Width of the tooth where it meets the core, and at its crest. */
  rootWidth: number;
  crestWidth: number;
}

/**
 * The thread's shape. `external` is a bolt or threaded rod (made smaller by the fit), otherwise it is the space
 * a threaded hole leaves (made bigger by the fit).
 */
export function threadProfile(size: ThreadSize, fit: number, external: boolean): ThreadProfile {
  const { diameter, pitch } = THREADS[size];
  const H = (Math.sqrt(3) / 2) * pitch;
  const major = diameter / 2 + ((external ? -1 : 1) * fit) / 2;
  return {
    pitch,
    major,
    minor: major - (5 / 8) * H,
    rootWidth: (3 / 4) * pitch,
    crestWidth: pitch / 8,
  };
}

/**
 * Exact volume of a threaded solid `length` long: the core cylinder plus the teeth. The teeth form a helical band,
 * which has the same volume in every slice of the same height, so a length L holds L / pitch turns of tooth, and one
 * turn of a tooth sweeping around the axis has volume (tooth area) × 2π × (radius of the tooth's centroid).
 */
export function threadVolume(t: ThreadProfile, length: number): number {
  const h = t.major - t.minor;
  const a = t.rootWidth;
  const b = t.crestWidth;
  const area = ((a + b) / 2) * h;
  const centroid = t.minor + (h * (a + 2 * b)) / (3 * (a + b));
  return Math.PI * t.minor ** 2 * length + (length / t.pitch) * area * 2 * Math.PI * centroid;
}

/** "M5 × 0.8", "M10 × 1.25 fine", "1/4-20 UNC" */
export function threadLabel(size: ThreadSize): string {
  const t: ThreadSpec = THREADS[size];
  if (t.standard === "ISO coarse") return `${size} × ${t.pitch}`;
  if (t.standard === "ISO fine") return `${size.replace("x", " × ")} fine`;
  return size;
}

/** The drill a thread is tapped from, mm: the sourced size, or major diameter − pitch (the usual rule). */
export function tapDrill(size: ThreadSize): number {
  const t: ThreadSpec = THREADS[size];
  return t.tapDrill ?? Math.round((t.diameter - t.pitch) * 100) / 100;
}

export const THREAD_STANDARDS: ThreadStandard[] = ["ISO coarse", "ISO fine", "UNC", "UNF"];

/** Metric screw sizes that clearance holes, counterbores and countersinks are given for. */
export const SCREW_SIZES = ["M3", "M4", "M5", "M6", "M8", "M10", "M12", "M16", "M20"] as const;
export type ScrewSize = (typeof SCREW_SIZES)[number];
export const isScrewSize = (v: unknown): v is ScrewSize => SCREW_SIZES.includes(v as ScrewSize);

/** ISO 273 clearance hole series: fine (close), medium (normal) and coarse (loose). */
export type ClearanceSeries = "fine" | "medium" | "coarse";
export const CLEARANCE_SERIES: ClearanceSeries[] = ["fine", "medium", "coarse"];
export const CLEARANCE_LABELS: Record<ClearanceSeries, string> = {
  fine: "Close",
  medium: "Normal",
  coarse: "Loose",
};

/** ISO 273 clearance hole diameters, mm (Albany County Fasteners and AMES agree on every value). */
export const CLEARANCE: Record<ScrewSize, Record<ClearanceSeries, number>> = {
  M3: { fine: 3.2, medium: 3.4, coarse: 3.6 },
  M4: { fine: 4.3, medium: 4.5, coarse: 4.8 },
  M5: { fine: 5.3, medium: 5.5, coarse: 5.8 },
  M6: { fine: 6.4, medium: 6.6, coarse: 7 },
  M8: { fine: 8.4, medium: 9, coarse: 10 },
  M10: { fine: 10.5, medium: 11, coarse: 12 },
  M12: { fine: 13, medium: 13.5, coarse: 14.5 },
  M16: { fine: 17, medium: 17.5, coarse: 18.5 },
  M20: { fine: 21, medium: 22, coarse: 24 },
};

/**
 * Starting sizes for a counterbore for an ISO 4762 socket head cap screw: the diameter from MISUMI's JIS B 1176
 * table, and the depth = the screw's largest head height (k max, ISO 4762), so the head sits flush.
 */
export const COUNTERBORE: Record<ScrewSize, { diameter: number; depth: number }> = {
  M3: { diameter: 6.5, depth: 3 },
  M4: { diameter: 8, depth: 4 },
  M5: { diameter: 9.5, depth: 5 },
  M6: { diameter: 11, depth: 6 },
  M8: { diameter: 14, depth: 8 },
  M10: { diameter: 17.5, depth: 10 },
  M12: { diameter: 20, depth: 12 },
  M16: { diameter: 26, depth: 16 },
  M20: { diameter: 32, depth: 20 },
};

/**
 * Starting diameter for a 90° countersink for an ISO 10642 countersunk screw: the head's theoretical largest
 * diameter (dk theoretical max), so the head sits flush. ISO 15065's own seat table couldn't be checked.
 */
export const COUNTERSINK: Record<ScrewSize, number> = {
  M3: 6.72,
  M4: 8.96,
  M5: 11.2,
  M6: 13.44,
  M8: 17.92,
  M10: 22.4,
  M12: 26.88,
  M16: 33.6,
  M20: 40.32,
};
