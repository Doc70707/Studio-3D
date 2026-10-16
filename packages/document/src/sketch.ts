// Sketches: flat outlines drawn on a face of the part (or on the build plate) and pushed out into 3D.
// The surface a sketch sits on is stored as plain numbers (a corner point and two directions), not as a
// reference to a face. Faces get renumbered whenever the part changes; numbers don't.

export type Vec3 = [number, number, number];
export type Point2 = [number, number];

/** Where a sketch is drawn: its (0, 0) corner, the direction of its x axis, and the direction it faces. */
export interface SketchPlane {
  origin: Vec3;
  xDir: Vec3;
  normal: Vec3;
}

/** A rectangle given by its bottom-left corner and its size, in sketch coordinates. */
export interface RectangleProfile {
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A circle given by its centre. */
export interface CircleProfile {
  kind: "circle";
  x: number;
  y: number;
  diameter: number;
}

/** A closed outline through any number of corners. The last corner joins back to the first. */
export interface PolygonProfile {
  kind: "polygon";
  points: Point2[];
}

export type Profile = RectangleProfile | CircleProfile | PolygonProfile;
export type ProfileKind = Profile["kind"];

export const PROFILE_LABELS: Record<ProfileKind, string> = {
  rectangle: "Rectangle",
  circle: "Circle",
  polygon: "Outline",
};

// Small vector helpers. Plain functions over arrays so they work in the worker and the UI alike.
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const length3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length3(a));

/** The sketch's y axis: up in the drawing. */
export const yDirOf = (p: SketchPlane): Vec3 => cross(p.normal, p.xDir);

/** A point of the sketch, in 3D. */
export function toWorld(p: SketchPlane, [u, v]: Point2, lift = 0): Vec3 {
  return add3(
    add3(add3(p.origin, scale(p.xDir, u)), scale(yDirOf(p), v)),
    scale(p.normal, lift),
  );
}

/** A 3D point, in sketch coordinates. */
export function toSketch(p: SketchPlane, q: Vec3): Point2 {
  const d: Vec3 = [q[0] - p.origin[0], q[1] - p.origin[1], q[2] - p.origin[2]];
  return [dot(d, p.xDir), dot(d, yDirOf(p))];
}

/**
 * The drawing directions for a flat face that points along `normal`: x runs along the plate's x axis on
 * flat faces, and level with the plate on side faces, so "up" in the drawing is up in the world.
 */
export function axesFor(normal: Vec3): { xDir: Vec3; normal: Vec3 } {
  const n = normalize(normal);
  if (Math.abs(n[2]) > 0.999)
    return { xDir: [1, 0, 0], normal: [0, 0, Math.sign(n[2])] };
  return {
    xDir: normalize(cross([0, 0, 1], n)).map((v) => v + 0) as Vec3,
    normal: n.map((v) => v + 0) as Vec3,
  };
}

/** A plain name for which way a face points, e.g. "top face". */
export function faceLabel(normal: Vec3): string {
  const n = normalize(normal);
  const names: [Vec3, string][] = [
    [[0, 0, 1], "top face"],
    [[0, 0, -1], "bottom face"],
    [[0, -1, 0], "front face"],
    [[0, 1, 0], "back face"],
    [[1, 0, 0], "right face"],
    [[-1, 0, 0], "left face"],
  ];
  for (const [d, name] of names) if (dot(n, d) > 0.999) return name;
  return "angled face";
}

export interface FaceOutline {
  plane: SketchPlane;
  /** Triangles that cover the face, in sketch coordinates (three points each). */
  triangles: Point2[];
  width: number;
  height: number;
  label: string;
}

/**
 * Turns a flat face of the displayed mesh into a sketch surface. The sketch's (0, 0) is the bottom-left
 * corner of the face, so every position reads as a distance from the face's left and bottom edges.
 * Returns null when the triangles don't lie in one flat plane (a curved face can't be sketched on).
 */
