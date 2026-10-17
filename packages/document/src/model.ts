// The project document. Parameters are the source of truth; geometry is always rebuilt from them.
// All lengths are stored in millimetres. Positions are measured from the centre of the build plate:
// x to the right (red axis), y to the back (green axis), z up from the plate.
import { profileArea, selfIntersects, type Profile, type SketchPlane, PROFILE_LABELS, dot, length3 } from "./sketch";
import {
  MAX_FIT,
  THREADS,
  isThreadSize,
  threadProfile,
  threadVolume,
  type ThreadProfile,
  type ThreadSize,
} from "./threads";

export type Units = "mm";

/** Whether a shape adds material to the part or cuts it away. */
export type Mode = "add" | "cut";

/** Where a shape sits: the centre of its base, measured from the centre of the build plate. */
interface Placed {
  id: string;
  name: string;
  mode: Mode;
  x: number;
  y: number;
  /** How far the shape's base is lifted above the plate. */
  z: number;
}

/** A rectangular box. wall = 0 makes a solid block; wall > 0 makes an open-top container. */
export interface BoxFeature extends Placed {
  type: "box";
  width: number;
  depth: number;
  height: number;
  wall: number;
}

/** Optional ISO thread on a cylinder or hole. With a thread, the diameter comes from the thread size. */
interface Threadable {
  thread?: ThreadSize;
  /** Extra room across the thread so printed parts turn, in mm. */
  fit?: number;
}

/** A cylinder. With a thread it becomes a threaded rod (adding) or a threaded hole (cutting). */
export interface CylinderFeature extends Placed, Threadable {
  type: "cylinder";
  diameter: number;
  height: number;
}

/** A cylinder with a round hole through its middle. */
export interface TubeFeature extends Placed {
  type: "tube";
  outerDiameter: number;
  innerDiameter: number;
  height: number;
}

/** A cone or a cone with its top cut off. topDiameter = 0 makes a point. */
export interface ConeFeature extends Placed {
  type: "cone";
  bottomDiameter: number;
  topDiameter: number;
  height: number;
}

/** A ball. z is the height of its lowest point. */
export interface SphereFeature extends Placed {
  type: "sphere";
  diameter: number;
}

export type ShapeFeature = BoxFeature | CylinderFeature | TubeFeature | ConeFeature | SphereFeature;
export type ShapeType = ShapeFeature["type"];

/**
 * A round hole drilled straight down from the top of the part.
 * x and y are the hole's centre, measured from the centre of the build plate. depth = 0 means all the way through.
 */
export interface HoleFeature extends Threadable {
  id: string;
  type: "hole";
  name: string;
  x: number;
  y: number;
  diameter: number;
  depth: number;
}

/**
 * Outlines drawn on a flat face of the part (or on the plate) and pushed straight out of the face to add
 * material, or straight into it to cut. For a cut, depth = 0 means all the way through the part.
 */
export interface SketchFeature {
  id: string;
  type: "sketch";
  name: string;
  mode: Mode;
  plane: SketchPlane;
  /** What the sketch was drawn on, in plain words: "plate", "top face", ... */
  surface: string;
  profiles: Profile[];
  depth: number;
}

/** Which side of the part a hollow leaves open. "none" keeps it closed, with an empty space inside. */
export type OpenSide = "top" | "bottom" | "front" | "back" | "left" | "right" | "none";

export const OPEN_SIDES: { side: OpenSide; label: string }[] = [
  { side: "top", label: "Top" },
  { side: "bottom", label: "Bottom" },
  { side: "front", label: "Front" },
  { side: "back", label: "Back" },
  { side: "left", label: "Left" },
  { side: "right", label: "Right" },
  { side: "none", label: "None (closed inside)" },
];

/**
 * Hollows out the part built so far, leaving walls of the given thickness. The flat face(s) on the open side
 * are removed; with open = "none" the part stays closed with an empty space inside.
 */
