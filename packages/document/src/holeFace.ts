// Holes on any flat face, placed by their distances from the face's edges. The face is stored as it was picked, and
// when it is a side of a box the hole follows the box: the face is worked out again from the box's current size and
// place, and the hole keeps its distances from the edges it is measured from.
import type { BoxFeature, HoleFeature, Issue, ProjectDocument } from "./model";
import {
  add3,
  axesFor,
  cross,
  dot,
  faceLabel,
  scale,
  toWorld,
  type Point2,
  type SketchPlane,
  type Vec3,
} from "./sketch";
import { lengthText } from "./units";

export type BoxSide = "top" | "bottom" | "front" | "back" | "left" | "right";
/** Which edge a hole's position across the face is measured from; "centre" measures from the middle. */
export type AcrossFrom = "left" | "right" | "centre";
/** Which edge a hole's position up the face is measured from; "centre" measures from the middle. */
export type UpFrom = "bottom" | "top" | "centre";

/** A flat face a hole is drilled into, square to the face. */
export interface HoleFace {
  /** The face's plane: its origin is the face's bottom-left corner and its normal points out of the part. */
  plane: SketchPlane;
  /** What the face is, in plain words: "front face". */
  surface: string;
  width: number;
  height: number;
  /** When the face is a side of a box: the hole follows that box when it is resized or moved. */
  on?: { shape: string; side: BoxSide };
  /** x is measured across from this edge (or from the middle). */
  across: AcrossFrom;
  /** y is measured up from this edge (or from the middle). */
  up: UpFrom;
}

export const ACROSS_LABELS: Record<AcrossFrom, string> = { left: "Left", right: "Right", centre: "Middle" };
export const UP_LABELS: Record<UpFrom, string> = { bottom: "Bottom", top: "Top", centre: "Middle" };

const SIDE_NORMALS: Record<BoxSide, Vec3> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const tidy3 = (v: Vec3): Vec3 => [tidy(v[0]), tidy(v[1]), tidy(v[2])];

/** A direction turned about the upright axis, anticlockwise seen from above. */
export function turnZ(v: Vec3, deg: number): Vec3 {
  if (!deg) return v;
  const a = (deg * Math.PI) / 180;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
}

/** Which side of a box (turned by `turn` degrees) a face pointing along `normal` is, if it's one of the six. */
export function boxSideOf(normal: Vec3, turn = 0): BoxSide | null {
  const own = turnZ(normal, -turn);
  for (const [side, n] of Object.entries(SIDE_NORMALS) as [BoxSide, Vec3][]) if (dot(n, own) > 0.999) return side;
  return null;
}

/**
 * Whether holes on this side of this box can follow it. Only a box that adds material has its sides on the outside
 * of the part, and the top of an open container is its rim, not a flat face.
 */
export const canFollow = (box: BoxFeature, side: BoxSide) => box.mode === "add" && !(side === "top" && box.wall > 0);

/** One side of a box as a face: its plane (origin at the bottom-left corner), size and name. */
export function boxSideFace(box: BoxFeature, side: BoxSide): Pick<HoleFace, "plane" | "surface" | "width" | "height"> {
  const n = SIDE_NORMALS[side];
  const { xDir, normal } = axesFor(n);
  const yDir = cross(normal, xDir);
  const half: Vec3 = [box.width / 2, box.depth / 2, box.height / 2];
  const along = (d: Vec3) => Math.abs(d[0]) * half[0] + Math.abs(d[1]) * half[1] + Math.abs(d[2]) * half[2];
  const centre = add3([box.x, box.y, box.z + box.height / 2], scale(normal, along(normal)));
  const [hw, hh] = [along(xDir), along(yDir)];
  const origin = add3(centre, add3(scale(xDir, -hw), scale(yDir, -hh)));
  // A turned box: the side turns with it, about the box's upright middle line.
  const turn = box.rotation ?? 0;
  const about = (p: Vec3): Vec3 => add3(turnZ([p[0] - box.x, p[1] - box.y, p[2]], turn), [box.x, box.y, 0]);
  return {
    plane: { origin: tidy3(about(origin)), xDir: tidy3(turnZ(xDir, turn)), normal: tidy3(turnZ(normal, turn)) },
    surface: faceLabel(turnZ(normal, turn)),
    width: tidy(2 * hw),
    height: tidy(2 * hh),
  };
}

/** The face as it is now: from its box when it follows one that still exists, else as it was picked. */
export function currentFace(doc: ProjectDocument, face: HoleFace): HoleFace {
  if (!face.on) return face;
  const { shape, side } = face.on;
  const box = doc.features.find((f): f is BoxFeature => f.id === shape && f.type === "box");
  if (!box || !canFollow(box, side)) return face;
  return { ...face, ...boxSideFace(box, side) };
}

/** Where a hole's centre is on its face, measured from the face's bottom-left corner. */
export function holeCentre(face: HoleFace, x: number, y: number): Point2 {
  const u = face.across === "left" ? x : face.across === "right" ? face.width - x : face.width / 2 + x;
  const v = face.up === "bottom" ? y : face.up === "top" ? face.height - y : face.height / 2 + y;
  return [u, v];
}

/** The x and y that put a hole's centre at (u, v) on the face when measured from the given edges. */
export function measuredFrom(face: HoleFace, [u, v]: Point2, across: AcrossFrom, up: UpFrom): { x: number; y: number } {
  const x = across === "left" ? u : across === "right" ? face.width - u : u - face.width / 2;
  const y = up === "bottom" ? v : up === "top" ? face.height - v : v - face.height / 2;
  return { x: tidy(x), y: tidy(y) };
}

/** The hole's centre on the face in 3D, and the direction it drills (into the part). */
export function holeAxis(face: HoleFace, x: number, y: number): { point: Vec3; direction: Vec3 } {
  return { point: toWorld(face.plane, holeCentre(face, x, y)), direction: scale(face.plane.normal, -1) };
}

const fmt = (n: number) => lengthText(n);
/** Thinner than this between a hole and an edge, and the edge may not print (the same rule as top holes). */
const MIN_WALL = 0.4;

/**
 * Checks a hole against the edges of its face. A hole that runs off an edge is refused, naming the edge, and one
 * that leaves a very thin edge gets a warning. Nothing is moved to make it fit.
 */
export function faceEdgeIssues(h: HoleFeature, face: HoleFace, radius: number): Issue[] {
  const [u, v] = holeCentre(face, h.x, h.y);
  const sides = [
    ["x", u - radius, "left"],
    ["x", face.width - u - radius, "right"],
    ["y", v - radius, "bottom"],
    ["y", face.height - v - radius, "top"],
  ] as const;
  const issue = (severity: "error" | "warning", field: string, message: string): Issue => ({
    severity,
    featureId: h.id,
    field,
    message,
  });
  for (const [field, gap, side] of sides) {
    if (gap < -1e-9)
      return [
        issue(
          "error",
          field,
          `${h.name} runs off the ${side} edge of the ${face.surface}. Move it in or make it smaller.`,
        ),
      ];
  }
  const closest = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (closest[1] < MIN_WALL)
    return [
      issue(
        "warning",
        closest[0],
        `Only ${fmt(closest[1])} of material is left between ${h.name} and the ${closest[2]} edge of the ` +
          `${face.surface}. That may break or not print.`,
      ),
    ];
  return [];
}
