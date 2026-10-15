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

export type Feature = BoxFeature;

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

export function newDocument(): ProjectDocument {
  return { units: "mm", features: [{ id: newId(), ...DEFAULT_BOX }] };
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Which parameter the issue is about, so the UI can show it next to the right field. */
  field: keyof BoxFeature | null;
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
    else if (v < BOX_LIMITS.minSize) issues.push({ severity: "error", field, message: `${label} must be at least ${fmt(BOX_LIMITS.minSize)}.` });
    else if (v > BOX_LIMITS.maxSize) issues.push({ severity: "error", field, message: `${label} can be at most ${fmt(BOX_LIMITS.maxSize)}.` });
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

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");
