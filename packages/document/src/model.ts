// The project document. Parameters are the source of truth; geometry is always rebuilt from them.
// All lengths are stored in millimetres. Positions are measured from the centre of the build plate:
// x to the right (red axis), y to the back (green axis), z up from the plate.
import {
  profileArea,
  profileBounds,
  selfIntersects,
  type Profile,
  type SketchPlane,
  PROFILE_LABELS,
  SPIN_PLANE,
  dot,
  length3,
  type Vec3,
} from "./sketch";
import { currentFace, faceEdgeIssues, type HoleFace } from "./holeFace";
import type { ReferenceImage } from "./reference";
import type { PrintSetup } from "./print";
import { lengthText } from "./units";
import {
  CLEARANCE,
  CLEARANCE_SERIES,
  MAX_FIT,
  THREADS,
  isScrewSize,
  isThreadSize,
  tapDrill,
  threadLabel,
  threadProfile,
  type ClearanceSeries,
  type ScrewSize,
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
  /** A left-hand thread (it tightens turning anticlockwise). Unset, the thread is right-hand, as almost all are. */
  hand?: "left";
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
 * A round hole. Without a face it is drilled straight down from the top of the part, and x and y are its centre
 * measured from the centre of the build plate. On a face it is drilled square into that face, and x and y are its
 * distances from the face's edges (see HoleFace). depth = 0 means all the way through.
 */
export interface HoleFeature extends Threadable {
  id: string;
  type: "hole";
  name: string;
  x: number;
  y: number;
  diameter: number;
  depth: number;
  face?: HoleFace;
  /** With a thread: how deep the thread goes from the face, in mm. Unset, the whole hole is threaded. */
  threadDepth?: number;
  /**
   * With a thread: the thread is not modelled, and the hole is the tap drill size instead, ready to tap or to take
   * a thread-forming screw. Much quicker to build, and the file stays small.
   */
  simplified?: boolean;
  /** A clearance hole for a metric screw: the diameter comes from the ISO 273 table for the screw and series. */
  clearance?: { screw: ScrewSize; series: ClearanceSeries };
  /** A recess at the face for a screw head. Not used with a thread. */
  head?: HoleHead;
}

/**
 * A counterbore is a wider flat-bottomed step for a socket head cap screw; a countersink is a 90° cone for a
 * countersunk (flat head) screw, sized by its diameter at the face.
 */
export type HoleHead =
  | { kind: "counterbore"; diameter: number; depth: number }
  | { kind: "countersink"; diameter: number };

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
  /**
   * Set for a revolve: the outlines spin this many degrees (up to 360) round the drawing's up line through
   * its (0, 0), like a part on a lathe, instead of being pushed straight. The depth is not used then.
   */
  revolve?: number;
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

/**
 * Which edges of the part a fillet or chamfer goes on: a rule, which survives any change to the part, or edges picked
 * in the 3D view, found again by where their middles are (an earlier change that moves a picked edge leaves it out,
 * and says so).
 */
export type EdgeSet = "all" | "vertical" | "top" | "bottom" | "picked";

export const EDGE_SETS: { edges: EdgeSet; label: string; help: string }[] = [
  { edges: "all", label: "All edges", help: "Every edge of the part" },
  { edges: "vertical", label: "Upright edges", help: "Straight edges that point straight up, like a box's corners" },
  { edges: "top", label: "Top edges", help: "Edges around the very top of the part" },
  { edges: "bottom", label: "Bottom edges", help: "Edges on the plate; a small chamfer here stops elephant's foot" },
  { edges: "picked", label: "Picked edges", help: "The edges you clicked in the 3D view" },
];

/**
 * Rounds (fillet) or bevels (chamfer) edges of the part built so far. `size` is the radius of a fillet, or how far
 * a chamfer cuts back along each face.
 */
/** How far (mm) a picked edge's middle may be from where it was picked and still be that edge. */
export const PICK_TOLERANCE = 0.01;

export interface EdgeFeature {
  id: string;
  type: "fillet" | "chamfer";
  name: string;
  size: number;
  edges: EdgeSet;
  /** For picked edges: the middle of each, in mm. */
  picked?: Vec3[];
}

/**
 * Repeats an earlier shape, hole or sketch: in a grid (`count` across × `rows` front to back, `spacing` and
 * `rowSpacing` apart), or round a circle (`count` copies spread over `angle` degrees about the upright line through
 * `cx`, `cy`). The counts include the original, which stays where it is.
 */
export interface PatternFeature {
  id: string;
  type: "pattern";
  name: string;
  source: string;
  kind: "grid" | "circle";
  count: number;
  spacing: number;
  rows: number;
  rowSpacing: number;
  angle: number;
  cx: number;
  cy: number;
}

/** Adds a mirror image of an earlier shape, hole or sketch, across the upright plane x = `at` or y = `at`. */
export interface MirrorFeature {
  id: string;
  type: "mirror";
  name: string;
  source: string;
  axis: "x" | "y";
  at: number;
}

/** A document is a list of steps applied in order: shapes are added or cut, holes are drilled, sketches are pushed out or cut in. */
export type Feature =
  | ShapeFeature
  | HoleFeature
  | SketchFeature
  | HollowFeature
  | EdgeFeature
  | PatternFeature
  | MirrorFeature;

export interface ProjectDocument {
  units: Units;
  features: Feature[];
  /** Pictures to model over, at their real size. Shown in the views, never built or exported. */
  references?: ReferenceImage[];
  /** Print Studio's settings (which printer). Kept beside the design: changing them never rebuilds the part. */
  print?: PrintSetup;
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

export const isShape = (f: Feature): f is ShapeFeature => f.type in SHAPES;
export const isSketch = (f: Feature): f is SketchFeature => f.type === "sketch";
export const isHollow = (f: Feature): f is HollowFeature => f.type === "hollow";
export const isEdgeStep = (f: Feature): f is EdgeFeature => f.type === "fillet" || f.type === "chamfer";
export const isCopyStep = (f: Feature): f is PatternFeature | MirrorFeature =>
  f.type === "pattern" || f.type === "mirror";
/** Steps a pattern or mirror can copy: the ones that add or cut material where they stand. */
export const isCopyable = (f: Feature): f is ShapeFeature | HoleFeature | SketchFeature =>
  isShape(f) || f.type === "hole" || f.type === "sketch";
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

/** Where a revolve is drawn, in plain words. */
export const SPIN_SURFACE = "upright plane";

/** A new revolve: outlines drawn on the upright plane through the plate's centre, spun all the way round. */
export function newRevolve(doc: ProjectDocument, mode: Mode = "add"): SketchFeature {
  return { ...newSketch(doc, SPIN_PLANE, SPIN_SURFACE, [], mode, 10), name: nextName(doc, "Revolve"), revolve: 360 };
}

export const isRevolve = (f: Feature): f is SketchFeature => f.type === "sketch" && f.revolve !== undefined;

/** A new hollow: 2 mm walls, open at the top. */
export function newHollow(doc: ProjectDocument): HollowFeature {
  return { id: newId(), type: "hollow", name: nextName(doc, "Hollow"), wall: 2, open: "top" };
}

/**
 * A new fillet (1 mm, every edge) or chamfer (0.6 mm on the bottom edges, which stops elephant's foot), or either on
 * just the edges picked in the 3D view.
 */
export function newEdgeStep(doc: ProjectDocument, type: EdgeFeature["type"], picked: Vec3[] = []): EdgeFeature {
  const step: EdgeFeature =
    type === "fillet"
      ? { id: newId(), type, name: nextName(doc, "Fillet"), size: 1, edges: "all" }
      : { id: newId(), type, name: nextName(doc, "Chamfer"), size: 0.6, edges: "bottom" };
  // Edges picked in the 3D view first: the step goes on just those.
  return picked.length ? { ...step, edges: "picked", picked: picked.map((p) => [...p] as Vec3) } : step;
}

/**
 * A new pattern of an earlier step: 3 in a row, 20 mm apart (or round the part's middle, 6 copies, for a hole or a
 * round shape that sits off-centre).
 */
export function newPattern(
  doc: ProjectDocument,
  source: string,
  centre: { x: number; y: number } = { x: 0, y: 0 },
): PatternFeature {
  return {
    id: newId(),
    type: "pattern",
    name: nextName(doc, "Pattern"),
    source,
    kind: "grid",
    count: 3,
    spacing: 20,
    rows: 1,
    rowSpacing: 20,
    angle: 360,
    cx: centre.x,
    cy: centre.y,
  };
}

/** A new mirror of an earlier step, across the left/right middle of the part. */
export function newMirror(doc: ProjectDocument, source: string, at = 0): MirrorFeature {
  return { id: newId(), type: "mirror", name: nextName(doc, "Mirror"), source, axis: "x", at };
}

/** Where each copy a pattern makes goes, as moves from the original (not including the original itself). */
export function patternMoves(p: PatternFeature): { by: [number, number]; turn: number }[] {
  const out: { by: [number, number]; turn: number }[] = [];
  if (p.kind === "grid") {
    for (let r = 0; r < p.rows; r++)
      for (let c = 0; c < p.count; c++) if (r || c) out.push({ by: [c * p.spacing, r * p.rowSpacing], turn: 0 });
    return out;
  }
  // A full turn spreads the copies evenly; a part turn puts the last one at the end of the arc.
  const full = Math.abs(Math.abs(p.angle) - 360) < 1e-9;
  const step = p.angle / (full ? p.count : Math.max(p.count - 1, 1));
  for (let i = 1; i < p.count; i++) out.push({ by: [0, 0], turn: i * step });
  return out;
}

export type Axis = "x" | "y" | "z";

/** Which ways a step can be moved: holes always go down from the top, so they only slide across it. */
export function movableAxes(f: Feature): Axis[] {
  if (f.type === "hollow" || isEdgeStep(f) || isCopyStep(f)) return [];
  if (f.type === "hole") return f.face ? [] : ["x", "y"]; // a hole on a face is placed by its distances from the edges
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
    case "fillet":
    case "chamfer":
    case "pattern":
    case "mirror":
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

const fmt = (n: number) => lengthText(n);

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
    x: h.face ? "Across" : "Left / right",
    y: h.face ? "Up" : "Front / back",
    depth: "Depth",
  };
  for (const k of ["diameter", "x", "y", "depth"] as const) {
    if (!Number.isFinite(h[k])) add(k, `${labels[k]} needs to be a number.`);
  }
  if (issues.length) return issues;
  if (h.diameter < HOLE_LIMITS.minDiameter)
    add("diameter", `A hole needs to be at least ${fmt(HOLE_LIMITS.minDiameter)} across.`);
  if (h.depth < 0) add("depth", "Depth can't be negative. Use 0 to go all the way through.");
  if (issues.length) return issues;
  if (h.thread !== undefined && h.clearance)
    return [...issues, holeIssue(h, "clearance", "A hole can't be both threaded and a clearance hole. Pick one.")];
  if (h.clearance && (!isScrewSize(h.clearance.screw) || !CLEARANCE_SERIES.includes(h.clearance.series)))
    return [...issues, holeIssue(h, "clearance", "Choose a screw size and fit from the lists.")];
  issues.push(...threadIssues(h, h.depth));
  if (h.thread !== undefined && h.threadDepth !== undefined && !issues.length) issues.push(...threadDepthIssues(h));
  if (headOf(h) && !issues.length) issues.push(...headIssues(h));
  return issues;
}

const holeIssue = (h: HoleFeature, field: string, message: string): Issue => ({
  severity: "error",
  featureId: h.id,
  field,
  message,
});

function threadDepthIssues(h: HoleFeature): Issue[] {
  const d = h.threadDepth!;
  const pitch = THREADS[h.thread!].pitch;
  if (!Number.isFinite(d)) return [holeIssue(h, "threadDepth", "Thread depth needs to be a number.")];
  if (d < 2 * pitch - 1e-9)
    return [
      holeIssue(
        h,
        "threadDepth",
        `The ${threadLabel(h.thread!)} thread needs at least two turns: make it at least ${fmt(2 * pitch)} deep.`,
      ),
    ];
  if (h.depth > 0 && d > h.depth + 1e-9)
    return [holeIssue(h, "threadDepth", `The thread can't go deeper than the hole: use ${fmt(h.depth)} or less.`)];
  return [];
}

function headIssues(h: HoleFeature): Issue[] {
  const head = h.head!;
  const name = head.kind === "counterbore" ? "Counterbore" : "Countersink";
  if (!Number.isFinite(head.diameter)) return [holeIssue(h, "headDiameter", `${name} diameter needs to be a number.`)];
  const bore = boreDiameter(h);
  if (head.diameter <= bore + 1e-9)
    return [holeIssue(h, "headDiameter", `The ${name.toLowerCase()} needs to be wider than the hole (${fmt(bore)}).`)];
  if (head.kind === "counterbore") {
    if (!Number.isFinite(head.depth)) return [holeIssue(h, "headDepth", "Counterbore depth needs to be a number.")];
    if (head.depth <= 0) return [holeIssue(h, "headDepth", "Counterbore depth needs to be more than 0 mm.")];
  }
  const reach = headDepth(h);
  if (h.depth > 0 && reach >= h.depth - 1e-9)
    return [
      holeIssue(
        h,
        head.kind === "counterbore" ? "headDepth" : "headDiameter",
        `The ${name.toLowerCase()} reaches ${fmt(reach)} deep, as deep as the hole itself. Make the hole deeper ` +
          `or the ${name.toLowerCase()} smaller.`,
      ),
    ];
  return [];
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
        message:
          "A part needs a shape to start from. Add a shape or draw on the plate before holes, hollows, fillets " +
          "and chamfers.",
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
      if (f.face && !hasErrors(validateHole(f)))
        issues.push(...faceEdgeIssues(f, currentFace(doc, f.face), holeDiameter(f) / 2));
    } else if (f.type === "sketch") {
      issues.push(...validateSketch(f));
    } else if (f.type === "hollow") {
      issues.push(...validateHollow(f));
    } else if (isEdgeStep(f)) {
      issues.push(...validateEdgeStep(f));
    } else if (isCopyStep(f)) {
      issues.push(...validateCopyStep(f, doc));
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

/** Plain-language checks for a fillet or chamfer that don't need the part. */
export function validateEdgeStep(e: EdgeFeature): Issue[] {
  const add = (field: string, message: string): Issue[] => [{ severity: "error", featureId: e.id, field, message }];
  const what = e.type === "fillet" ? "A fillet's radius" : "A chamfer's size";
  if (!Number.isFinite(e.size)) return add("size", `${what} needs to be a number.`);
  if (e.size < 0.1) return add("size", `${what} needs to be at least ${fmt(0.1)}.`);
  if (e.size > LIMITS.maxSize) return add("size", `${what} can be at most ${fmt(LIMITS.maxSize)}.`);
  if (!EDGE_SETS.some((x) => x.edges === e.edges)) return add("edges", "Choose which edges to change.");
  if (e.edges === "picked" && !e.picked?.length) return add("edges", "Pick at least one edge in the 3D view.");
  return [];
}

export const PATTERN_LIMITS = { maxCopies: 100 };

/** Plain-language checks for a pattern or mirror: what it copies, and sensible numbers. */
export function validateCopyStep(f: PatternFeature | MirrorFeature, doc: ProjectDocument): Issue[] {
  const add = (field: string, message: string): Issue[] => [{ severity: "error", featureId: f.id, field, message }];
  const at = doc.features.findIndex((x) => x.id === f.id);
  const source = doc.features.findIndex((x) => x.id === f.source);
  const src = doc.features[source];
  if (!src || (at >= 0 && source > at)) return add("source", "Choose an earlier shape, hole or sketch to copy.");
  if (!isCopyable(src)) return add("source", `${src.name} can't be copied. Choose a shape, hole or sketch.`);
  const num = (k: string, v: number) => (Number.isFinite(v) ? null : add(k, "This needs to be a number."));
  if (f.type === "mirror") return num("at", f.at) ?? [];
  for (const k of ["count", "rows", "spacing", "rowSpacing", "angle", "cx", "cy"] as const) {
    const bad = num(k, f[k]);
    if (bad) return bad;
  }
  if (!Number.isInteger(f.count) || f.count < 2)
    return add("count", "A pattern needs a whole number, at least 2 (the original and a copy).");
  if (f.kind === "grid") {
    if (!Number.isInteger(f.rows) || f.rows < 1) return add("rows", "Rows needs to be a whole number, 1 or more.");
    if (f.count * f.rows > PATTERN_LIMITS.maxCopies)
      return add("count", `A pattern can make at most ${PATTERN_LIMITS.maxCopies} in all.`);
    if (f.spacing === 0)
      return add("spacing", "Copies need some space between them, or they'd sit on top of each other.");
    if (f.rows > 1 && f.rowSpacing === 0) return add("rowSpacing", "Rows need some space between them.");
    return [];
  }
  if (f.count > PATTERN_LIMITS.maxCopies)
    return add("count", `A pattern can make at most ${PATTERN_LIMITS.maxCopies}.`);
  if (f.angle === 0 || Math.abs(f.angle) > 360) return add("angle", "The angle needs to be between 0 and 360 degrees.");
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

  if (s.revolve !== undefined) {
    if (!finite(s.revolve)) add("revolve", "The angle needs to be a number.");
    else if (s.revolve < 1 || s.revolve > 360) add("revolve", "The angle must be from 1° to 360°.");
    // An outline crossing the spin line would sweep through itself.
    s.profiles.forEach((p, i) => {
      if (profileBounds(p)[0] < -1e-9)
        add(
          profileField(i, p.kind === "polygon" ? "points" : "x"),
          `${PROFILE_LABELS[p.kind]} ${i + 1} crosses the spin line. ` +
            "Keep it on the right of the line (touching is fine).",
        );
    });
    return issues;
  }
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

/** Whether a threaded hole's thread is actually modelled (not simplified to its tap drill). */
export const modelledThread = (h: HoleFeature) => h.thread !== undefined && !h.simplified;

/**
 * The diameter of a hole's bore below any head: the ISO 273 clearance for a screw, the tap drill for a simplified
 * threaded hole, the outside of the grooves for a modelled one, or else the diameter typed in.
 */
export function boreDiameter(h: HoleFeature): number {
  if (h.thread && isThreadSize(h.thread)) {
    if (h.simplified) return tapDrill(h.thread);
    const t = threadOf(h);
    if (t) return 2 * t.major;
  }
  if (h.clearance && isScrewSize(h.clearance.screw) && CLEARANCE_SERIES.includes(h.clearance.series))
    return CLEARANCE[h.clearance.screw][h.clearance.series];
  return h.diameter;
}

/** The head recess a hole really has: none with a thread. */
export const headOf = (h: HoleFeature): HoleHead | undefined => (h.thread ? undefined : h.head);

/** The widest a hole cuts, at its face: the head recess when it has one, else its bore. */
export const holeDiameter = (h: HoleFeature): number => Math.max(boreDiameter(h), headOf(h)?.diameter ?? 0);

/** What kind of hole it is, in a few words: "Ø5 mm", "M5 thread", "M6 tapped, Ø5 mm drill", "M5 clearance Ø5.5 mm". */
export function holeKindLabel(h: HoleFeature): string {
  const lh = h.hand === "left" ? " left-hand" : "";
  if (h.thread)
    return h.simplified ? `${h.thread}${lh} tapped, Ø${lengthText(boreDiameter(h))} drill` : `${h.thread}${lh} thread`;
  if (h.clearance) return `${h.clearance.screw} clearance Ø${lengthText(boreDiameter(h))}`;
  return `Ø${lengthText(h.diameter)}`;
}

/** How deep a head recess reaches below the face: a counterbore's depth, or a 90° countersink's cone. */
export function headDepth(h: HoleFeature): number {
  const head = headOf(h);
  if (!head) return 0;
  if (head.kind === "counterbore") return head.depth;
  return Math.max(0, (head.diameter - boreDiameter(h)) / 2);
}

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
  if (f.type === "hole" && f.threadDepth !== undefined) return [];
  if (length > 0 && length < 2 * pitch)
    return issue(
      f.type === "hole" ? "depth" : "height",
      `The ${threadLabel(f.thread)} thread needs at least two turns: make it at least ${fmt(2 * pitch)} long.`,
    );
  return [];
}
