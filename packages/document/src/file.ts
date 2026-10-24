// The .s3d project file: versioned JSON.
// Rules: never silently drop data we don't understand, never guess at a newer format,
// and explain every rejection in plain language.
import { EDGE_SETS, OPEN_SIDES, SIZE_FIELDS, type Feature, type ProjectDocument } from "./model";
import { CLEARANCE_SERIES, isScrewSize, isThreadSize } from "./threads";
import { referenceProblem, type ReferenceImage } from "./reference";
import { printSetupProblem, type PrintSetup } from "./print";

export const FILE_FORMAT = "studio3d-project";
export const FILE_FORMAT_VERSION = 2;
export const FILE_EXTENSION = "s3d";

export interface AppInfo {
  name: string;
  version: string;
}

/** Data from a file that this version doesn't understand, kept so saving doesn't lose it. */
export interface Preserved {
  file: Record<string, unknown>;
  document: Record<string, unknown>;
  features: Record<string, Record<string, unknown>>;
}

export const emptyPreserved = (): Preserved => ({
  file: {},
  document: {},
  features: {},
});

export type ParseResult =
  | {
      ok: true;
      document: ProjectDocument;
      preserved: Preserved;
      warnings: string[];
    }
  | { ok: false; error: string };

export function serializeProject(doc: ProjectDocument, app: AppInfo, preserved: Preserved = emptyPreserved()): string {
  const file = {
    ...preserved.file,
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    app,
    document: {
      ...preserved.document,
      units: doc.units,
      features: doc.features.map((f) => ({
        ...preserved.features[f.id],
        ...f,
      })),
      ...(doc.references?.length && { references: doc.references }),
      ...(doc.print && { print: doc.print }),
    },
  };
  return JSON.stringify(file, null, 2) + "\n";
}

const KNOWN_FILE_KEYS = new Set(["format", "formatVersion", "app", "document"]);
const KNOWN_DOC_KEYS = new Set(["units", "features", "references", "print"]);
/** The numbers each kind of step stores. */
const NUMBERS: Record<Feature["type"], readonly string[]> = {
  box: ["x", "y", "z", ...SIZE_FIELDS.box],
  cylinder: ["x", "y", "z", ...SIZE_FIELDS.cylinder],
  tube: ["x", "y", "z", ...SIZE_FIELDS.tube],
  cone: ["x", "y", "z", ...SIZE_FIELDS.cone],
  sphere: ["x", "y", "z", ...SIZE_FIELDS.sphere],
  hole: ["x", "y", "diameter", "depth"],
  sketch: ["depth"],
  hollow: ["wall"],
  fillet: ["size"],
  chamfer: ["size"],
  pattern: ["count", "spacing", "rows", "rowSpacing", "angle", "cx", "cy"],
  mirror: ["at"],
};
const TYPES = new Set(Object.keys(NUMBERS));
const knownKeys = (type: Feature["type"]) =>
  new Set([
    "id",
    "type",
    "name",
    ...(["hole", "hollow", "fillet", "chamfer", "pattern", "mirror"].includes(type) ? [] : ["mode"]),
    ...(type === "pattern" ? ["source", "kind"] : []),
    ...(type === "mirror" ? ["source", "axis"] : []),
    ...(type === "hollow" ? ["open"] : []),
    ...(type === "fillet" || type === "chamfer" ? ["edges", "picked"] : []),
    ...(type === "cylinder" || type === "hole" ? ["thread", "fit", "hand"] : []),
    ...(type === "box" ? ["rotation"] : []),
    ...(type === "sketch" ? ["plane", "surface", "profiles", "revolve"] : []),
    ...(type === "hole" ? ["face", "threadDepth", "simplified", "clearance", "head", "drillPoint"] : []),
    ...NUMBERS[type],
  ]);
