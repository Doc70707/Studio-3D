// Precise drafting for outlines, like AutoCAD: typed coordinates (x,y  @dx,dy  @length<angle), ortho lock and angle
// steps, object snaps (end, middle, centre, quadrant, crossing, square to, on the line), sides by length and bearing,
// and editing one side of an outline so the sides after it follow. Pure functions, so they are unit-tested without a screen.
import type { Point2, Profile } from "@studio3d/document";

/** Points worked out from typed lengths and angles keep 6 decimals, so a chain of sides doesn't drift. */
export const exact = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const exactPoint = (p: Point2): Point2 => [exact(p[0]), exact(p[1])];

const NUM = String.raw`\s*(-?(?:\d+\.?\d*|\.\d+))\s*`;
const ABSOLUTE = new RegExp(`^${NUM},${NUM}$`);
const RELATIVE = new RegExp(`^@${NUM},${NUM}$`);
const POLAR = new RegExp(`^@${NUM}<${NUM}$`);

/**
 * A typed point, AutoCAD style: `x,y` is measured from the sketch's origin, `@dx,dy` from the last point and
 * `@length<angle` goes that far from the last point at that angle (degrees, 0 = right, counter-clockwise).
 * Null while it isn't a complete point yet.
 */
export function parsePoint(text: string, last: Point2): Point2 | null {
  let m = ABSOLUTE.exec(text);
  if (m) return exactPoint([Number(m[1]), Number(m[2])]);
  m = RELATIVE.exec(text);
  if (m) return exactPoint([last[0] + Number(m[1]), last[1] + Number(m[2])]);
  m = POLAR.exec(text);
  if (m) {
    const len = Number(m[1]);
    const a = (Number(m[2]) * Math.PI) / 180;
    return exactPoint([last[0] + len * Math.cos(a), last[1] + len * Math.sin(a)]);
  }
  return null;
}

/** Characters a typed point can contain. */
export const isPointKey = (key: string) => /^[0-9.,@<-]$/.test(key);

export interface Direction {
  /** Ortho lock (F8): sides go only left, right, up or down. */
  ortho: boolean;
  /** Angle steps, in degrees: the pointer clicks to the nearest multiple when it's close. 0 = off. */
  step: number;
}

/** How close (degrees) the pointer must be to a step's angle for it to click onto it. */
const STEP_PULL = 4;

/**
 * Where the next corner goes from `from` towards the pointer, with ortho or angle steps applied. With ortho the side
 * is straight across or up, whichever is nearer the pointer; with steps it clicks to the nearest step's angle when
 * within a few degrees. The length is how far the pointer is along that direction, rounded to `grid`.
 * Returns the point and the angle it was held to (null when nothing held it).
 */
export function constrain(
  from: Point2,
  pointer: Point2,
  d: Direction,
  grid: number,
): { point: Point2; angle: number | null } {
  const dx = pointer[0] - from[0];
  const dy = pointer[1] - from[1];
  if (Math.hypot(dx, dy) < 1e-9) return { point: pointer, angle: null };
  let angle: number | null = null;
  if (d.ortho) angle = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : dy >= 0 ? 90 : 270;
  else if (d.step > 0) {
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const near = Math.round(deg / d.step) * d.step;
    if (Math.abs(deg - near) <= STEP_PULL) angle = (near + 360) % 360;
  }
  if (angle === null) return { point: pointer, angle: null };
  const a = (angle * Math.PI) / 180;
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  const len = grid > 0 ? Math.round(along / grid) * grid : along;
  return { point: exactPoint([from[0] + len * Math.cos(a), from[1] + len * Math.sin(a)]), angle };
}

export type SnapKind = "end" | "middle" | "centre" | "quadrant" | "intersection" | "perpendicular" | "nearest";
export interface Snap {
  kind: SnapKind;
  point: Point2;
}
/** When two snaps are equally near, the first in this list wins. */
const PRIORITY: SnapKind[] = ["end", "intersection", "middle", "centre", "quadrant", "perpendicular", "nearest"];
export const SNAP_LABELS: Record<SnapKind, string> = {
  end: "End",
  middle: "Middle",
  centre: "Centre",
  quadrant: "Quadrant",
  intersection: "Crossing",
  perpendicular: "Square to",
  nearest: "On the line",
};
/** What each snap does, for the Snaps menu. */
export const SNAP_HINTS: Record<SnapKind, string> = {
  end: "Corners and the ends of sides",
  middle: "Halfway along a side",
  centre: "The middle of a circle",
  quadrant: "A circle's top, bottom, left and right",
  intersection: "Where two sides cross",
  perpendicular: "Square to a side, from the last corner",
  nearest: "Anywhere on a side or a circle",
};
export const SNAP_KINDS = PRIORITY;
/** On unless the user turns them off; "On the line" starts off, as in AutoCAD, since it grabs the pointer often. */
export const DEFAULT_SNAPS: readonly SnapKind[] = PRIORITY.filter((k) => k !== "nearest");

type Segment = [Point2, Point2];

