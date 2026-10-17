// Typing exact sizes while drawing, like AutoCAD's dynamic input: after the first click, the numbers you type go into
// small boxes at the pointer (Tab moves to the next box) and Enter finishes the shape with them. A box you haven't
// typed in follows the pointer. Pure functions, so they are unit-tested without a screen.
import type { Point2 } from "@studio3d/document";

export type DrawKind = "rectangle" | "circle" | "polygon";

/** The boxes shown for each kind of shape, in Tab order. */
export const TYPED_FIELDS: Record<DrawKind, readonly string[]> = {
  rectangle: ["Width", "Height"],
  circle: ["Diameter"],
  polygon: ["Length", "Angle"],
};

export interface Typed {
  /** What has been typed in each box ("" = follow the pointer). */
  values: string[];
  /** Which box the next key goes to. */
  active: number;
}

export const startTyping = (kind: DrawKind): Typed => ({ values: TYPED_FIELDS[kind].map(() => ""), active: 0 });

/** A typed box's number, or null when it is empty or not a number yet (like "-" or "."). */
export function typedNumber(text: string | undefined): number | null {
  if (!text || !/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  return Number(text);
}

/**
 * Applies one key to the boxes. Returns the new boxes, or null when the key isn't for them (so it can do its usual
 * job). Digits, "." and "-" type; Backspace deletes (only while there is something to delete); Tab moves on.
 */
export function typeKey(t: Typed, key: string, shift = false): Typed | null {
  const values = [...t.values];
  const cur = values[t.active] ?? "";
  if (/^[0-9]$/.test(key) || (key === "." && !cur.includes("."))) {
    values[t.active] = cur + key;
    return { ...t, values };
  }
  if (key === "-") {
    values[t.active] = cur.startsWith("-") ? cur.slice(1) : "-" + cur;
    return { ...t, values };
  }
  if (key === "Backspace" && cur) {
    values[t.active] = cur.slice(0, -1);
    return { ...t, values };
  }
  if (key === "Tab") {
    const n = values.length;
    return { ...t, active: (t.active + (shift ? n - 1 : 1)) % n };
  }
  return null;
}

export const anyTyped = (t: Typed | null) => !!t && t.values.some((v) => typedNumber(v) !== null);

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Where the shape's second point is: from the pointer, with every typed size taking the place of the pointer's.
 * - rectangle from `from` (first corner): the opposite corner, on the side of the pointer;
 * - circle around `from` (centre): a point on the edge, towards the pointer;
 * - outline from `from` (last corner): the next corner. Angles are in degrees, 0 to the right, counter-clockwise.
 */
export function typedPoint(kind: DrawKind, from: Point2, pointer: Point2 | null, t: Typed | null): Point2 {
  const p = pointer ?? [from[0] + 1, from[1] + 1];
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const v = (i: number) => (t ? typedNumber(t.values[i]) : null);
  if (kind === "rectangle") {
    const w = v(0);
    const h = v(1);
    // A negative typed size draws to the other side; otherwise the pointer says which side.
    const x = w === null ? p[0] : from[0] + (w < 0 ? w : (dx < 0 ? -1 : 1) * w);
    const y = h === null ? p[1] : from[1] + (h < 0 ? h : (dy < 0 ? -1 : 1) * h);
    return [round(x), round(y)];
  }
  const dist = Math.hypot(dx, dy);
  if (kind === "circle") {
    const d = v(0);
    if (d === null) return p;
    const [ux, uy] = pointer && dist > 1e-9 ? [dx / dist, dy / dist] : [1, 0];
    const r = Math.abs(d) / 2;
    return [round(from[0] + ux * r), round(from[1] + uy * r)];
  }
  const len = v(0) ?? dist;
  const typedAngle = v(1);
  const angle = typedAngle !== null ? (typedAngle * Math.PI) / 180 : dist > 1e-9 ? Math.atan2(dy, dx) : 0;
  if (v(0) === null && typedAngle === null) return p;
  return [round(from[0] + len * Math.cos(angle)), round(from[1] + len * Math.sin(angle))];
}

/** What each box shows while nothing is typed in it: the size the pointer gives right now. */
export function liveValues(kind: DrawKind, from: Point2, to: Point2): string[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (kind === "rectangle") return [String(round(Math.abs(dx))), String(round(Math.abs(dy)))];
  if (kind === "circle") return [String(round(2 * Math.hypot(dx, dy)))];
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return [String(round(Math.hypot(dx, dy))), String(round(deg < 0 ? deg + 360 : deg))];
}
