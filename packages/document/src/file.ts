// The .s3d project file: versioned JSON.
// Rules: never silently drop data we don't understand, never guess at a newer format,
// and explain every rejection in plain language.
import { SIZE_FIELDS, type Feature, type ProjectDocument } from "./model";

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

export const emptyPreserved = (): Preserved => ({ file: {}, document: {}, features: {} });

export type ParseResult =
  | { ok: true; document: ProjectDocument; preserved: Preserved; warnings: string[] }
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
      features: doc.features.map((f) => ({ ...preserved.features[f.id], ...f })),
    },
  };
  return JSON.stringify(file, null, 2) + "\n";
}

const KNOWN_FILE_KEYS = new Set(["format", "formatVersion", "app", "document"]);
const KNOWN_DOC_KEYS = new Set(["units", "features"]);
/** The numbers each kind of step stores. */
const NUMBERS: Record<Feature["type"], readonly string[]> = {
  box: ["x", "y", "z", ...SIZE_FIELDS.box],
  cylinder: ["x", "y", "z", ...SIZE_FIELDS.cylinder],
  tube: ["x", "y", "z", ...SIZE_FIELDS.tube],
  cone: ["x", "y", "z", ...SIZE_FIELDS.cone],
  sphere: ["x", "y", "z", ...SIZE_FIELDS.sphere],
  hole: ["x", "y", "diameter", "depth"],
};
const TYPES = new Set(Object.keys(NUMBERS));
const knownKeys = (type: Feature["type"]) =>
  new Set(["id", "type", "name", ...(type === "hole" ? [] : ["mode"]), ...NUMBERS[type]]);
const DEFAULT_NAMES: Record<Feature["type"], string> = {
  box: "Box",
  cylinder: "Cylinder",
  tube: "Tube",
  cone: "Cone",
  sphere: "Sphere",
  hole: "Hole",
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

export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is damaged or isn't a Studio 3D project (it isn't valid project data)." };
  }
  if (!isObject(raw) || raw.format !== FILE_FORMAT) {
    return { ok: false, error: "This file isn't a Studio 3D project." };
  }
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "This project file is damaged: its format version is missing or invalid." };
  }
  if (version > FILE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `This project was saved by a newer version of Studio 3D (file format ${version}). Please update the app to open it. The file has not been changed.`,
    };
  }
  for (let v = version; v < FILE_FORMAT_VERSION; v++) MIGRATIONS[v]?.(raw);

  const docRaw = raw.document;
  if (!isObject(docRaw)) return { ok: false, error: "This project file is damaged: it has no design in it." };
  if (docRaw.units !== "mm") {
    return { ok: false, error: `This project uses units "${String(docRaw.units)}", which this version can't open.` };
  }
  if (!Array.isArray(docRaw.features))
    return { ok: false, error: "This project file is damaged: its list of shapes is missing." };

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
    if (!isObject(f)) return { ok: false, error: `This project file is damaged: ${where} is unreadable.` };
    if (typeof f.type !== "string" || !TYPES.has(f.type)) {
      return {
        ok: false,
        error: `This project contains a kind of shape ("${String(f.type)}") this version doesn't support yet. The file has not been changed.`,
      };
    }
    const type = f.type as Feature["type"];
    if (i === 0 && type === "hole") {
      return { ok: false, error: "This project file is damaged: it has to start with a shape, not a hole." };
    }
    if (typeof f.id !== "string" || !f.id || seen.has(f.id)) {
      return { ok: false, error: `This project file is damaged: ${where} has a missing or duplicate ID.` };
    }
    seen.add(f.id);
    for (const k of NUMBERS[type]) {
      if (typeof f[k] !== "number" || !Number.isFinite(f[k])) {
        return { ok: false, error: `This project file is damaged: the ${k} of ${where} isn't a number.` };
      }
    }
    if (type !== "hole" && f.mode !== "add" && f.mode !== "cut") {
      return { ok: false, error: `This project file is damaged: ${where} doesn't say whether it adds or cuts.` };
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
  if (!features.length) return { ok: false, error: "This project file is damaged: it has no shapes in it." };
  if (Object.keys(preserved.file).length || Object.keys(preserved.document).length) {
    warnings.push("This project has data from a newer version. It'll be kept when you save, but isn't used.");
  }

  return { ok: true, document: { units: "mm", features }, preserved, warnings };
}
