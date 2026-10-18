// Which slicer Print Studio offers to open the part in: the ones found where their installers put them, plus one the
// user located themselves, remembered on this computer. Bambu Studio comes first when it's there.
import type { SlicerProgram } from "./platform";

const KEY = "studio3d.slicer";
const ORDER = ["Bambu Studio", "OrcaSlicer", "PrusaSlicer"];
const rank = (s: SlicerProgram) => (ORDER.indexOf(s.name) + ORDER.length + 1) % (ORDER.length + 1);

/** Every slicer to offer, once each (by path), known ones in order and a located one last. */
export function slicerList(found: SlicerProgram[], located: SlicerProgram | null): SlicerProgram[] {
  const all = located ? [...found, located] : found;
  const seen = new Set<string>();
  return all
    .filter((s) => {
      const key = s.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** The slicer to start on: the one the user last chose if it's still offered, else the first. */
export function defaultSlicer(list: SlicerProgram[], last: string | null): SlicerProgram | null {
  return list.find((s) => s.path === last) ?? list[0] ?? null;
}

/** What's remembered: the slicer last used, and one the user located (which may be the same). */
export interface SlicerMemory {
  last: string | null;
  located: SlicerProgram | null;
}

// Local storage can be switched off; then nothing is remembered and the slicers are simply found again next time.
export function readSlicerMemory(): SlicerMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const located =
      raw?.located && typeof raw.located.name === "string" && typeof raw.located.path === "string"
        ? { name: raw.located.name, path: raw.located.path }
        : null;
    return { last: typeof raw?.last === "string" ? raw.last : null, located };
  } catch {
    return { last: null, located: null };
  }
}

export function writeSlicerMemory(memory: SlicerMemory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // not remembered
  }
}