export interface HollowFeature {
  id: string;
  type: "hollow";
  name: string;
  wall: number;
  open: OpenSide;
}

/** A document is a list of steps applied in order: shapes are added or cut, holes are drilled, sketches are pushed out or cut in. */
export type Feature = ShapeFeature | HoleFeature | SketchFeature | HollowFeature;

export interface ProjectDocument {
  units: Units;
  features: Feature[];
}

export const LIMITS = {
  minSize: 0.5,
  maxSize: 1000,
  /** Nothing may sit further than this from the plate centre. */
  maxPosition: 1000,
  minPrintableWall: 0.4,
} as const;

/** Kept for older callers: the box limits are the general shape limits. */
export const BOX_LIMITS = LIMITS;

export const HOLE_LIMITS = {
  minDiameter: 0.5,
} as const;

const at = { mode: "add" as Mode, x: 0, y: 0, z: 0 };

export const DEFAULT_BOX: Omit<BoxFeature, "id"> = {
  type: "box",
  name: "Box",
  ...at,
  width: 60,
  depth: 40,
  height: 30,
  wall: 2,
};

/** What each kind of shape is called and what a new one looks like. */
export const SHAPES: Record<ShapeType, { label: string; make: () => Omit<ShapeFeature, "id" | "name"> }> = {
  box: {
    label: "Box",
    make: () => ({
      type: "box",
      ...at,
      width: 20,
      depth: 20,
      height: 20,
      wall: 0,
    }),
  },
  cylinder: {
    label: "Cylinder",
    make: () => ({ type: "cylinder", ...at, diameter: 20, height: 20 }),
  },
  tube: {
    label: "Tube",
    make: () => ({
      type: "tube",
      ...at,
      outerDiameter: 20,
      innerDiameter: 12,
      height: 20,
    }),
  },
  cone: {
    label: "Cone",
    make: () => ({
      type: "cone",
      ...at,
      bottomDiameter: 20,
      topDiameter: 0,
      height: 20,
    }),
  },
  sphere: {
    label: "Sphere",
    make: () => ({ type: "sphere", ...at, diameter: 20 }),
  },
};

export const isShape = (f: Feature): f is ShapeFeature =>
  f.type !== "hole" && f.type !== "sketch" && f.type !== "hollow";
export const isSketch = (f: Feature): f is SketchFeature => f.type === "sketch";
export const isHollow = (f: Feature): f is HollowFeature => f.type === "hollow";
/** Steps that add or cut solid material (shapes and sketches). */
export const isSolidStep = (f: Feature): f is ShapeFeature | SketchFeature => isShape(f) || isSketch(f);
export const shapesOf = (doc: ProjectDocument): ShapeFeature[] => doc.features.filter(isShape);
export const holesOf = (doc: ProjectDocument): HoleFeature[] =>
  doc.features.filter((f): f is HoleFeature => f.type === "hole");

/** The first box, if the part is a single box. Used for "inside space" and the classic box workflow. */
export function singleBox(doc: ProjectDocument): BoxFeature | null {
  const solids = doc.features.filter(isSolidStep);
  if (doc.features.some(isHollow)) return null;
  return solids.length === 1 && solids[0]!.type === "box" ? solids[0]! : null;
}

