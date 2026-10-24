// Every command the app has, in one list: read from the menus and the ribbon as they are right now, so the command
// line and Blurry can only offer what really exists, greyed out with the same reason when it can't run. Each command
// also has the short names people type in AutoCAD and Civil 3D (FILLET, F, REC...) and everyday words for it
// ("cube", "round the edges"), so it can be found by what it does as well as by its name.
import type { Menu } from "./MenuBar";
import type { RibbonTab } from "./Ribbon";

export interface Command {
  /** Its name, as on its button or menu item, without "…". */
  title: string;
  /** Where it lives, to show people where to find it next time: "Home › Modify", "File". */
  where: string[];
  /** Short names to type, upper case, as in AutoCAD: "FILLET", "F". */
  aliases: string[];
  /** Everyday words that mean it. */
  words: string[];
  run: () => void;
  disabled?: boolean;
  reason?: string;
  shortcut?: string;
}

/** Typed names and words for commands, by title. Titles not listed here can still be found by their own words. */
export const COMMAND_WORDS: Record<string, { aliases: string[]; words: string[] }> = {
  Box: { aliases: ["BOX"], words: ["cube", "block", "brick", "square", "rectangle solid", "cuboid"] },
  Cylinder: { aliases: ["CYLINDER", "CYL"], words: ["rod", "peg", "pin", "post", "round", "column", "shaft"] },
  Tube: { aliases: ["TUBE"], words: ["pipe", "ring", "sleeve", "spacer", "bushing", "hollow cylinder"] },
  Cone: { aliases: ["CONE"], words: ["taper", "funnel", "point"] },
  Sphere: { aliases: ["SPHERE", "BALL"], words: ["ball", "dome", "globe", "round"] },
  Hole: { aliases: ["HOLE", "H"], words: ["drill", "bore", "screw hole", "opening", "through hole"] },
  "Threaded hole": {
    aliases: ["THOLE", "TAPHOLE"],
    words: ["tapped hole", "tap", "thread a hole", "screw thread", "bolt hole with thread"],
  },
  "Hole on a face": { aliases: ["HOLEFACE"], words: ["drill the side", "hole in a side", "hole on side"] },
  "Sketch on a face": { aliases: ["SKETCHFACE"], words: ["draw on a side", "draw on face", "emboss", "engrave"] },
  "Sketch on the plate": { aliases: ["SKETCH"], words: ["draw", "profile", "extrude", "drawing"] },
  Rectangle: { aliases: ["RECTANGLE", "REC", "RECTANG"], words: ["draw a rectangle", "draw a square", "plate"] },
  Circle: { aliases: ["CIRCLE", "C"], words: ["draw a circle", "disc", "round outline"] },
  Outline: { aliases: ["PLINE", "PL", "LINE", "L"], words: ["polyline", "lines", "draw lines", "outline", "shape"] },
  Polygon: { aliases: ["POLYGON", "POL"], words: ["hexagon", "nut", "sides", "octagon", "triangle"] },
  Revolve: { aliases: ["REVOLVE", "REV"], words: ["spin", "turn", "lathe", "vase", "bottle", "round part"] },
  "Hollow out": { aliases: ["SHELL", "HOLLOW"], words: ["shell", "empty", "make hollow", "walls", "box inside"] },
  Fillet: {
    aliases: ["FILLET", "F"],
    words: ["round edges", "round the edges", "rounded", "smooth corners", "radius"],
  },
  Chamfer: { aliases: ["CHAMFER", "CHA"], words: ["bevel", "angle the edges", "cut corners", "elephant foot"] },
  Pattern: { aliases: ["ARRAY", "AR", "PATTERN"], words: ["repeat", "copies", "grid of", "circle of", "duplicate"] },
  Mirror: { aliases: ["MIRROR", "MI"], words: ["flip", "symmetry", "other side", "reflect"] },
  "Reference picture": { aliases: ["IMAGE", "IMAGEATTACH"], words: ["photo", "picture", "trace", "background image"] },
  New: { aliases: ["NEW"], words: ["start over", "blank", "new project"] },
  Open: { aliases: ["OPEN"], words: ["load", "open project", "open file"] },
  "Save as": { aliases: ["SAVEAS"], words: ["save a copy", "save under a new name"] },
  "Download project": { aliases: ["SAVE"], words: ["save", "keep", "download"] },
  Save: { aliases: ["SAVE", "QSAVE"], words: ["save", "keep"] },
  "Prepare to print": { aliases: ["PRINT", "PLOT", "SLICE"], words: ["3d print", "printer", "slicer", "print it"] },
  "Export STL": { aliases: ["STL", "STLOUT", "EXPORT"], words: ["export", "stl file", "send to slicer", "mesh"] },
  "Export 3MF": { aliases: ["3MF"], words: ["3mf file", "bambu", "export 3mf"] },
  Undo: { aliases: ["UNDO", "U"], words: ["go back", "take back", "oops", "revert"] },
  Redo: { aliases: ["REDO"], words: ["again", "redo that"] },
  Delete: { aliases: ["ERASE", "E", "DELETE", "DEL"], words: ["remove", "erase", "get rid of"] },
  Deselect: { aliases: ["DESELECT"], words: ["clear selection", "pick nothing"] },
  "3D view": { aliases: ["ISO", "3D"], words: ["home view", "perspective", "angled view"] },
  "Top view": { aliases: ["TOP", "PLAN"], words: ["from above", "plan view", "look down"] },
  "Front view": { aliases: ["FRONT"], words: ["from the front", "elevation"] },
  "Right view": { aliases: ["RIGHT"], words: ["from the side", "side view"] },
  Orthographic: { aliases: ["ORTHO", "PARALLEL"], words: ["flat view", "no perspective"] },
  "Fit all": { aliases: ["ZOOMEXTENTS", "ZE", "ZOOM", "Z"], words: ["zoom to fit", "show everything", "see it all"] },
  "Show sizes": { aliases: ["DIM", "DIMS", "SIZES"], words: ["dimensions", "measurements", "show measurements"] },
  "Sizes in inches": { aliases: ["INCHES"], words: ["imperial", "inch", "metric", "millimetres", "mm"] },
  Units: {
    aliases: ["UNITS", "UN"],
    words: ["feet", "feet and inches", "centimetres", "metres", "fractions", "precision", "decimal places"],
  },
  "Measure distance": {
    aliases: ["D", "DIST", "DI", "MEASURE", "MEA"],
    words: ["how far", "distance", "ruler", "length"],
  },
  "Object snaps": { aliases: ["OSNAP", "OS", "SNAP"], words: ["snapping", "snap to points"] },
  "Build plate": {
    aliases: ["PLATE", "BED"],
    words: ["model space", "no plate", "hide the plate", "turn off the plate", "print bed"],
  },
  Grid: { aliases: ["GRID", "GRIDMODE"], words: ["grid lines", "hide the grid", "squares"] },
  "Background colour": {
    aliases: ["BACKGROUND", "BG"],
    words: ["background", "black background", "background color", "model space colour"],
  },
  Palettes: { aliases: ["PALETTES"], words: ["side panels", "panels"] },
  "Reset workspace": { aliases: ["WSRESET"], words: ["reset layout", "put panels back"] },
  Settings: {
    aliases: ["OPTIONS", "OP", "SETTINGS", "THEME", "COLOURS", "COLORS"],
    words: ["preferences", "appearance", "dark mode", "light mode", "colour", "color", "theme", "options"],
  },
  "Focus canvas": { aliases: ["CLEANSCREEN", "CLEAN"], words: ["hide panels", "more room", "focus"] },
  "Full screen": { aliases: ["FULLSCREEN"], words: ["full screen", "bigger window"] },
  "Command line": { aliases: ["COMMANDLINE", "CMD"], words: ["command bar", "type commands"] },
  // AutoCAD's editing commands on the picked piece.
  Move: { aliases: ["MOVE", "M"], words: ["shift", "slide", "reposition", "move it"] },
  Copy: { aliases: ["COPY", "CO", "CP"], words: ["duplicate", "another one", "clone"] },
  Rotate: { aliases: ["ROTATE", "RO"], words: ["turn", "turn it", "angle it", "spin it"] },
  Scale: { aliases: ["SCALE", "SC"], words: ["bigger", "smaller", "resize", "grow", "shrink"] },
  Offset: { aliases: ["OFFSET", "O"], words: ["parallel copy", "inset", "outset", "grow outline", "shrink outline"] },
  "Cut away": { aliases: ["SUBTRACT", "SU"], words: ["make it a cut", "cut this away", "subtract"] },
  "Add material": { aliases: ["UNION", "UNI"], words: ["make it solid", "add this", "union", "join"] },
  // The sketch screen's own commands.
  Select: { aliases: ["SELECT"], words: ["pick a shape", "move a shape", "pointer"] },
  "Ortho mode": { aliases: ["ORTHO", "ORTHOMODE"], words: ["straight lines", "lock straight", "square lines"] },
  "Mid of 2 points": { aliases: ["M2P", "MTP"], words: ["halfway", "midpoint between", "middle of two"] },
  "2D view": { aliases: ["2D", "PLAN"], words: ["flat drawing", "back to drawing"] },
  "Push out": { aliases: ["EXTRUDE", "EXT"], words: ["extrude", "raise", "emboss", "add material"] },
  "Cut in": { aliases: ["CUT", "SUBTRACT", "SU"], words: ["engrave", "pocket", "cut out", "remove material"] },
  Done: { aliases: ["DONE", "EXIT", "OK"], words: ["finish", "finished", "save sketch", "apply"] },
  "Cancel sketch": { aliases: ["CANCEL", "QUIT"], words: ["discard", "throw away", "leave without saving"] },
};

