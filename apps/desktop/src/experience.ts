// How much of Studio 3D is on show: Kids, Easy or Advanced. Picked at the first start and changed in Settings, and
// kept on this computer, not in the design: switching never changes the part, its steps or what Undo can undo. Each
// mode only decides which commands are in view; nothing is taken out of a design made in another mode.
import type { RibbonTab } from "./Ribbon";

export type Experience = "kids" | "easy" | "advanced";

export const EXPERIENCES: Record<Experience, { label: string; blurb: string; detail: string[] }> = {
  kids: {
    label: "Kids",
    blurb: "Big buttons and a few simple shapes to build with.",
    detail: [
      "Boxes, cylinders, cones, balls and holes",
      "Bigger buttons, no menus to get lost in",
      "No command line and no AI helper",
    ],
  },
  easy: {
    label: "Easy",
    blurb: "The everyday tools in view; the rest is one menu away.",
    detail: [
      "Shapes, holes, sketches, hollow and fillet in the ribbon",
      "Chamfer, pattern, mirror and revolve in the menus",
      "Recommended for most people",
    ],
  },
  advanced: {
    label: "Advanced",
    blurb: "Every tool in the ribbon, the command line and keyboard shortcuts.",
    detail: [
      "The whole ribbon and every menu",
      "The command line (Ctrl+9), as in AutoCAD",
      "For people who already know CAD",
    ],
  },
};

export const EXPERIENCE_ORDER: Experience[] = ["kids", "easy", "advanced"];
export const DEFAULT_EXPERIENCE: Experience = "easy";
export const EXPERIENCE_KEY = "studio3d.experience";

/** Ribbon buttons kept in each mode, by their name (or label when they have none). Advanced keeps everything. */
const RIBBON: Record<Exclude<Experience, "advanced">, { tabs: string[]; hidden: string[] }> = {
  easy: { tabs: ["home", "view", "print"], hidden: ["Revolve", "Chamfer", "Pattern", "Mirror"] },
  kids: {
    tabs: ["home", "print"],
    hidden: [
      "Add tube",
      "Threaded hole",
      "Sketch on a face",
      "Draw on the plate",
      "Revolve",
      "Fillet",
      "Chamfer",
      "Pattern",
      "Mirror",
    ],
  },
};

/** The ribbon as a mode shows it: tabs and buttons it leaves out are dropped, and so are groups left empty. */
export function ribbonFor(experience: Experience, tabs: RibbonTab[]): RibbonTab[] {
  if (experience === "advanced") return tabs;
  const { tabs: kept, hidden } = RIBBON[experience];
  return tabs
    .filter((t) => kept.includes(t.id))
    .map((t) => ({
      ...t,
      groups: t.groups
        .map((g) => ({ ...g, items: g.items.filter((i) => !hidden.includes(i.name ?? i.label)) }))
        .filter((g) => g.items.length > 0 || g.info),
    }));
}

/** What each mode lets in beside the ribbon. */
export const shownIn = (experience: Experience) => ({
  /** The menu bar (File, Edit, View…). */
  menus: experience !== "kids",
  /** The typed command line. */
  commandLine: experience !== "kids",
  /** Blurry, the AI helper: it talks to a paid AI service with the user's own key, so not in Kids mode. */
  helper: experience !== "kids",
});

export function parseExperience(raw: string | null): Experience | null {
  return raw === "kids" || raw === "easy" || raw === "advanced" ? raw : null;
}

/** The saved mode, or null on the first start (before one is picked). */
export function readExperience(): Experience | null {
  try {
    return parseExperience(localStorage.getItem(EXPERIENCE_KEY));
  } catch {
    return DEFAULT_EXPERIENCE; // storage refused: no chooser every start, just the recommended mode
  }
}

export function writeExperience(e: Experience): void {
  try {
    localStorage.setItem(EXPERIENCE_KEY, e);
  } catch {
    // Storage can be refused; the mode then lasts until the app closes.
  }
}
