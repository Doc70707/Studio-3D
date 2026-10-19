// Threading a hole that is already in the part: the settings the Thread dialog offers, a thread size suggested from
// the hole's own size, and a check of the chosen thread against the hole, with a better size offered when it
// doesn't fit. The dialog previews and applies these as ordinary hole settings, so undo, saving and the kernel
// treat a hole threaded this way like any other threaded hole.
import type { HoleFeature } from "./model";
import {
  DEFAULT_FIT,
  THREADS,
  THREAD_SIZES,
  tapDrill,
  threadLabel,
  type ThreadSize,
  type ThreadStandard,
} from "./threads";

export interface ThreadSettings {
  thread: ThreadSize;
  hand: "right" | "left";
  /** How far the thread goes from the face, in mm; null threads the whole hole. */
  length: number | null;
  /** The hole's depth: 0 goes right through the part. */
  depth: number;
  /** Extra room across the thread so a printed part turns, in mm. */
  fit: number;
  /** Cosmetic: drilled at the tap drill size and marked, not modelled (quick, and small files). */
  cosmetic: boolean;
}

/** Fits for printing. Machined threads use tolerance classes such as 6H; a printed one needs room to turn instead. */
export const PRINT_FITS = [
  { label: "Snug", fit: 0.15, hint: "Tight; for a well-tuned printer" },
  { label: "Normal", fit: DEFAULT_FIT, hint: "Turns freely on most printers" },
  { label: "Loose", fit: 0.5, hint: "For a first try, or a rough printer" },
] as const;

const near = (a: number, b: number, within: number) => Math.abs(a - b) <= within;
const mm = (n: number) => `${Math.round(n * 100) / 100 + 0} mm`;

/**
 * The thread that suits a hole of this diameter: the one whose screw size or tap drill is closest to it (as a share
 * of the size), within one standard if given. Coarse metric comes first when two are equally close.
 */
export function suggestThread(diameter: number, standard?: ThreadStandard): ThreadSize {
  let best: ThreadSize = "M3";
  let score = Infinity;
  for (const size of THREAD_SIZES) {
    const t = THREADS[size];
    if (standard && t.standard !== standard) continue;
    const s = Math.min(Math.abs(diameter - t.diameter) / t.diameter, Math.abs(diameter - tapDrill(size)) / t.diameter);
    if (s < score - 1e-9) {
      score = s;
      best = size;
    }
  }
  return best;
}

/** The dialog's starting settings: the hole's own thread if it has one, else the size its diameter suggests. */
export function threadSettingsFor(h: HoleFeature): ThreadSettings {
  return {
    thread: h.thread ?? suggestThread(h.diameter),
    hand: h.hand === "left" ? "left" : "right",
    length: h.thread && h.threadDepth !== undefined ? h.threadDepth : null,
    depth: h.depth,
    fit: h.thread ? (h.fit ?? DEFAULT_FIT) : DEFAULT_FIT,
    cosmetic: h.thread ? !!h.simplified : false,
  };
}

/** The hole's settings with the thread applied. A thread replaces a clearance size or a head recess. */
export function withThread(h: HoleFeature, s: ThreadSettings): HoleFeature {
  const { clearance: _c, head: _h, threadDepth: _d, simplified: _s, hand: _hand, ...rest } = h;
  return {
    ...rest,
    thread: s.thread,
    fit: s.fit,
    depth: s.depth,
    ...(s.hand === "left" && { hand: "left" as const }),
    ...(s.length !== null && { threadDepth: s.length }),
    ...(s.cosmetic && { simplified: true }),
  };
}

export interface ThreadCheck {
  severity: "ok" | "warning" | "error";
  message: string;
  /** A size that suits this hole better, to offer as a fix. */
  better?: ThreadSize;
}

/**
 * Checks a thread against the hole it goes in (its diameter as drawn) and its length against the hole's depth.
 * `partHeight` is how deep a through hole is.
 */
export function checkThread(h: HoleFeature, s: ThreadSettings, partHeight: number): ThreadCheck[] {
  const out: ThreadCheck[] = [];
  const t = THREADS[s.thread];
  const tap = tapDrill(s.thread);
  const d = h.diameter;
  const grooves = t.diameter + s.fit;
  const label = threadLabel(s.thread);
  const better = suggestThread(d, t.standard);
  const offer = better !== s.thread ? { better } : {};
  if (near(d, t.diameter, Math.max(0.25, t.diameter * 0.04)))
    out.push({ severity: "ok", message: `Fits: the Ø${mm(d)} hole is the size of an ${label} screw.` });
  else if (near(d, tap, 0.3)) out.push({ severity: "ok", message: `Fits: Ø${mm(d)} is the ${label} tap drill.` });
  else if (d > grooves + 0.2)
    out.push({
      severity: "warning",
      message: `The Ø${mm(d)} hole is wider than the ${label} thread's grooves (Ø${mm(grooves)}), so the thread would have nothing to cut and the hole would shrink to fit it.`,
      ...offer,
    });
  else if (d < tap - 0.3)
    out.push({
      severity: "warning",
      message: `The Ø${mm(d)} hole is smaller than the ${label} tap drill (${mm(tap)}): threading it widens it to Ø${mm(s.cosmetic ? tap : grooves)}.`,
      ...offer,
    });
  else
    out.push({
      severity: "ok",
      message: `The hole changes from Ø${mm(d)} to the thread's size.`,
    });

  const deep = s.depth === 0 ? partHeight : s.depth;
  if (s.length !== null) {
    if (!(s.length > 0)) out.push({ severity: "error", message: "The thread length needs to be more than 0." });
    else if (s.length > deep + 1e-9)
      out.push({ severity: "error", message: `The thread can't be longer than the hole: use ${mm(deep)} or less.` });
  }
  const length = s.length ?? deep;
  if (length > 0 && length < 2 * t.pitch - 1e-9)
    out.push({
      severity: "error",
      message: `${label} needs at least two turns: make it at least ${mm(2 * t.pitch)} long.`,
    });
  if (s.cosmetic)
    out.push({
      severity: "ok",
      message: `Cosmetic: printed as a plain Ø${mm(tap)} hole and marked ${label}. Tap it, or use a thread-forming screw.`,
    });
  return out;
}

/** "M6 × 1 (1 mm pitch)", "1/4-20 UNC (20 threads per inch)". */
export function pitchLabel(size: ThreadSize): string {
  const t = THREADS[size];
  if (t.standard === "UNC" || t.standard === "UNF") return `${Math.round(25.4 / t.pitch)} threads per inch`;
  return `${t.pitch} mm pitch`;
}