/** The straight sides of a drawn shape (none for a circle). */
export function profileSides(p: Profile): Segment[] {
  if (p.kind === "circle") return [];
  const pts: Point2[] =
    p.kind === "rectangle"
      ? [
          [p.x, p.y],
          [p.x + p.width, p.y],
          [p.x + p.width, p.y + p.height],
          [p.x, p.y + p.height],
        ]
      : p.points;
  return pts.map((a, i) => [a, pts[(i + 1) % pts.length]!]);
}

/** The outside edges of a face given as triangles: edges that belong to only one triangle. */
export function boundaryEdges(triangles: Point2[]): Segment[] {
  const key = (a: Point2, b: Point2) => {
    const [p, q] = [a.join(","), b.join(",")];
    return p < q ? `${p}|${q}` : `${q}|${p}`;
  };
  const seen = new Map<string, { seg: Segment; n: number }>();
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const t = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
    for (let j = 0; j < 3; j++) {
      const seg: Segment = [t[j]!, t[(j + 1) % 3]!];
      const k = key(...seg);
      const e = seen.get(k);
      if (e) e.n++;
      else seen.set(k, { seg, n: 1 });
    }
  }
  return [...seen.values()].filter((e) => e.n === 1).map((e) => e.seg);
}

/** Where two sides cross, if they do (touching at an end counts). */
export function crossing([a, b]: Segment, [c, d]: Segment): Point2 | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0]! * s[1]! - r[1]! * s[0]!;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1]! - (c[1] - a[1]) * s[0]!) / den;
  const u = ((c[0] - a[0]) * r[1]! - (c[1] - a[1]) * r[0]!) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return [a[0] + t * r[0]!, a[1] + t * r[1]!];
}

/** The foot of the line from `p` square to the side, if it lands on the side. */
export function foot(p: Point2, [a, b]: Segment): Point2 | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t < 1e-9 || t > 1 - 1e-9) return null;
  return [a[0] + t * dx, a[1] + t * dy];
}

export interface SnapScene {
  /** Corners to snap to that aren't the ends of a side (e.g. the corners already placed). */
  points: Point2[];
  /** Straight sides: their ends, middles and crossings are snap points. */
  sides: Segment[];
  /** Circles: centres, quadrants and points on them. */
  circles: { centre: Point2; radius: number }[];
}

/** Everything in the sketch worth snapping to. */
export function snapScene(profiles: Profile[], faceEdges: Segment[], drawing: Point2[]): SnapScene {
  const sides = [...faceEdges, ...profiles.flatMap(profileSides)];
  for (let i = 0; i + 1 < drawing.length; i++) sides.push([drawing[i]!, drawing[i + 1]!]);
  return {
    points: drawing.slice(0, 1),
    sides,
    circles: profiles.flatMap((p) =>
      p.kind === "circle" ? [{ centre: [p.x, p.y] as Point2, radius: p.diameter / 2 }] : [],
    ),
  };
}

/**
 * The snap nearest the pointer within `radius` (in screen pixels, measured with `toScreen`), or null. `from` is the
 * last corner placed: sides get a "square to" snap from it. Only the kinds in `kinds` are used. "On the line" only
 * applies when no other snap is near, so it never hides an end or a middle.
 */
export function findSnap(
  scene: SnapScene,
  pointer: Point2,
  from: Point2 | null,
  radius: number,
  toScreen: (p: Point2) => Point2,
  kinds: readonly SnapKind[] = DEFAULT_SNAPS,
): Snap | null {
  const [px, py] = toScreen(pointer);
  let best: Snap | null = null;
  let bestD = radius;
  const consider = (kind: SnapKind, point: Point2 | null) => {
    if (!point || !kinds.includes(kind)) return;
    const [sx, sy] = toScreen(point);
    const d = Math.hypot(sx - px, sy - py);
    const better =
      d < bestD - 1e-6 || (best && Math.abs(d - bestD) <= 1e-6 && PRIORITY.indexOf(kind) < PRIORITY.indexOf(best.kind));
    if (better) {
      bestD = d;
      best = { kind, point: exactPoint(point) };
    }
  };
  for (const p of scene.points) consider("end", p);
  for (const [a, b] of scene.sides) {
    consider("end", a);
    consider("end", b);
    consider("middle", [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    if (from) consider("perpendicular", foot(from, [a, b]));
  }
  for (const { centre: c, radius: r } of scene.circles) {
    consider("centre", c);
    for (const [dx, dy] of [
      [r, 0],
      [0, r],
      [-r, 0],
      [0, -r],
    ] as const)
      consider("quadrant", [c[0] + dx, c[1] + dy]);
  }
  // Crossings: only of sides near the pointer, so a busy sketch stays quick.
  const reach = radius * 2;
  const near = scene.sides.filter(([a, b]) => {
    const q = foot(pointer, [a, b]);
    const ends = [a, b].map((e) => Math.hypot(toScreen(e)[0] - px, toScreen(e)[1] - py));
    if (!q) return Math.min(...ends) <= reach;
    const [qx, qy] = toScreen(q);
    return Math.hypot(qx - px, qy - py) <= reach;
  });
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) consider("intersection", crossing(near[i]!, near[j]!));
  if (!best) {
    for (const side of near) consider("nearest", foot(pointer, side));
    for (const { centre: c, radius: r } of scene.circles) {
      const d = Math.hypot(pointer[0] - c[0], pointer[1] - c[1]);
      if (d > 1e-9) consider("nearest", [c[0] + ((pointer[0] - c[0]) * r) / d, c[1] + ((pointer[1] - c[1]) * r) / d]);
    }
  }
  return best;
}

/** One side of an outline: from corner i to the next, with its length and angle (degrees, 0-360). */
export function sideOf(points: Point2[], i: number): { length: number; angle: number } {
  const a = points[i]!;
  const b = points[(i + 1) % points.length]!;
  const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { length: Math.hypot(b[0] - a[0], b[1] - a[1]), angle: deg < 0 ? deg + 360 : deg };
}

/**
 * Changes the length or angle of side i (from corner i to i + 1) of a closed outline. The corners after it move with
 * it, keeping their own sides' lengths and angles, and the closing side (last corner back to the first) takes up the
 * difference. The closing side itself can't be set this way, so i must be below the last corner.
 */
export function editSide(points: Point2[], i: number, change: { length?: number; angle?: number }): Point2[] {
  if (i < 0 || i >= points.length - 1) throw new Error(`Side ${i + 1} can't be edited directly`);
  const cur = sideOf(points, i);
  const length = change.length ?? cur.length;
  const angle = ((change.angle ?? cur.angle) * Math.PI) / 180;
  const a = points[i]!;
  const b = points[i + 1]!;
  const nb: Point2 = [a[0] + length * Math.cos(angle), a[1] + length * Math.sin(angle)];
  const dx = nb[0] - b[0];
  const dy = nb[1] - b[1];
  return points.map((p, j) => (j <= i ? p : exactPoint([p[0] + dx, p[1] + dy])));
}

/** Halfway between two points (AutoCAD's "mid between 2 points"). */
export const midBetween = (a: Point2, b: Point2): Point2 => exactPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);

