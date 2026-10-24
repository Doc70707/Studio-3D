// Reference images: a photo or drawing placed in the scene to model over, at its real size. They are kept in the
// project (so they travel with it) but are never part of the model: nothing is built from them and they are not
// exported.
import { newId, type Issue } from "./model";
import { cross, toSketch, toWorld, type Point2, type SketchPlane, type Vec3 } from "./sketch";

/** Which way a reference image faces: lying on the plate (seen from the top), or standing up seen from the front or right. */
export type ReferencePlane = "top" | "front" | "right";

export const REFERENCE_PLANES: { plane: ReferencePlane; label: string }[] = [
  { plane: "top", label: "Top" },
  { plane: "front", label: "Front" },
  { plane: "right", label: "Right" },
];

export interface ReferenceImage {
  id: string;
  name: string;
  /** The picture, as a data: URL (PNG or JPEG). */
  src: string;
  /** The picture's size in pixels. */
  pixels: [number, number];
  /** Millimetres per pixel: set by calibrating against a known distance. */
  scale: number;
  /** Whether the scale came from a calibration rather than the starting guess. */
  calibrated: boolean;
  plane: ReferencePlane;
  /** Where the picture's middle is, in mm across and up as seen looking at it, from the middle of the plate. */
  x: number;
  y: number;
  /** How far in front of (or above) the plate's middle the picture sits, along the way it faces, in mm. */
  offset: number;
  /** Turned this many degrees anticlockwise, as seen looking at it. */
  rotation: number;
  /** 0.1 (faint) to 1 (solid). */
  opacity: number;
  visible: boolean;
  /** Drawn over the part instead of hidden behind it. */
  onTop: boolean;
}

export const MIN_OPACITY = 0.1;
/** A picture is shrunk to at most this many pixels across when added, to keep project files and backups small. */
export const MAX_REFERENCE_PIXELS = 2048;

const PLANE_AXES: Record<ReferencePlane, { xDir: Vec3; normal: Vec3 }> = {
  top: { xDir: [1, 0, 0], normal: [0, 0, 1] },
  front: { xDir: [1, 0, 0], normal: [0, -1, 0] },
  right: { xDir: [0, 1, 0], normal: [1, 0, 0] },
};

/** The plane a reference image lies in, with its origin at the plate's middle moved out by the offset. */
export function referencePlane(r: Pick<ReferenceImage, "plane" | "offset">): SketchPlane {
  const { xDir, normal } = PLANE_AXES[r.plane];
  return { origin: [normal[0] * r.offset, normal[1] * r.offset, normal[2] * r.offset], xDir, normal };
}

/** The picture's size in mm: its pixels times the scale. */
export const referenceSize = (r: ReferenceImage): [number, number] => [r.pixels[0] * r.scale, r.pixels[1] * r.scale];

/**
 * The picture's four corners in 3D, in the order bottom-left, bottom-right, top-right, top-left (as seen looking at
 * it), turned by its rotation about its middle.
 */
export function referenceCorners(r: ReferenceImage): [Vec3, Vec3, Vec3, Vec3] {
  const p = referencePlane(r);
  const [w, h] = referenceSize(r);
  const a = (r.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const corner = (u: number, v: number) => toWorld(p, [r.x + u * c - v * s, r.y + u * s + v * c]);
  return [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
}

/**
 * Where a reference image lands on a drawing plane facing the same way: its middle, size and turn in the drawing's
 * own coordinates. Null when it faces another way (then it isn't shown there).
 */
export function referenceOnPlane(
  r: ReferenceImage,
  plane: SketchPlane,
): { centre: Point2; size: [number, number]; rotation: number } | null {
  const own = referencePlane(r);
  const n = own.normal;
  const same = n[0] * plane.normal[0] + n[1] * plane.normal[1] + n[2] * plane.normal[2];
  if (same < 0.999) return null;
  const centre = toSketch(plane, toWorld(own, [r.x, r.y]));
  // The picture's own across direction, turned by its rotation, seen in the drawing.
  const a = (r.rotation * Math.PI) / 180;
  const yDir = cross(own.normal, own.xDir);
  const across: Vec3 = [0, 1, 2].map((i) => own.xDir[i]! * Math.cos(a) + yDir[i]! * Math.sin(a)) as Vec3;
  const [u, v] = toSketch({ ...plane, origin: [0, 0, 0] }, across);
  return { centre, size: referenceSize(r), rotation: (Math.atan2(v, u) * 180) / Math.PI };
}

/**
 * The scale (mm per pixel) that makes the distance between two points picked on the picture (in pixels) the real
 * distance typed in. Null when the points are on top of each other or the distance isn't above 0.
 */
export function calibratedScale(a: Point2, b: Point2, distance: number): number | null {
  const pixels = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(pixels > 0.5) || !(distance > 0) || !Number.isFinite(distance)) return null;
  return distance / pixels;
}

/** A new reference image, 200 mm across to start with (until it is calibrated), in the middle of its plane. */
export function newReference(
  src: string,
  pixels: [number, number],
  name: string,
  plane: ReferencePlane = "top",
): ReferenceImage {
  return {
    id: newId(),
    name,
    src,
    pixels,
    scale: 200 / Math.max(pixels[0], 1),
    calibrated: false,
    plane,
    x: 0,
    y: plane === "top" ? 0 : (200 / Math.max(pixels[0], 1)) * (pixels[1] / 2),
    offset: 0,
    rotation: 0,
    opacity: 0.6,
    visible: true,
    onTop: false,
  };
}

/** Plain-language checks for a reference image's settings. Nothing is changed to make them fit. */
export function validateReference(r: ReferenceImage): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) => issues.push({ severity: "error", featureId: r.id, field, message });
  for (const [k, label] of [
    ["x", "Across"],
    ["y", "Up"],
    ["offset", "Distance"],
    ["rotation", "Turn"],
    ["scale", "Scale"],
  ] as const)
    if (!Number.isFinite(r[k])) add(k, `${label} needs to be a number.`);
  if (issues.length) return issues;
  if (r.scale <= 0) add("scale", "The scale needs to be more than 0.");
  if (!(r.opacity >= MIN_OPACITY && r.opacity <= 1))
    add("opacity", `See-through needs to be between ${MIN_OPACITY * 100}% and 100%.`);
  return issues;
}

/** What's wrong with a stored reference image, or null when it can be read. */
export function referenceProblem(r: unknown): string | null {
  if (typeof r !== "object" || !r) return "isn't a reference image";
  const o = r as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (typeof o.id !== "string" || !o.id) return "has no ID";
  if (typeof o.src !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(o.src))
    return "doesn't hold a picture this version can show";
  if (!Array.isArray(o.pixels) || o.pixels.length !== 2 || !o.pixels.every((v) => num(v) && v > 0))
    return "doesn't say its size in pixels";
  if (!REFERENCE_PLANES.some((p) => p.plane === o.plane)) return "doesn't say which way it faces";
  for (const k of ["scale", "x", "y", "offset", "rotation", "opacity"])
    if (!num(o[k])) return `has a ${k} that isn't a number`;
  for (const k of ["calibrated", "visible", "onTop"])
    if (typeof o[k] !== "boolean") return `has a ${k} that isn't yes or no`;
  return null;
}