/** A name like "Cylinder 2" that isn't used yet. */
export function nextName(doc: ProjectDocument, base: string): string {
  const used = new Set(doc.features.map((f) => f.name));
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function newShape(
  doc: ProjectDocument,
  type: ShapeType,
  where: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): ShapeFeature {
  const s = { ...SHAPES[type].make(), ...where } as ShapeFeature;
  return { ...s, id: newId(), name: nextName(doc, SHAPES[type].label) };
}

/** A new hole: 5 mm, through, at the given spot (usually the middle of the part). */
export function newHole(doc: ProjectDocument, where: { x: number; y: number } = { x: 0, y: 0 }): HoleFeature {
  return {
    id: newId(),
    type: "hole",
    name: nextName(doc, "Hole"),
    x: where.x,
    y: where.y,
    diameter: 5,
    depth: 0,
  };
}

/** A new sketch from outlines drawn on a surface. */
export function newSketch(
  doc: ProjectDocument,
  plane: SketchPlane,
  surface: string,
  profiles: Profile[],
  mode: Mode = "add",
  depth = 5,
): SketchFeature {
  return {
    id: newId(),
    type: "sketch",
    name: nextName(doc, "Sketch"),
    mode,
    plane,
    surface,
    profiles,
    depth,
  };
}

/** A new hollow: 2 mm walls, open at the top. */
export function newHollow(doc: ProjectDocument): HollowFeature {
  return { id: newId(), type: "hollow", name: nextName(doc, "Hollow"), wall: 2, open: "top" };
}

export type Axis = "x" | "y" | "z";

/** Which ways a step can be moved: holes always go down from the top, so they only slide across it. */
export function movableAxes(f: Feature): Axis[] {
  if (f.type === "hollow") return [];
  if (f.type === "hole") return ["x", "y"];
  return ["x", "y", "z"];
}

/**
 * The same step moved by `by` mm along x (left/right), y (front/back) and z (up). Moves along an axis the step
 * can't move along are ignored. Results are rounded to a millionth of a mm, so 0.1 + 0.2 stays 0.3.
 */
export function moveFeature<F extends Feature>(f: F, by: [number, number, number]): F {
  const r = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
  switch (f.type) {
    case "hollow":
      return f;
    case "hole":
      return { ...f, x: r(f.x + by[0]), y: r(f.y + by[1]) };
    case "sketch": {
      const o = f.plane.origin;
      return { ...f, plane: { ...f.plane, origin: [r(o[0] + by[0]), r(o[1] + by[1]), r(o[2] + by[2])] } };
    }
    default: {
      const s = f as ShapeFeature;
      return { ...s, x: r(s.x + by[0]), y: r(s.y + by[1]), z: r(s.z + by[2]) } as F;
    }
  }
}

export function newDocument(): ProjectDocument {
  return { units: "mm", features: [{ id: newId(), ...DEFAULT_BOX }] };
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Which shape the issue is about (absent for the whole design). */
  featureId?: string;
  /** Which parameter the issue is about, so the UI can show it next to the right field. */
  field: string | null;
  message: string;
}

const fmt = (n: number) => `${Math.round(n * 100) / 100} mm`;

/** Plain-language names for every number a shape can have. */
export const FIELD_LABELS: Record<string, string> = {
  x: "Left / right",
  y: "Front / back",
  z: "Lift",
  width: "Width",
  depth: "Depth",
  height: "Height",
  wall: "Wall thickness",
  diameter: "Diameter",
  outerDiameter: "Outside diameter",
  innerDiameter: "Inside diameter",
  bottomDiameter: "Bottom diameter",
  topDiameter: "Top diameter",
};

/** The size numbers of each shape type, in the order the panel shows them. */
export const SIZE_FIELDS: Record<ShapeType, readonly string[]> = {
  box: ["width", "depth", "height", "wall"],
  cylinder: ["diameter", "height"],
  tube: ["outerDiameter", "innerDiameter", "height"],
  cone: ["bottomDiameter", "topDiameter", "height"],
  sphere: ["diameter"],
};

/** Plain-language checks for one shape. Errors block the rebuild; warnings don't. */
export function validateShape(s: ShapeFeature): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, field: string | null, message: string) =>
    issues.push({ severity, featureId: s.id, field, message });
  const num = (k: string) => (s as unknown as Record<string, number>)[k]!;

  for (const k of ["x", "y", "z", ...SIZE_FIELDS[s.type]]) {
    if (!Number.isFinite(num(k))) add("error", k, `${FIELD_LABELS[k]} needs to be a number.`);
  }
  if (issues.length) return issues;

  for (const k of ["x", "y", "z"]) {
    if (Math.abs(num(k)) > LIMITS.maxPosition)
      add("error", k, `${FIELD_LABELS[k]} can be at most ${fmt(LIMITS.maxPosition)} from the centre.`);
  }
  if (s.z < 0)
    add(
      "error",
      "z",
      "Lift can't be negative: the plate is at 0. Use a cut shape to go below the surface of the part.",
    );

  // Sizes that must be positive. Optional ones (wall, inner and top diameter) may be 0.
  const optional = new Set(["wall", "innerDiameter", "topDiameter"]);
  for (const k of SIZE_FIELDS[s.type]) {
    const v = num(k);
    const label = FIELD_LABELS[k]!;
    if (optional.has(k)) {
      if (v < 0) add("error", k, `${label} can't be negative.`);
    } else if (v < LIMITS.minSize) add("error", k, `${label} must be at least ${fmt(LIMITS.minSize)}.`);
    else if (v > LIMITS.maxSize) add("error", k, `${label} can be at most ${fmt(LIMITS.maxSize)}.`);
  }
  if (issues.length) return issues;

  if (s.type === "box") issues.push(...validateBoxWall(s));
  if (s.type === "cylinder") issues.push(...threadIssues(s, s.height));
  if (s.type === "tube") {
    if (s.innerDiameter < LIMITS.minSize)
      add(
        "error",
        "innerDiameter",
        `The inside of a tube needs to be at least ${fmt(LIMITS.minSize)} across. Use a cylinder for a solid one.`,
      );
    else if (s.innerDiameter >= s.outerDiameter)
      add(
        "error",
        "innerDiameter",
        `The inside (${fmt(s.innerDiameter)}) must be smaller than the outside (${fmt(s.outerDiameter)}).`,
      );
    else if ((s.outerDiameter - s.innerDiameter) / 2 < LIMITS.minPrintableWall)
      add(
        "warning",
        "innerDiameter",
        `The tube wall is only ${fmt((s.outerDiameter - s.innerDiameter) / 2)} thick and may not print well.`,
      );
  }
  return issues;
}