export function faceOutline(points: Vec3[]): FaceOutline | null {
  if (points.length < 3 || points.length % 3) return null;
  // The face's normal: the area-weighted sum of its triangles' normals.
  let sum: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i += 3) {
    const [a, b, c] = [points[i]!, points[i + 1]!, points[i + 2]!];
    sum = add3(
      sum,
      cross(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
      ),
    );
  }
  if (length3(sum) < 1e-9) return null;
  const { xDir, normal } = axesFor(sum);
  const yDir = cross(normal, xDir);
  const w = dot(points[0]!, normal);
  let size = 0;
  for (const q of points)
    size = Math.max(size, Math.abs(dot(q, xDir)), Math.abs(dot(q, yDir)));
  const tolerance = 1e-4 * Math.max(1, size);
  if (points.some((q) => Math.abs(dot(q, normal) - w) > tolerance)) return null;

  const us = points.map((q) => dot(q, xDir));
  const vs = points.map((q) => dot(q, yDir));
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  const plane: SketchPlane = {
    origin: add3(add3(scale(xDir, u0), scale(yDir, v0)), scale(normal, w)),
    xDir,
    normal,
  };
  return {
    plane: {
      origin: plane.origin.map(tidy) as Vec3,
      xDir: xDir.map(tidy) as Vec3,
      normal: normal.map(tidy) as Vec3,
    },
    triangles: us.map((u, i) => [tidy(u - u0), tidy(vs[i]! - v0)]),
    width: tidy(Math.max(...us) - u0),
    height: tidy(Math.max(...vs) - v0),
    label: faceLabel(normal),
  };
}

/** Rounds away floating-point dust (to a millionth of a millimetre) so stored numbers stay readable. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** The build plate as a sketch surface, with (0, 0) at the centre of the plate like every other position. */
export const PLATE_PLANE: SketchPlane = {
  origin: [0, 0, 0],
  xDir: [1, 0, 0],
  normal: [0, 0, 1],
};

/** Signed area of a closed outline (positive when its corners go anticlockwise). */
export function polygonArea(points: Point2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Flat area of one profile in mm². */
export function profileArea(p: Profile): number {
  switch (p.kind) {
    case "rectangle":
      return p.width * p.height;
    case "circle":
      return Math.PI * (p.diameter / 2) ** 2;
    case "polygon":
      return Math.abs(polygonArea(p.points));
  }
}

/** The smallest rectangle around a profile: [minX, minY, maxX, maxY]. */
export function profileBounds(p: Profile): [number, number, number, number] {
  switch (p.kind) {
    case "rectangle":
      return [p.x, p.y, p.x + p.width, p.y + p.height];
    case "circle": {
      const r = p.diameter / 2;
      return [p.x - r, p.y - r, p.x + r, p.y + r];
    }
    case "polygon": {
      const xs = p.points.map((q) => q[0]);
      const ys = p.points.map((q) => q[1]);
      return [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];
    }
  }
}

/** True when segment a-b crosses segment c-d (touching at a shared end doesn't count). */
function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const orient = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const scaleOf = Math.max(1, ...[a, b, c, d].flat().map(Math.abs));
  const eps = 1e-9 * scaleOf * scaleOf;
  const sign = (v: number) => (v > eps ? 1 : v < -eps ? -1 : 0);
  const o1 = sign(orient(a, b, c));
  const o2 = sign(orient(a, b, d));
  const o3 = sign(orient(c, d, a));
  const o4 = sign(orient(c, d, b));
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0)
    return true;
  // Collinear pieces that overlap, or a corner lying on another edge.
  const onSegment = (p: Point2, q: Point2, r: Point2) =>
    Math.min(p[0], q[0]) - 1e-9 <= r[0] &&
    r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
    Math.min(p[1], q[1]) - 1e-9 <= r[1] &&
    r[1] <= Math.max(p[1], q[1]) + 1e-9;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** True when the outline crosses or touches itself anywhere other than at neighbouring corners. */
export function selfIntersects(points: Point2[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const neighbours = j === i + 1 || (i === 0 && j === n - 1);
      if (neighbours) continue;
      if (
        segmentsCross(
          points[i]!,
          points[(i + 1) % n]!,
          points[j]!,
          points[(j + 1) % n]!,
        )
      )
        return true;
    }
  }
  return false;
}