const DEFAULT_NAMES: Record<Feature["type"], string> = {
  box: "Box",
  cylinder: "Cylinder",
  tube: "Tube",
  cone: "Cone",
  sphere: "Sphere",
  hole: "Hole",
  sketch: "Sketch",
  hollow: "Hollow",
  fillet: "Fillet",
  chamfer: "Chamfer",
  pattern: "Pattern",
  mirror: "Mirror",
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pickUnknown(obj: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
}

/** Upgrades older file versions in place. Each step takes version n to n + 1. */
const MIGRATIONS: Record<number, (file: Record<string, unknown>) => void> = {
  // Version 1 had one box centred on the plate, with holes measured from the box's left and front edges.
  // Version 2 places every shape and hole from the centre of the plate.
  1: (file) => {
    const doc = file.document;
    if (!isObject(doc) || !Array.isArray(doc.features)) return;
    const box = doc.features[0];
    if (!isObject(box) || box.type !== "box") return;
    const halfW = typeof box.width === "number" ? box.width / 2 : 0;
    const halfD = typeof box.depth === "number" ? box.depth / 2 : 0;
    for (const f of doc.features) {
      if (!isObject(f)) continue;
      if (f.type === "box") Object.assign(f, { mode: "add", x: 0, y: 0, z: 0 });
      if (f.type === "hole" && typeof f.x === "number" && typeof f.y === "number") {
        f.x -= halfW;
        f.y -= halfD;
      }
    }
  },
};

const isNumbers = (v: unknown, n: number) =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** What's wrong with a stored sketch's surface and outlines, or null when they can be read. */
function sketchProblem(f: Record<string, unknown>): string | null {
  const plane = f.plane;
  if (!isObject(plane) || !isNumbers(plane.origin, 3) || !isNumbers(plane.xDir, 3) || !isNumbers(plane.normal, 3))
    return "has an unreadable sketch position";
  if (typeof f.surface !== "string") return "doesn't say what it was drawn on";
  if (!Array.isArray(f.profiles)) return "has no outlines";
  if (f.revolve !== undefined && (typeof f.revolve !== "number" || !Number.isFinite(f.revolve)))
    return "has an unreadable spin angle";
  for (const p of f.profiles) {
    if (!isObject(p)) return "has an unreadable outline";
    const ok =
      p.kind === "rectangle"
        ? ["x", "y", "width", "height"].every((k) => typeof p[k] === "number" && Number.isFinite(p[k]))
        : p.kind === "circle"
          ? ["x", "y", "diameter"].every((k) => typeof p[k] === "number" && Number.isFinite(p[k]))
          : p.kind === "polygon"
            ? Array.isArray(p.points) && p.points.every((q) => isNumbers(q, 2))
            : false;
    if (!ok) return `has an outline it can't read ("${String(p.kind)}")`;
  }
  return null;
}

const SIDES = ["top", "bottom", "front", "back", "left", "right"];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** What's wrong with a stored hole's thread depth, clearance or head, or null when they can be read. */
function holeKindProblem(f: Record<string, unknown>): string | null {
  if (f.threadDepth !== undefined && !finite(f.threadDepth)) return "has a thread depth that isn't a number";
  if (f.simplified !== undefined && typeof f.simplified !== "boolean") return "doesn't say how its thread is drawn";
  if (f.drillPoint !== undefined && typeof f.drillPoint !== "boolean") return "doesn't say how its bottom is shaped";
  if (f.clearance !== undefined) {
    const c = f.clearance as Record<string, unknown> | null;
    if (typeof c !== "object" || !c || !isScrewSize(c.screw) || !CLEARANCE_SERIES.includes(c.series as never))
      return "has a clearance hole size this version doesn't know";
  }
  if (f.head !== undefined) {
    const h = f.head as Record<string, unknown> | null;
    if (
      typeof h !== "object" ||
      !h ||
      !finite(h.diameter) ||
      !(h.kind === "countersink" || (h.kind === "counterbore" && finite(h.depth)))
    )
      return "has a counterbore or countersink that can't be read";
  }
  return null;
}

/** What's wrong with a stored hole face, or null when it can be read. */
function holeFaceProblem(face: unknown): string | null {
  if (!isObject(face)) return "has an unreadable face";
  const plane = face.plane;
  if (!isObject(plane) || !isNumbers(plane.origin, 3) || !isNumbers(plane.xDir, 3) || !isNumbers(plane.normal, 3))
    return "has an unreadable face position";
  if (typeof face.surface !== "string") return "doesn't say which face it is on";
  if (![face.width, face.height].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0))
    return "has an unreadable face size";
  if (
    !["left", "right", "centre"].includes(face.across as string) ||
    !["bottom", "top", "centre"].includes(face.up as string)
  )
    return "doesn't say which edges it is measured from";
  if (
    face.on !== undefined &&
    (!isObject(face.on) || typeof face.on.shape !== "string" || !SIDES.includes(face.on.side as string))
  )
    return "doesn't say which shape's face it follows";
  return null;
}

