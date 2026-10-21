// Object snaps on the 3D part, worked out from the kernel's own edges and faces (not from the display triangles):
// ends and middles of edges, centres and quadrants of circles and arcs, the centre of a flat face, a point square
// to an edge, the nearest point on an edge, and the plate's grid. Pure functions, unit-tested without a screen.
import type { EdgeInfo, FaceInfo } from "@studio3d/geometry";
import { lengthText } from "@studio3d/document";
import type { SnapKind } from "./precision";

export type Vec3 = [number, number, number];
export interface Snap3 {
  kind: SnapKind;
  point: Vec3;
}
export interface SnapModel {
  edges: readonly EdgeInfo[];
  faces: readonly FaceInfo[];
}

/** The snaps that mean something on a solid part. The others need a drawing's sides and points. */
export const SNAPS_3D: readonly SnapKind[] = [
  "end",
  "middle",
  "centre",
  "geometric",
  "quadrant",
  "perpendicular",
  "nearest",
  "grid",
];
/**
 * Snaps that only mean something in a sketch: a solid's edges meet at corners (End covers them), and tangents and
 * single points belong to drawing outlines.
 */
export const SKETCH_ONLY: readonly SnapKind[] = ["intersection", "tangent", "node"];
/** The plate's grid lines are 10 mm apart. */
export const PLATE_GRID = 10;
const PRIORITY: SnapKind[] = ["end", "middle", "centre", "geometric", "quadrant", "perpendicular", "nearest", "grid"];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A circle's top, bottom, left and right: along the world's directions laid into the circle's plane. */
export function quadrants(edge: EdgeInfo): Vec3[] {
  if (edge.kind !== "circle" || !edge.centre || !edge.axis || !edge.radius) return [];
  const n = unit(edge.axis);
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(sub(ref, scale(n, dot(ref, n))));
  const v = cross(n, u);
  const r = edge.radius;
  const c = edge.centre;
  const all = [scale(u, r), scale(v, r), scale(u, -r), scale(v, -r)].map((d) => add(c, d));
  if (edge.closed) return all;
  // On an arc, only the ones on the arc itself.
  return all.filter((q) => nearestOnPolyline(edge.points, q).d <= r * 0.02 + 1e-6);
}

/** The point on a polyline nearest to `p` in 3D, and how far it is. */
function nearestOnPolyline(points: readonly Vec3[], p: Vec3): { q: Vec3; d: number } {
  let best = { q: points[0]!, d: Infinity };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const ab = sub(points[i + 1]!, a);
    const len2 = dot(ab, ab);
    const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
    const q = add(a, scale(ab, t));
    const d = distance(p, q);
    if (d < best.d) best = { q, d };
  }
  return best;
}

/** The foot of the line from `from` square to a straight edge, when it lands on the edge. */
export function footOnEdge(from: Vec3, edge: EdgeInfo): Vec3 | null {
  if (edge.kind !== "line") return null;
  const ab = sub(edge.end, edge.start);
  const len2 = dot(ab, ab);
  if (len2 < 1e-18) return null;
  const t = dot(sub(from, edge.start), ab) / len2;
  if (t < 1e-9 || t > 1 - 1e-9) return null;
  return add(edge.start, scale(ab, t));
}

export interface SnapQuery {
  /** The pointer, in window pixels. */
  pointer: [number, number];
  /**
   * Where a model point is in the window, or null when behind the camera. A third number, when given, is its depth:
   * of two snaps at the same spot on screen (a top corner and the bottom corner under it), the nearer one wins.
   */
  toScreen: (p: Vec3) => [number, number] | [number, number, number] | null;
  /** How near (pixels) a snap must be. */
  radius: number;
  kinds: readonly SnapKind[];
  /** The first point of a measurement, for "square to". */
  from?: Vec3 | null;
  /** Where the pointer meets the plate when it isn't over the part, for the grid snap. */
  plate?: Vec3 | null;
}