/**
 * A direction typed as a surveyor's bearing (N 45° E, S12.5W, N 30 15 E for 30°15') or as a plain angle in degrees
 * (0 = right, 90 = up, turning anticlockwise, as in AutoCAD). Returns the angle in degrees, 0 to 360, or null.
 * On the sketch, up (+y) is north and right (+x) is east.
 */
export function parseDirection(text: string): number | null {
  const t = text.toUpperCase().replace(/[°'"]/g, " ").replace(/\s+/g, " ").trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const a = Number(t) % 360;
    return exact(a < 0 ? a + 360 : a);
  }
  const m = /^([NS]) ?(\d+(?:\.\d+)?)(?: (\d+(?:\.\d+)?))?(?: (\d+(?:\.\d+)?))? ?([EW])$/.exec(t);
  if (!m) return null;
  const [min, sec] = [Number(m[3] ?? 0), Number(m[4] ?? 0)];
  if (min >= 60 || sec >= 60) return null;
  const theta = Number(m[2]) + min / 60 + sec / 3600;
  if (theta > 90) return null;
  const a = m[1] === "N" ? (m[5] === "E" ? 90 - theta : 90 + theta) : m[5] === "E" ? 270 + theta : 270 - theta;
  return exact(((a % 360) + 360) % 360);
}

/** An angle (0 = right, anticlockwise) as a bearing, e.g. 30 → "N 60° E", to the nearest second. */
export function formatBearing(angle: number): string {
  const a = ((angle % 360) + 360) % 360;
  const north = a <= 180;
  const fromNS = north ? Math.abs(90 - a) : Math.abs(270 - a);
  const east = north ? a < 90 : a > 270;
  if (fromNS < 1e-9) return north ? "N" : "S";
  if (Math.abs(fromNS - 90) < 1e-9) return east ? "E" : "W";
  const total = Math.round(fromNS * 3600);
  const [d, mi, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const dms = `${d}°${mi || s ? ` ${String(mi).padStart(2, "0")}'` : ""}${s ? ` ${String(s).padStart(2, "0")}"` : ""}`;
  return `${north ? "N" : "S"} ${dms} ${east ? "E" : "W"}`;
}

/** The end of a side `length` long from `from` in the direction `angle` (degrees). */
export const along = (from: Point2, length: number, angle: number): Point2 => {
  const a = (angle * Math.PI) / 180;
  return exactPoint([from[0] + length * Math.cos(a), from[1] + length * Math.sin(a)]);
};

/**
 * The corners of a regular polygon (a hexagon for a nut trap, say) around `centre`. It is sized across its flats,
 * the way nuts and bolt heads are, and turned so the middle of one flat points at `facing` (degrees).
 */
export function regularPolygon(centre: Point2, acrossFlats: number, sides: number, facing = 0): Point2[] {
  const corner = acrossFlats / 2 / Math.cos(Math.PI / sides);
  const first = (facing * Math.PI) / 180 + Math.PI / sides;
  return Array.from({ length: sides }, (_, i) => {
    const a = first + (2 * Math.PI * i) / sides;
    return exactPoint([centre[0] + corner * Math.cos(a), centre[1] + corner * Math.sin(a)]);
  });
}
