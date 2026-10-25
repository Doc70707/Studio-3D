// Blurry's offline answers: what he can say and do with no internet and no key. A question is matched to a how-to
// (the steps for a task, in the app's own words, each naming the real command that does it) and to the commands
// themselves, from the same list the command line uses, so he can only offer what the app really has.
import { commandsFor, type Command, type Found } from "./commands";

export interface HowTo {
  id: string;
  /** What it answers, as a question. */
  question: string;
  /** Words that point to it. */
  words: string[];
  /** The steps, short. */
  steps: string[];
  /** The command that starts it, by title, when there is one. */
  command?: string;
}

export const HOW_TOS: HowTo[] = [
  {
    id: "thread",
    question: "How do I thread a hole?",
    words: ["thread", "threaded", "tap", "screw", "bolt", "m3", "m4", "m5", "m6", "unc", "unf", "insert"],
    steps: [
      "Add a hole (Hole) and click on the part where it goes, or use one you already have.",
      "Right-click the hole's rim in the 3D view and pick Thread this hole, or use Thread this hole in Properties.",
      "Pick the size: it is suggested from the hole. Choose through or blind, and Snug, Normal or Loose for printing.",
      "Apply. One undo takes it back.",
    ],
    command: "Hole",
  },
  {
    id: "fillet-edge",
    question: "How do I round just one edge?",
    words: ["round", "fillet", "one edge", "single edge", "this edge", "edge", "chamfer", "bevel", "corner"],
    steps: [
      "Click the edge in the 3D view. Click more edges to round them too.",
      "Press Fillet (or Chamfer) on the bar that appears, or type FILLET in the command line.",
      "Type the radius. The edges you picked are the only ones rounded.",
    ],
    command: "Fillet",
  },
  {
    id: "units",
    question: "How do I work in inches?",
    words: ["inch", "inches", "imperial", "metric", "mm", "millimetres", "millimeters", "units", "fraction"],
    steps: [
      "Click in at the end of the status bar (or View > Sizes in inches).",
      "Every size is then shown and typed in inches. Fractions like 1/4 and 2 1/2 work, and so does 6 mm.",
      "View > Units… (or UNITS) picks inch fractions, feet, feet and inches, centimetres or metres, and the precision.",
      "The part itself never changes: switching back shows the same part in millimetres.",
    ],
    command: "Sizes in inches",
  },
  {
    id: "print",
    question: "How do I print it?",
    words: ["print", "printer", "slice", "slicer", "gcode", "g-code", "bambu", "prusa", "orca", "stl", "3mf"],
    steps: [
      "File > Prepare to print opens Print Studio. Pick your printer.",
      "The checks tell you if the part fits and is ready.",
      "Slice to see the layers and the time, then Export G-code, or Open in your slicer.",
    ],
    command: "Prepare to print",
  },
  {
    id: "measure",
    question: "How do I measure between two points?",
    words: ["measure", "distance", "how far", "how long", "ruler", "between", "gap"],
    steps: [
      "Press D (or View > Measure distance).",
      "Click two points on the part. Corners, middles and centres snap.",
      "The bar shows the distance, and how far apart they are left/right, front/back and up.",
    ],
    command: "Measure distance",
  },
  {
    id: "sketch",
    question: "How do I draw my own shape?",
    words: ["draw", "sketch", "outline", "profile", "custom shape", "own shape", "extrude", "rectangle", "circle"],
    steps: [
      "Sketch on the plate, or Sketch on a face and click a flat face.",
      "Draw with Rectangle, Circle, Outline or Polygon. Type sizes while drawing, Tab to the next box.",
      "Done makes it solid; set its height in Properties.",
    ],
    command: "Sketch on the plate",
  },
  {
    id: "hollow",
    question: "How do I make it hollow, like a box or a cup?",
    words: ["hollow", "shell", "container", "cup", "box with walls", "empty", "walls"],
    steps: ["Hollow out adds walls of a thickness you choose.", "Pick the open side, or none for a closed part."],
    command: "Hollow out",
  },
  {
    id: "move",
    question: "How do I move a piece?",
    words: ["move", "position", "place", "shift", "nudge", "drag"],
    steps: [
      "Click the piece to select it.",
      "Drag one of its arrows, or use the arrow keys (Shift for 10 mm), or type its place in Properties.",
    ],
  },
  {
    id: "undo",
    question: "I made a mistake. How do I go back?",
    words: ["mistake", "undo", "go back", "wrong", "oops", "revert"],
    steps: ["Ctrl+Z undoes, Ctrl+Y redoes. Every change is one step, including what I add for you."],
    command: "Undo",
  },
];

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The how-to a question is about, if one fits well enough. */
export function findHowTo(question: string): HowTo | null {
  const q = question.toLowerCase();
  const qs = new Set(words(question));
  let best: { h: HowTo; score: number } | null = null;
  for (const h of HOW_TOS) {
    let score = 0;
    for (const w of h.words) {
      if (w.includes(" ")) {
        if (q.includes(w)) score += 3;
      } else if (qs.has(w)) score += 2;
    }
    if (!best || score > best.score) best = { h, score };
  }
  return best && best.score >= 2 ? best.h : null;
}

/** "how do I", "can you", "where is": a question rather than an order. */
const ASKING = /^(how|where|what|why|can|could|is|does|do|which|help)\b/i;

export interface Answer {
  /** What Blurry says. */
  text: string;
  howTo: HowTo | null;
  /** Commands to offer as buttons, best first. */
  commands: Found[];
}

/** Blurry's reply to a message, from what the app has: a how-to, and the commands that fit. */
export function answer(message: string, commands: Command[]): Answer {
  const howTo = findHowTo(message);
  const found = commandsFor(message, commands);
  const asking = ASKING.test(message.trim());
  if (howTo) {
    const lead = howTo.command && found.every((f) => f.command.title !== howTo.command);
    const extra = lead ? commands.find((c) => c.title === howTo.command) : undefined;
    const offer = extra ? [{ command: extra, score: 100, matched: extra.title }, ...found] : found;
    return {
      text: howTo.question.replace(/^How do I /, "Here's how to ").replace(/\?$/, ":"),
      howTo,
      commands: offer.slice(0, 3),
    };
  }
  if (found.length)
    return {
      text: asking
        ? `That sounds like ${found[0]!.command.title}. It's in ${found[0]!.command.where.join(" and ")}.`
        : `I can do that with ${found[0]!.command.title}.`,
      howTo: null,
      commands: found,
    };
  return {
    text: "I don't know that one yet. Try a word for what you want to make or change, like hole, round the edges or inches.",
    howTo: null,
    commands: [],
  };
}