/** The snap nearest the pointer, or null. "On the line" and the grid only apply when nothing else is near. */
export function findSnap3(model: SnapModel, q: SnapQuery): Snap3 | null {
  const [px, py] = q.pointer;
  let best: Snap3 | null = null;
  let bestD = q.radius;
  let bestZ = Infinity;
  const consider = (kind: SnapKind, point: Vec3 | null) => {
    if (!point || !q.kinds.includes(kind)) return;
    const s = q.toScreen(point);
    if (!s) return;
    const d = Math.hypot(s[0] - px, s[1] - py);
    const z = s[2] ?? 0;
    // Within half a pixel counts as the same spot: then the nearer to the eye, then the higher priority.
    const same = best && Math.abs(d - bestD) <= 0.5;
    const better =
      (!same && d < bestD) ||
      (same &&
        (z < bestZ - 1e-9 || (Math.abs(z - bestZ) <= 1e-9 && PRIORITY.indexOf(kind) < PRIORITY.indexOf(best!.kind))));
    if (better) {
      bestD = d;
      bestZ = z;
      best = { kind, point };
    }
  };
  for (const e of model.edges) {
    if (!e.closed) {
      consider("end", e.start);
      consider("end", e.end);
      consider("middle", e.middle);
    }
    if (e.kind === "circle") {
      consider("centre", e.centre ?? null);
      for (const p of quadrants(e)) consider("quadrant", p);
    }
    if (q.from) consider("perpendicular", footOnEdge(q.from, e));
  }
  for (const f of model.faces) if (f.kind === "plane") consider("geometric", f.centre);
  if (best) return best;
  if (q.kinds.includes("nearest")) {
    for (const e of model.edges)
      for (let i = 0; i + 1 < e.points.length; i++)
        consider("nearest", nearestOnScreen(e.points[i]!, e.points[i + 1]!, q));
    if (best) return best;
  }
  if (q.plate && q.kinds.includes("grid")) {
    const g = (v: number) => Math.round(v / PLATE_GRID) * PLATE_GRID + 0;
    return { kind: "grid", point: [g(q.plate[0]), g(q.plate[1]), 0] };
  }
  return null;
}

/** The point of a short 3D segment that looks nearest the pointer on screen. */
function nearestOnScreen(a: Vec3, b: Vec3, q: SnapQuery): Vec3 | null {
  const sa = q.toScreen(a);
  const sb = q.toScreen(b);
  if (!sa || !sb) return null;
  const dx = sb[0] - sa[0];
  const dy = sb[1] - sa[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((q.pointer[0] - sa[0]) * dx + (q.pointer[1] - sa[1]) * dy) / len2));
  return add(a, scale(sub(b, a), t));
}

/** What an edge or face is, in words, for the right-click menu. */
export function describeEdge(e: EdgeInfo): string {
  const mm = (n: number) => lengthText(n);
  if (e.kind === "line") return `Edge, ${mm(distance(e.start, e.end))} long`;
  if (e.kind === "circle") return `${e.closed ? "Circle" : "Arc"}, Ø${mm(2 * (e.radius ?? 0))}`;
  return "Curved edge";
}

/**
 * The edge under the pointer (within `radius` pixels on screen), if any. With `visible`, an edge hidden behind the
 * part there is left out, so a click picks the edge that is seen.
 */
export function edgeAt(
  model: SnapModel,
  q: Pick<SnapQuery, "pointer" | "toScreen" | "radius"> & { visible?: (p: Vec3) => boolean },
): number | null {
  let best: number | null = null;
  let bestD = q.radius;
  let bestDepth = Infinity;
  model.edges.forEach((e, i) => {
    for (let j = 0; j + 1 < e.points.length; j++) {
      const p = nearestOnScreen(e.points[j]!, e.points[j + 1]!, { ...q, kinds: [] });
      const s = p && q.toScreen(p);
      if (!s) continue;
      const d = Math.hypot(s[0] - q.pointer[0], s[1] - q.pointer[1]);
      // Edges drawn on top of each other (a block's top and bottom edges, seen from above): the nearer one wins.
      const depth = s[2] ?? 0;
      const closer = d < bestD - 0.5 || (d <= bestD + 0.5 && depth < bestDepth);
      if (d < q.radius && closer && (!q.visible || q.visible(p))) {
        bestD = Math.min(d, bestD);
        bestDepth = depth;
        best = i;
      }
    }
  });
  return best;
}