/** Ribbon buttons whose short label names the same command as a menu item. */
const RIBBON_TITLES: Record<string, string> = {
  "On a face": "Sketch on a face",
  "On the plate": "Sketch on the plate",
  Hollow: "Hollow out",
  Measure: "Measure distance",
  Reset: "Reset workspace",
};

/** "Fillet (round edges)" and "Pattern Box 1" are the commands Fillet and Pattern. */
const clean = (label: string) =>
  label
    .replace(/…$/, "")
    .replace(/\s*\(.*\)$/, "")
    .replace(/^(Pattern|Mirror) .*/, "$1")
    .trim();

/**
 * The commands in the menus and ribbon, one per title (a command on both a menu and the ribbon is listed once, with
 * both places). Help and links to other dialogs are left out: they aren't things to do to the part.
 */
export function indexCommands(
  menus: Menu[],
  tabs: RibbonTab[],
  extra: Omit<Command, "aliases" | "words">[] = [],
): Command[] {
  const byTitle = new Map<string, Command>();
  const add = (label: string, where: string, c: Omit<Command, "title" | "where" | "aliases" | "words">) => {
    const title = clean(label);
    const known = byTitle.get(title);
    if (known) {
      if (!known.where.includes(where)) known.where.push(where);
      if (known.disabled && !c.disabled) Object.assign(known, c); // the one that can run wins
      return;
    }
    const w = COMMAND_WORDS[title];
    byTitle.set(title, { title, where: [where], aliases: w?.aliases ?? [], words: w?.words ?? [], ...c });
  };
  for (const m of menus) {
    if (m.label === "Help") continue;
    for (const e of m.items)
      if (e !== "separator")
        add(e.label, m.label, { run: e.onSelect, disabled: e.disabled, reason: e.reason, shortcut: e.shortcut });
  }
  for (const t of tabs)
    for (const g of t.groups)
      for (const i of g.items)
        add(RIBBON_TITLES[i.label] ?? i.label, `${t.label} › ${g.label}`, {
          run: i.onClick,
          disabled: i.disabled,
          reason: i.reason,
        });
  // Commands only the command line has (the sketch tools): where they live is given with them.
  for (const { title, where, ...c } of extra) {
    add(title, where[0] ?? "", c);
    for (const w of where.slice(1)) add(title, w, c);
  }
  return [...byTitle.values()];
}