function validateBoxWall(b: BoxFeature): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string) =>
    issues.push({ severity, featureId: b.id, field: "wall", message });
  if (b.wall === 0) return issues;
  const narrowest = Math.min(b.width, b.depth);
  if (b.wall * 2 >= narrowest) {
    add(
      "error",
      `Walls of ${fmt(b.wall)} would fill the whole box. Use less than ${fmt(narrowest / 2)}, or 0 for a solid block.`,
    );
  } else if (b.wall >= b.height) {
    add("error", `The floor (${fmt(b.wall)}) can't be as thick as the box is tall (${fmt(b.height)}).`);
  } else if (b.wall < LIMITS.minPrintableWall) {
    add("warning", `Walls thinner than ${fmt(LIMITS.minPrintableWall)} may not print well on most printers.`);
  }
  return issues;
}

/** Checks for a box. Kept for callers that only deal with boxes. */
export const validateBox = (b: BoxFeature): Issue[] => validateShape(b);

/** Plain-language checks for a hole on its own. Checks against the part's edges happen when it is built. */
export function validateHole(h: HoleFeature): Issue[] {
  const issues: Issue[] = [];
  const add = (field: keyof HoleFeature, message: string) =>
    issues.push({ severity: "error", featureId: h.id, field, message });
  const labels = {
    diameter: "Diameter",
    x: "Left / right",
    y: "Front / back",
    depth: "Depth",
  } as const;
  for (const k of ["diameter", "x", "y", "depth"] as const) {
    if (!Number.isFinite(h[k])) add(k, `${labels[k]} needs to be a number.`);
  }
  if (issues.length) return issues;
  if (h.diameter < HOLE_LIMITS.minDiameter)
    add("diameter", `A hole needs to be at least ${fmt(HOLE_LIMITS.minDiameter)} across.`);
  if (h.depth < 0) add("depth", "Depth can't be negative. Use 0 to go all the way through.");
  issues.push(...threadIssues(h, h.depth));
  return issues;
}

