// The .s3d project file: versioned JSON.
// Rules: never silently drop data we don't understand, never guess at a newer format,
// and explain every rejection in plain language.
import type { BoxFeature, Feature, ProjectDocument } from "./model";

export const FILE_FORMAT = "studio3d-project";
export const FILE_FORMAT_VERSION = 1;
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
const KNOWN_BOX_KEYS = new Set<string>(["id", "type", "name", "width", "depth", "height", "wall"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pickUnknown(obj: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
}

/** Upgrades older file versions in place. Each step takes version n to n + 1. */
const MIGRATIONS: Record<number, (file: Record<string, unknown>) => void> = {
  // 1: (file) => { ...upgrade to version 2... },
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
  if (!Array.isArray(docRaw.features)) return { ok: false, error: "This project file is damaged: its list of shapes is missing." };

  const features: Feature[] = [];
  const preserved: Preserved = {
    file: pickUnknown(raw, KNOWN_FILE_KEYS),
    document: pickUnknown(docRaw, KNOWN_DOC_KEYS),
    features: {},
  };
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const [i, f] of docRaw.features.entries()) {
    const where = `shape ${i + 1}`;
    if (!isObject(f)) return { ok: false, error: `This project file is damaged: ${where} is unreadable.` };
    if (f.type !== "box") {
      return { ok: false, error: `This project contains a kind of shape ("${String(f.type)}") this version doesn't support yet. The file has not been changed.` };
    }
    if (typeof f.id !== "string" || !f.id || seen.has(f.id)) {
      return { ok: false, error: `This project file is damaged: ${where} has a missing or duplicate ID.` };
    }
    seen.add(f.id);
    const nums = ["width", "depth", "height", "wall"] as const;
    for (const k of nums) {
      if (typeof f[k] !== "number" || !Number.isFinite(f[k])) {
        return { ok: false, error: `This project file is damaged: the ${k} of ${where} isn't a number.` };
      }
    }
    const box: BoxFeature = {
      id: f.id,
      type: "box",
      name: typeof f.name === "string" && f.name ? f.name : "Box",
      width: f.width as number,
      depth: f.depth as number,
      height: f.height as number,
      wall: f.wall as number,
    };
    const extra = pickUnknown(f, KNOWN_BOX_KEYS);
    if (Object.keys(extra).length) {
      preserved.features[box.id] = extra;
      warnings.push(`${box.name} has settings from a newer version (${Object.keys(extra).join(", ")}). They'll be kept when you save, but aren't used.`);
    }
    features.push(box);
  }
  if (Object.keys(preserved.file).length || Object.keys(preserved.document).length) {
    warnings.push("This project has data from a newer version. It'll be kept when you save, but isn't used.");
  }

  return { ok: true, document: { units: "mm", features }, preserved, warnings };
}
