// The project document. Parameters are the source of truth; geometry is always rebuilt from them.
// All lengths are stored in millimetres. Positions are measured from the centre of the build plate:
// x to the right (red axis), y to the back (green axis), z up from the plate.

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

export interface CylinderFeature extends Placed {
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
export interface HoleFeature {
  id: string;
  type: "hole";
  name: string;
  x: number;
  y: number;
  diameter: number;
  depth: number;
}

/** A document is a list of steps applied in order: shapes are added or cut, then holes are drilled. */
export type Feature = ShapeFeature | HoleFeature;

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

export const DEFAULT_BOX: Omit<BoxFeature, "id"> = { type: "box", name: "Box", ...at, width: 60, depth: 40, height: 30, wall: 2 };

/** What each kind of shape is called and what a new one looks like. */
export const SHAPES: Record<ShapeType, { label: string; make: () => Omit<ShapeFeature, "id" | "name"> }> = {
  box: { label: "Box", make: () => ({ type: "box", ...at, width: 20, depth: 20, height: 20, wall: 0 }) },
  cylinder: { label: "Cylinder", make: () => ({ type: "cylinder", ...at, diameter: 20, height: 20 }) },
  tube: { label: "Tube", make: () => ({ type: "tube", ...at, outerDiameter: 20, innerDiameter: 12, height: 20 }) },
  cone: { label: "Cone", make: () => ({ type: "cone", ...at, bottomDiameter: 20, topDiameter: 0, height: 20 }) },
  sphere: { label: "Sphere", make: () => ({ type: "sphere", ...at, diameter: 20 }) },
};

export const isShape = (f: Feature): f is ShapeFeature => f.type !== "hole";
export const shapesOf = (doc: ProjectDocument): ShapeFeature[] => doc.features.filter(isShape);
export const holesOf = (doc: ProjectDocument): HoleFeature[] => doc.features.filter((f): f is HoleFeature => f.type === "hole");

/** The first box, if the part is a single box. Used for "inside space" and the classic box workflow. */
export function singleBox(doc: ProjectDocument): BoxFeature | null {
  const shapes = shapesOf(doc);
  return shapes.length === 1 && shapes[0]!.type === "box" ? shapes[0]! : null;
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
  return { id: newId(), type: "hole", name: nextName(doc, "Hole"), x: where.x, y: where.y, diameter: 5, depth: 0 };
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
    add("error", "z", "Lift can't be negative: the plate is at 0. Use a cut shape to go below the surface of the part.");

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
  const add = (severity: Severity, message: string) => issues.push({ severity, featureId: b.id, field: "wall", message });
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
  const add = (field: keyof HoleFeature, message: string) => issues.push({ severity: "error", featureId: h.id, field, message });
  const labels = { diameter: "Diameter", x: "Left / right", y: "Front / back", depth: "Depth" } as const;
  for (const k of ["diameter", "x", "y", "depth"] as const) {
    if (!Number.isFinite(h[k])) add(k, `${labels[k]} needs to be a number.`);
  }
  if (issues.length) return issues;
  if (h.diameter < HOLE_LIMITS.minDiameter)
    add("diameter", `A hole needs to be at least ${fmt(HOLE_LIMITS.minDiameter)} across.`);
  if (h.depth < 0) add("depth", "Depth can't be negative. Use 0 to go all the way through.");
  return issues;
}

/**
 * Checks a hole against the outline of the part it is drilled into (the part's footprint on the plate).
 * A hole that pokes out of the side is refused; one that leaves a very thin edge gets a warning.
 */
export function holeEdgeIssues(h: HoleFeature, min: readonly number[], max: readonly number[], partHeight: number): Issue[] {
  const r = h.diameter / 2;
  const issue = (severity: Severity, field: string, message: string): Issue => ({ severity, featureId: h.id, field, message });
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
  if (!first || !isShape(first)) {
    return [{ severity: "error", field: null, message: "A part needs at least one shape to start from." }];
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
    } else {
      if (holesStarted)
        issues.push({ severity: "error", featureId: f.id, field: null, message: "Shapes have to come before holes." });
      issues.push(...validateShape(f));
    }
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");

/** Exact material volume of one shape on its own, used to check what the geometry engine returns. */
export function shapeVolume(s: ShapeFeature): number {
  const disc = (d: number) => Math.PI * (d / 2) ** 2;
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