/**
 * Checks a hole against the outline of the part it is drilled into (the part's footprint on the plate).
 * A hole that pokes out of the side is refused; one that leaves a very thin edge gets a warning.
 */
export function holeEdgeIssues(
  h: HoleFeature,
  min: readonly number[],
  max: readonly number[],
  partHeight: number,
): Issue[] {
  const r = holeDiameter(h) / 2;
  const issue = (severity: Severity, field: string, message: string): Issue => ({
    severity,
    featureId: h.id,
    field,
    message,
  });
  if (h.depth > partHeight + 1e-9) {
    return [
      issue(
        "error",
        "depth",
        `The part is only ${fmt(partHeight)} tall. Use ${fmt(partHeight)} or less, or 0 to go all the way through.`,
      ),
    ];
  }
  const sides = [
    ["x", h.x - r - min[0]!, "left"],
    ["x", max[0]! - h.x - r, "right"],
    ["y", h.y - r - min[1]!, "front"],
    ["y", max[1]! - h.y - r, "back"],
  ] as const;
  for (const [field, gap, side] of sides) {
    if (gap < -1e-9)
      return [issue("error", field, `This hole runs off the ${side} edge of the part. Move it in or make it smaller.`)];
  }
  const closest = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (closest[1] < LIMITS.minPrintableWall) {
    return [
      issue(
        "warning",
        closest[0],
        `Only ${fmt(closest[1])} of material is left between this hole and the ${closest[2]} edge. That may break or not print.`,
      ),
    ];
  }
  return [];
}

/** Every check that can be done without building, in the order the steps appear. */
export function validateDocument(doc: ProjectDocument): Issue[] {
  const issues: Issue[] = [];
  const first = doc.features[0];
  if (!first) return []; // an empty plate is a valid start: nothing to build yet
  if (!isSolidStep(first)) {
    return [
      {
        severity: "error",
        field: null,
        message: "A part needs a shape to start from. Add a shape or draw on the plate before holes and hollows.",
      },
    ];
  }
  if (first.mode !== "add") {
    issues.push({
      severity: "error",
      featureId: first.id,
      field: "mode",
      message: "The first shape has to add material, since there's nothing to cut from yet.",
    });
  }
  let holesStarted = false;
  for (const f of doc.features) {
    if (f.type === "hole") {
      holesStarted = true;
      issues.push(...validateHole(f));
    } else if (f.type === "sketch") {
      issues.push(...validateSketch(f));
    } else if (f.type === "hollow") {
      issues.push(...validateHollow(f));
    } else {
      if (holesStarted)
        issues.push({
          severity: "error",
          featureId: f.id,
          field: null,
          message: "Shapes have to come before holes.",
        });
      issues.push(...validateShape(f));
    }
  }
  return issues;
}

/** Plain-language checks for a hollow that don't need the part. */
export function validateHollow(h: HollowFeature): Issue[] {
  const add = (field: string, message: string): Issue[] => [{ severity: "error", featureId: h.id, field, message }];
  if (!Number.isFinite(h.wall)) return add("wall", "Wall thickness needs to be a number.");
  if (h.wall < LIMITS.minPrintableWall)
    return add("wall", `Walls need to be at least ${fmt(LIMITS.minPrintableWall)} thick to print.`);
  if (h.wall > LIMITS.maxSize) return add("wall", `Walls can be at most ${fmt(LIMITS.maxSize)} thick.`);
  if (!OPEN_SIDES.some((o) => o.side === h.open)) return add("open", "Choose which side to leave open.");
  return [];
}

/** Where a profile's number is shown in the panel, e.g. "profiles.0.width". */
export const profileField = (index: number, key: string) => `profiles.${index}.${key}`;

