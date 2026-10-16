// The project document. Parameters are the source of truth; geometry is always rebuilt from them.
// All lengths are stored in millimetres.

export type Units = "mm";

/** A rectangular box. wall = 0 makes a solid block; wall > 0 makes an open-top container. */
export interface BoxFeature {
  id: string;
  type: "box";
  name: string;
  width: number;
  depth: number;
  height: number;
  wall: number;
}

/**
 * A round hole drilled straight down from the top of the box.
 * x and y are measured from the box's left and front edges to the centre of the hole.
 * depth = 0 means all the way through.
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

/** A document is one box (always first) followed by any number of holes cut into it. */
export type Feature = BoxFeature | HoleFeature;

export interface ProjectDocument {
  units: Units;
  features: Feature[];
}

export const BOX_LIMITS = {
  minSize: 1,
  maxSize: 1000,
  minPrintableWall: 0.4,
} as const;

export const DEFAULT_BOX: Omit<BoxFeature, "id"> = {
  type: "box",
  name: "Box",
  width: 60,
  depth: 40,
  height: 30,
  wall: 2,
};

export const HOLE_LIMITS = {
  minDiameter: 0.5,
} as const;

/** A new hole: 5 mm, through, in the middle of the box. */
export function newHole(box: BoxFeature, number: number): HoleFeature {
  const diameter = Math.min(5, Math.max(HOLE_LIMITS.minDiameter, Math.min(box.width, box.depth) / 4));
  return { id: newId(), type: "hole", name: `Hole ${number}`, x: box.width / 2, y: box.depth / 2, diameter, depth: 0 };
}

export const boxOf = (doc: ProjectDocument): BoxFeature => {
  const f = doc.features[0];
  if (!f || f.type !== "box") throw new Error("A project must start with a box.");
  return f;
};

export const holesOf = (doc: ProjectDocument): HoleFeature[] => doc.features.filter((f): f is HoleFeature => f.type === "hole");

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

/** Plain-language checks for a box. Errors block the rebuild; warnings don't. */
export function validateBox(b: BoxFeature): Issue[] {
  const issues: Issue[] = [];
  const sizes = [
    ["width", "Width"],
    ["depth", "Depth"],
    ["height", "Height"],
  ] as const;
  for (const [field, label] of sizes) {
    const v = b[field];
    if (!Number.isFinite(v)) issues.push({ severity: "error", field, message: `${label} needs to be a number.` });
    else if (v < BOX_LIMITS.minSize)
      issues.push({ severity: "error", field, message: `${label} must be at least ${fmt(BOX_LIMITS.minSize)}.` });
    else if (v > BOX_LIMITS.maxSize)
      issues.push({ severity: "error", field, message: `${label} can be at most ${fmt(BOX_LIMITS.maxSize)}.` });
  }
  if (!Number.isFinite(b.wall)) {
    issues.push({ severity: "error", field: "wall", message: "Wall thickness needs to be a number." });
    return issues;
  }
  if (b.wall < 0) {
    issues.push({ severity: "error", field: "wall", message: "Wall thickness can't be negative. Use 0 for a solid block." });
    return issues;
  }
  if (b.wall === 0 || issues.length) return issues;

  const narrowest = Math.min(b.width, b.depth);
  if (b.wall * 2 >= narrowest) {
    issues.push({
      severity: "error",
      field: "wall",
      message: `Walls of ${fmt(b.wall)} would fill the whole box. Use less than ${fmt(narrowest / 2)}, or 0 for a solid block.`,
    });
  } else if (b.wall >= b.height) {
    issues.push({
      severity: "error",
      field: "wall",
      message: `The floor (${fmt(b.wall)}) can't be as thick as the box is tall (${fmt(b.height)}).`,
    });
  } else if (b.wall < BOX_LIMITS.minPrintableWall) {
    issues.push({
      severity: "warning",
      field: "wall",
      message: `Walls thinner than ${fmt(BOX_LIMITS.minPrintableWall)} may not print well on most printers.`,
    });
  }
  return issues;
}

/** Plain-language checks for a hole in a given box. */
export function validateHole(h: HoleFeature, box: BoxFeature): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, field: keyof HoleFeature | null, message: string) =>
    issues.push({ severity, featureId: h.id, field, message });
  const labels = {
    diameter: "Diameter",
    x: "Distance from the left edge",
    y: "Distance from the front edge",
    depth: "Depth",
  } as const;
  for (const k of ["diameter", "x", "y", "depth"] as const) {
    if (!Number.isFinite(h[k])) add("error", k, `${labels[k]} needs to be a number.`);
  }
  if (issues.length) return issues;

  if (h.diameter < HOLE_LIMITS.minDiameter)
    add("error", "diameter", `A hole needs to be at least ${fmt(HOLE_LIMITS.minDiameter)} across.`);
  if (h.depth < 0) add("error", "depth", "Depth can't be negative. Use 0 to go all the way through.");
  else if (h.depth > box.height) {
    add(
      "error",
      "depth",
      `The box is only ${fmt(box.height)} tall. Use ${fmt(box.height)} or less, or 0 to go all the way through.`,
    );
  }
  if (issues.length) return issues;

  const r = h.diameter / 2;
  const sides = [
    ["x", h.x - r, "left"],
    ["x", box.width - h.x - r, "right"],
    ["y", h.y - r, "front"],
    ["y", box.depth - h.y - r, "back"],
  ] as const;
  for (const [field, gap, side] of sides) {
    if (gap < 0) {
      add("error", field, `This hole runs off the ${side} edge of the box. Move it in or make it smaller.`);
      return issues;
    }
  }
  const closest = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (closest[1] < BOX_LIMITS.minPrintableWall) {
    add(
      "warning",
      closest[0],
      `Only ${fmt(closest[1])} of material is left between this hole and the ${closest[2]} edge. That may break or not print.`,
    );
  }
  return issues;
}

/** Every check for the whole design, in the order the shapes appear. */
export function validateDocument(doc: ProjectDocument): Issue[] {
  const box = boxOf(doc);
  const issues: Issue[] = validateBox(box).map((i) => ({ ...i, featureId: box.id }));
  if (hasErrors(issues)) return issues; // hole positions depend on a valid box
  for (const h of holesOf(doc)) issues.push(...validateHole(h, box));
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");