export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "This file is damaged or isn't a Studio 3D project (it isn't valid project data).",
    };
  }
  if (!isObject(raw) || raw.format !== FILE_FORMAT) {
    return { ok: false, error: "This file isn't a Studio 3D project." };
  }
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      error: "This project file is damaged: its format version is missing or invalid.",
    };
  }
  if (version > FILE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `This project was saved by a newer version of Studio 3D (file format ${version}). Please update the app to open it. The file has not been changed.`,
    };
  }
  for (let v = version; v < FILE_FORMAT_VERSION; v++) MIGRATIONS[v]?.(raw);

  const docRaw = raw.document;
  if (!isObject(docRaw))
    return {
      ok: false,
      error: "This project file is damaged: it has no design in it.",
    };
  if (docRaw.units !== "mm") {
    return {
      ok: false,
      error: `This project uses units "${String(docRaw.units)}", which this version can't open.`,
    };
  }
  if (!Array.isArray(docRaw.features))
    return {
      ok: false,
      error: "This project file is damaged: its list of shapes is missing.",
    };

  const features: Feature[] = [];
  const preserved: Preserved = {
    file: pickUnknown(raw, KNOWN_FILE_KEYS),
    document: pickUnknown(docRaw, KNOWN_DOC_KEYS),
    features: {},
  };
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const [i, f] of docRaw.features.entries()) {
    const where = `step ${i + 1}`;
    if (!isObject(f))
      return {
        ok: false,
        error: `This project file is damaged: ${where} is unreadable.`,
      };
    if (typeof f.type !== "string" || !TYPES.has(f.type)) {
      return {
        ok: false,
        error: `This project contains a kind of shape ("${String(f.type)}") this version doesn't support yet. The file has not been changed.`,
      };
    }
    const type = f.type as Feature["type"];
    if (typeof f.id !== "string" || !f.id || seen.has(f.id)) {
      return {
        ok: false,
        error: `This project file is damaged: ${where} has a missing or duplicate ID.`,
      };
    }
    seen.add(f.id);
    for (const k of NUMBERS[type]) {
      if (typeof f[k] !== "number" || !Number.isFinite(f[k])) {
        return {
          ok: false,
          error: `This project file is damaged: the ${k} of ${where} isn't a number.`,
        };
      }
    }
    if (
      type === "box" &&
      f.rotation !== undefined &&
      (typeof f.rotation !== "number" || !Number.isFinite(f.rotation))
    ) {
      return {
        ok: false,
        error: `This project file is damaged: the rotation of ${where} isn't a number.`,
      };
    }
    if (
      (type === "cylinder" || type === "hole") &&
      ((f.thread !== undefined && !isThreadSize(f.thread)) ||
        (f.fit !== undefined && (typeof f.fit !== "number" || !Number.isFinite(f.fit))) ||
        (f.hand !== undefined && f.hand !== "left"))
    ) {
      return {
        ok: false,
        error: `This project file is damaged: the thread of ${where} isn't one this version knows.`,
      };
    }
    if (type === "hollow" && !OPEN_SIDES.some((o) => o.side === f.open)) {
      return {
        ok: false,
        error: `This project file is damaged: ${where} doesn't say which side is open.`,
      };
    }
    if ((type === "fillet" || type === "chamfer") && !EDGE_SETS.some((x) => x.edges === f.edges)) {
      return {
        ok: false,
        error: `This project file is damaged: ${where} doesn't say which edges to change.`,
      };
    }
    const point = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n));
    if (
      (type === "fillet" || type === "chamfer") &&
      ((f.picked !== undefined && (!Array.isArray(f.picked) || !f.picked.every(point))) ||
        (f.edges === "picked" && !(Array.isArray(f.picked) && f.picked.length > 0)))
    ) {
      return {
        ok: false,
        error: `This project file is damaged: the picked edges of ${where} aren't readable.`,
      };
    }
    if (
      (type === "pattern" || type === "mirror") &&
      (typeof f.source !== "string" ||
        (type === "pattern" ? f.kind !== "grid" && f.kind !== "circle" : f.axis !== "x" && f.axis !== "y"))
    ) {
      return {
        ok: false,
        error: `This project file is damaged: ${where} doesn't say what it copies, or how.`,
      };
    }
    if (
      !["hole", "hollow", "fillet", "chamfer", "pattern", "mirror"].includes(type) &&
      f.mode !== "add" &&
      f.mode !== "cut"
    ) {
      return {
        ok: false,
        error: `This project file is damaged: ${where} doesn't say whether it adds or cuts.`,
      };
    }
    if (type === "hole") {
      const problem = holeKindProblem(f);
      if (problem)
        return {
          ok: false,
          error: `This project file is damaged: ${where} ${problem}.`,
        };
    }
    if (type === "hole" && f.face !== undefined) {
      const problem = holeFaceProblem(f.face);
      if (problem)
        return {
          ok: false,
          error: `This project file is damaged: ${where} ${problem}.`,
        };
    }
    if (type === "sketch") {
      const problem = sketchProblem(f);
      if (problem)
        return {
          ok: false,
          error: `This project file is damaged: ${where} ${problem}.`,
        };
    }
    const name = typeof f.name === "string" && f.name ? f.name : `${DEFAULT_NAMES[type]} ${i + 1}`;
    const known = knownKeys(type);
    const feature = Object.fromEntries(Object.entries(f).filter(([k]) => known.has(k))) as unknown as Feature;
    feature.name = name;
    const extra = pickUnknown(f, known);
    if (Object.keys(extra).length) {
      preserved.features[feature.id] = extra;
      warnings.push(
        `${name} has settings from a newer version (${Object.keys(extra).join(", ")}). They'll be kept when you save, but aren't used.`,
      );
    }
    features.push(feature);
  }
  if (Object.keys(preserved.file).length || Object.keys(preserved.document).length) {
    warnings.push("This project has data from a newer version. It'll be kept when you save, but isn't used.");
  }

  const references: ReferenceImage[] = [];
  if (docRaw.references !== undefined) {
    if (!Array.isArray(docRaw.references))
      return { ok: false, error: "This project file is damaged: its reference images can't be read." };
    for (const [i, r] of docRaw.references.entries()) {
      const problem = referenceProblem(r);
      if (problem) return { ok: false, error: `This project file is damaged: reference image ${i + 1} ${problem}.` };
      const { id, name, src, pixels, scale, calibrated, plane, x, y, offset, rotation, opacity, visible, onTop } =
        r as ReferenceImage;
      references.push({
        id,
        name: typeof name === "string" && name ? name : `Picture ${i + 1}`,
        src,
        pixels,
        scale,
        calibrated,
        plane,
        x,
        y,
        offset,
        rotation,
        opacity,
        visible,
        onTop,
      });
    }
  }

  let print: PrintSetup | undefined;
  if (docRaw.print !== undefined) {
    const problem = printSetupProblem(docRaw.print);
    if (problem) return { ok: false, error: `This project file is damaged: its print setup ${problem}.` };
    print = { ...(docRaw.print as PrintSetup) }; // settings from a newer version ride along, unused
  }

  return {
    ok: true,
    document: { units: "mm", features, ...(references.length && { references }), ...(print && { print }) },
    preserved,
    warnings,
  };
}