/** Plain-language checks for a sketch: a sensible surface, drawable outlines and a sensible depth. */
export function validateSketch(s: SketchFeature): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string | null, message: string, severity: Severity = "error") =>
    issues.push({ severity, featureId: s.id, field, message });
  const finite = (...ns: unknown[]) => ns.every((n) => typeof n === "number" && Number.isFinite(n));

  const { origin, xDir, normal } = s.plane;
  const planeOk =
    finite(...origin, ...xDir, ...normal) &&
    Math.abs(length3(xDir) - 1) < 1e-6 &&
    Math.abs(length3(normal) - 1) < 1e-6 &&
    Math.abs(dot(xDir, normal)) < 1e-6 &&
    origin.every((n) => Math.abs(n) <= LIMITS.maxPosition);
  if (!planeOk) add(null, `The position of ${s.name} is damaged. Remove it and draw it again.`);

  if (!s.profiles.length) add(null, `${s.name} is empty. Draw at least one shape in it.`);
  s.profiles.forEach((p, i) => {
    const what = `${PROFILE_LABELS[p.kind]} ${i + 1}`;
    const f = (k: string) => profileField(i, k);
    const position = (x: number, y: number, field: string) => {
      if (Math.abs(x) > LIMITS.maxPosition || Math.abs(y) > LIMITS.maxPosition)
        add(field, `${what} is too far away. Keep it within ${fmt(LIMITS.maxPosition)}.`);
    };
    const size = (v: number, field: string, label: string) => {
      if (v < LIMITS.minSize) add(field, `${label} of ${what} must be at least ${fmt(LIMITS.minSize)}.`);
      else if (v > LIMITS.maxSize) add(field, `${label} of ${what} can be at most ${fmt(LIMITS.maxSize)}.`);
    };
    if (p.kind === "rectangle") {
      if (!finite(p.x, p.y, p.width, p.height))
        return add(f("width"), `${what} needs numbers for its position and size.`);
      position(p.x, p.y, f("x"));
      size(p.width, f("width"), "The width");
      size(p.height, f("height"), "The height");
    } else if (p.kind === "circle") {
      if (!finite(p.x, p.y, p.diameter)) return add(f("diameter"), `${what} needs numbers for its position and size.`);
      position(p.x, p.y, f("x"));
      size(p.diameter, f("diameter"), "The diameter");
    } else {
      const pts = p.points;
      if (pts.length < 3) return add(f("points"), `${what} needs at least 3 corners.`);
      if (!pts.every((q) => finite(q[0], q[1]))) return add(f("points"), `${what} has a corner that isn't a number.`);
      for (const q of pts) position(q[0], q[1], f("points"));
      const dup = pts.some((q, j) => {
        const r = pts[(j + 1) % pts.length]!;
        return Math.hypot(q[0] - r[0], q[1] - r[1]) < 0.01;
      });
      if (dup) return add(f("points"), `${what} has two corners in the same place. Remove one of them.`);
      if (selfIntersects(pts))
        return add(f("points"), `${what} crosses over itself. Move its corners so the lines don't cross.`);
      if (profileArea(p) < LIMITS.minSize * LIMITS.minSize) add(f("points"), `${what} is too small to make.`);
    }
  });

  if (!finite(s.depth)) add("depth", "Depth needs to be a number.");
  else if (s.mode === "add") {
    if (s.depth < LIMITS.minSize) add("depth", `Height must be at least ${fmt(LIMITS.minSize)}.`);
    else if (s.depth > LIMITS.maxSize) add("depth", `Height can be at most ${fmt(LIMITS.maxSize)}.`);
  } else if (s.depth < 0) add("depth", "Depth can't be negative. Use 0 to cut all the way through.");
  else if (s.depth > 0 && s.depth < LIMITS.minSize)
    add("depth", `Depth must be at least ${fmt(LIMITS.minSize)}, or 0 to cut all the way through.`);
  else if (s.depth > LIMITS.maxSize) add("depth", `Depth can be at most ${fmt(LIMITS.maxSize)}.`);
  return issues;
}

