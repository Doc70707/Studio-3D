// Crash recovery: a copy of the unsaved design, kept outside the user's own file.
// It holds a normal project file plus where that project was saved (if anywhere), so restoring
// can carry on saving to the same place. Nothing here is trusted: it is checked like any opened file.
import { parseProject, type ParseResult } from "./file";

export const RECOVERY_FORMAT = "studio3d-recovery";
export const RECOVERY_VERSION = 1;

/** The saved project a recovery copy belongs to, when it had been saved before. */
export interface RecoveryFile {
  name: string;
  /** Full path on desktop. Absent in the browser. */
  path?: string;
}

export interface RecoverySnapshot {
  /** When the copy was written (ISO 8601). */
  savedAt: string;
  file: RecoveryFile | null;
  /** The design, as the text of a normal .s3d project file. */
  project: string;
}

export type RecoveryResult =
  | { ok: true; snapshot: RecoverySnapshot; parsed: Extract<ParseResult, { ok: true }> }
  | { ok: false; error: string };

export function serializeRecovery(snapshot: RecoverySnapshot): string {
  return JSON.stringify({ format: RECOVERY_FORMAT, formatVersion: RECOVERY_VERSION, ...snapshot });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const DAMAGED = "The backup of your unsaved work is damaged, so it can't be restored.";

/** Reads a recovery copy and the design inside it, explaining any problem in plain words. */
export function parseRecovery(text: string): RecoveryResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: DAMAGED };
  }
  if (!isObject(raw) || raw.format !== RECOVERY_FORMAT) return { ok: false, error: DAMAGED };
  if (typeof raw.formatVersion !== "number" || raw.formatVersion > RECOVERY_VERSION)
    return { ok: false, error: "The backup of your unsaved work was made by a newer version of Studio 3D." };
  if (typeof raw.savedAt !== "string" || Number.isNaN(Date.parse(raw.savedAt)) || typeof raw.project !== "string")
    return { ok: false, error: DAMAGED };

  let file: RecoveryFile | null = null;
  if (raw.file !== null && raw.file !== undefined) {
    const f = raw.file;
    if (!isObject(f) || typeof f.name !== "string" || !f.name || (f.path !== undefined && typeof f.path !== "string"))
      return { ok: false, error: DAMAGED };
    file = typeof f.path === "string" ? { name: f.name, path: f.path } : { name: f.name };
  }

  const parsed = parseProject(raw.project);
  if (!parsed.ok) return { ok: false, error: `The backup of your unsaved work can't be restored. ${parsed.error}` };
  return { ok: true, snapshot: { savedAt: raw.savedAt, file, project: raw.project }, parsed };
}