export interface Found {
  command: Command;
  /** How well it matches, higher is better: an exact typed name beats the start of one beats a word. */
  score: number;
  /** What matched, for the list: "FILLET", "round edges". */
  matched: string;
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * The commands that fit what was typed, best first. A typed name (FILLET, F) matches exactly or by its start; the
 * title and everyday words match by whole words or word starts, in any order ("edges round" finds Fillet).
 */
export function findCommands(query: string, commands: Command[], limit = 8): Found[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase().replace(/\s+/g, "");
  const qs = words(q);
  const out: Found[] = [];
  for (const c of commands) {
    let best = null as Found | null;
    const offer = (score: number, matched: string) => {
      if (!best || score > best.score) best = { command: c, score, matched };
    };
    for (const a of c.aliases) {
      if (a === upper) offer(100 - a.length * 0.01, a);
      else if (upper.length >= 2 && a.startsWith(upper)) offer(70 - (a.length - upper.length), a);
    }
    for (const phrase of [c.title, ...c.words]) {
      const ws = words(phrase);
      if (!ws.length || !qs.length) continue;
      // Every typed word has to start a word of the phrase.
      const hits = qs.filter((w) => ws.some((x) => x.startsWith(w)));
      if (hits.length !== qs.length) continue;
      const whole = qs.filter((w) => ws.includes(w)).length;
      const isTitle = phrase === c.title;
      offer((isTitle ? 60 : 50) + whole * 4 + (qs.length === ws.length ? 6 : 0), isTitle ? c.title : phrase);
    }
    if (best) out.push(best);
  }
  // Ones that can run first among equals, then the shorter title.
  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!a.command.disabled) - Number(!!b.command.disabled) ||
        a.command.title.length - b.command.title.length,
    )
    .slice(0, limit);
}

/** Words that say nothing about which command is meant. */
const FILLER = new Set(
  "a an the to it its me my i i'm want need would like please can could you add make put give do does is this that these those of for in on at with some one and or how where what which get".split(
    " ",
  ),
);

/**
 * The commands a sentence asks for: the whole sentence first ("round the edges"); failing that, each of its words
 * on its own ("I want a hole in the top" finds Hole), the best of them first.
 */
export function commandsFor(message: string, commands: Command[], limit = 3): Found[] {
  const kept = words(message).filter((w) => !FILLER.has(w));
  if (!kept.length) return [];
  const whole = findCommands(kept.join(" "), commands, limit);
  if (whole.length) return whole;
  const best = new Map<string, Found>();
  for (const w of kept)
    for (const f of findCommands(w, commands, limit)) {
      const known = best.get(f.command.title);
      if (!known || f.score > known.score) best.set(f.command.title, f);
    }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