/** Total flat area of a sketch's outlines (overlaps counted twice). */
export const sketchArea = (s: SketchFeature) => s.profiles.reduce((a, p) => a + profileArea(p), 0);

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");

/** Exact material volume of one shape on its own, used to check what the geometry engine returns. */
export function shapeVolume(s: ShapeFeature): number {
  const disc = (d: number) => Math.PI * (d / 2) ** 2;
  const t = threadOf(s);
  if (t) return threadVolume(t, (s as CylinderFeature).height);
  switch (s.type) {
    case "box": {
      const outer = s.width * s.depth * s.height;
      return s.wall === 0 ? outer : outer - (s.width - 2 * s.wall) * (s.depth - 2 * s.wall) * (s.height - s.wall);
    }
    case "cylinder":
      return disc(s.diameter) * s.height;
    case "tube":
      return (disc(s.outerDiameter) - disc(s.innerDiameter)) * s.height;
    case "cone": {
      const R = s.bottomDiameter / 2;
      const r = s.topDiameter / 2;
      return (Math.PI * s.height * (R * R + R * r + r * r)) / 3;
    }
    case "sphere":
      return (4 / 3) * Math.PI * (s.diameter / 2) ** 3;
  }
}

/** The shape's outer size along x, y and z. */
export function shapeSize(s: ShapeFeature): [number, number, number] {
  const t = threadOf(s);
  if (t) return [2 * t.major, 2 * t.major, (s as CylinderFeature).height];
  switch (s.type) {
    case "box":
      return [s.width, s.depth, s.height];
    case "cylinder":
      return [s.diameter, s.diameter, s.height];
    case "tube":
      return [s.outerDiameter, s.outerDiameter, s.height];
    case "cone": {
      const d = Math.max(s.bottomDiameter, s.topDiameter);
      return [d, d, s.height];
    }
    case "sphere":
      return [s.diameter, s.diameter, s.diameter];
  }
}

/**
 * The thread on a cylinder or hole, if it has one. Adding a threaded cylinder makes a bolt (a little smaller than
 * the ISO size so it turns in a printed hole); cutting one, or a threaded hole, makes room for a bolt.
 */
export function threadOf(f: Feature): ThreadProfile | null {
  if ((f.type !== "cylinder" && f.type !== "hole") || !f.thread) return null;
  return threadProfile(f.thread, f.fit ?? 0, f.type === "cylinder" && f.mode === "add");
}

/** The widest a hole cuts: its diameter, or for a threaded hole the outside of the thread's grooves. */
export const holeDiameter = (h: HoleFeature): number => {
  const t = threadOf(h);
  return t ? 2 * t.major : h.diameter;
};

/** Checks the thread settings of a cylinder or hole; `length` is how long the thread is (0 = through). */
function threadIssues(f: CylinderFeature | HoleFeature, length: number): Issue[] {
  if (f.thread === undefined) return [];
  const issue = (field: string, message: string): Issue[] => [{ severity: "error", featureId: f.id, field, message }];
  if (!isThreadSize(f.thread)) return issue("thread", "Choose a thread size from the list.");
  const fit = f.fit ?? 0;
  if (!Number.isFinite(fit)) return issue("fit", "Fit clearance needs to be a number.");
  if (fit < 0) return issue("fit", "Fit clearance can't be negative. Use 0 for the exact ISO size.");
  if (fit > MAX_FIT) return issue("fit", `Fit clearance can be at most ${fmt(MAX_FIT)}.`);
  const pitch = THREADS[f.thread].pitch;
  if (length > 0 && length < 2 * pitch)
    return issue(
      f.type === "hole" ? "depth" : "height",
      `An ${f.thread} thread needs at least two turns: make it at least ${fmt(2 * pitch)} long.`,
    );
  return [];
}
