// ISO metric threads (ISO 261 coarse pitch, ISO 68-1 basic profile), sized for 3D printing.
//
// The tooth is the basic ISO profile: a 60° triangle of height H = (√3 / 2) × pitch, with H/8 cut off the crest
// (a flat p/8 wide at the major diameter) and H/4 off the root (a flat p/4 wide at the minor diameter). A printed
// thread also needs room to turn, so the whole profile is moved in by half the fit clearance for a bolt and out
// by half of it for a threaded hole.

export const THREADS = {
  M3: { diameter: 3, pitch: 0.5 },
  M4: { diameter: 4, pitch: 0.7 },
  M5: { diameter: 5, pitch: 0.8 },
  M6: { diameter: 6, pitch: 1 },
  M8: { diameter: 8, pitch: 1.25 },
  M10: { diameter: 10, pitch: 1.5 },
  M12: { diameter: 12, pitch: 1.75 },
  M16: { diameter: 16, pitch: 2 },
  M20: { diameter: 20, pitch: 2.5 },
} as const;

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

/** "M5 × 0.8" */
export const threadLabel = (size: ThreadSize) => `${size} × ${THREADS[size].pitch}`;
