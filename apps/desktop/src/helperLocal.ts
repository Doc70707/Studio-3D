import { MM_PER_FOOT, MM_PER_INCH, fromDisplay } from "@studio3d/document";

/**
 * Blurry without Claude: simple requests to make something ("add a 20 mm cube", "a cylinder 12 wide and 40 tall",
 * "an M5 hole", "round the top edges 2 mm", "hollow it out with 2 mm walls") read on this computer and turned into
 * the same tool calls Claude makes, so they go through the same checks. Anything it doesn't understand returns
 * null, and Blurry answers from his how-tos instead of guessing.
 */
export interface LocalCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface LocalPlan {
  calls: LocalCall[];
  /** Sizes Blurry chose because the request didn't give them, to say so. */
  assumed: string[];
}

/** "how do I", "what is": a question for the how-tos, not an order. "can you add" is still an order. */
const QUESTION = /^(how|what|why|where|which|when|is|does|do)\b/i;

const UNIT = String.raw`(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|in(?:ch|ches)?\b|"|ft|feet|foot|')?`;
const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)(?:\s*(\d+)\/(\d+))?`;

/** A number with its unit (or the units shown), in millimetres. */
function toMm(whole: string, num: string | undefined, den: string | undefined, unit: string | undefined): number {
  let v = parseFloat(whole);
  if (num && den && +den > 0) v += +num / +den;
  const u = (unit ?? "").toLowerCase();
  if (u.startsWith("mm") || u.startsWith("milli")) return v;
  if (u.startsWith("cm") || u.startsWith("centi")) return v * 10;
  if (u.startsWith("in") || u === '"') return v * MM_PER_INCH;
  if (u === "ft" || u.startsWith("fe") || u.startsWith("fo") || u === "'") return v * MM_PER_FOOT;
  return fromDisplay(v);
}

/** Every length written in the text, in order, with where it ends (to read the word after it). */
function lengths(text: string): { mm: number; at: number; end: number }[] {
  const re = new RegExp(`${NUMBER}\\s*${UNIT}`, "gi");
  const out: { mm: number; at: number; end: number }[] = [];
  for (const m of text.matchAll(re)) {
    // "M5" and "M8x1" are thread names, not lengths.
    if (/m$/i.test(text.slice(0, m.index))) continue;
    out.push({ mm: toMm(m[1]!, m[2], m[3], m[4]), at: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** The length said next to a word: "40 tall", "height 40", "40 mm high". */
function lengthBy(text: string, words: RegExp): number | undefined {
  for (const l of lengths(text)) {
    const after = text.slice(l.end, l.end + 14);
    const before = text.slice(Math.max(0, l.at - 14), l.at);
    if (new RegExp(`^\\s*(${words.source})`, "i").test(after)) return l.mm;
    if (new RegExp(`(${words.source})\\s*(of|is|=|:)?\\s*$`, "i").test(before)) return l.mm;
  }
  return undefined;
}

const round = (mm: number) => Math.round(mm * 1e6) / 1e6;
const TALL = /tall|high|height|long|thick/;
const WIDE = /wide|across|diameter|dia\b|ø|thick/;

/** What a request asks to make, as tool calls, or null when it isn't one Blurry can read on his own. */
export function planLocal(message: string, part: { top: number | null; picked?: number }): LocalPlan | null {
  const text = message.trim().toLowerCase().replace(/×/g, "x");
  if (!text || QUESTION.test(text)) return null;
  const assumed: string[] = [];
  const all = lengths(text);

  // Holes first: "a 5 mm hole" is a hole, not a cylinder.
  const thread = /\b(m\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)?|\d+\/\d+-\d+\s*un[cf]|#\d+-\d+\s*un[cf])\b/i.exec(text);
  if (/\bhole\b/.test(text)) {
    const input: Record<string, unknown> = {};
    if (thread) input.thread = thread[1]!.toUpperCase().replace(/\s+/g, " ");
    const depth = lengthBy(text, /deep|depth/);
    // A threaded hole's size comes from its thread.
    const diameter = thread ? undefined : (lengthBy(text, /wide|across|diameter|dia\b|ø|hole/) ?? all[0]?.mm);
    if (diameter !== undefined && diameter !== depth) input.diameter = round(diameter);
    if (depth !== undefined && !/through/.test(text)) input.depth = round(depth);
    if (/through/.test(text)) input.depth = 0;
    if (/left[- ]hand/.test(text)) input.hand = "left";
    if (!thread && input.diameter === undefined) assumed.push("the usual hole size");
    return { calls: [{ tool: "add_hole", input }], assumed };
  }

  const finish = /\b(chamfer|bevel)/.test(text)
    ? "chamfer"
    : /\b(fillet|round(ed)?|smooth)\b/.test(text)
      ? "fillet"
      : null;
  if (finish && /\bedges?\b|\bcorners?\b|\bfillet|\bchamfer|\bbevel/.test(text)) {
    const one = /\b(one|an|this|that|single)\s+(edge|corner)\b/.test(text);
    // One edge needs it clicked first: with none picked, the how-to says how, rather than rounding them all.
    if (one && !part.picked) return null;
    const input: Record<string, unknown> = { finish };
    if (all[0]) input.size = round(all[0].mm);
    else assumed.push(`the usual ${finish} size`);
    if (one || /\bpicked\b|\bselected\b|\bthese\b/.test(text)) input.edges = "picked";
    else if (/\btop\b/.test(text)) input.edges = "top";
    else if (/\bbottom\b/.test(text)) input.edges = "bottom";
    else if (/\bupright\b|\bvertical\b|\bcorners\b/.test(text)) input.edges = "vertical";
    else if (/\ball\b|\bevery\b/.test(text)) input.edges = "all";
    return { calls: [{ tool: "round_edges", input }], assumed };
  }

  if (/\b(hollow|shell)\b/.test(text)) {
    const input: Record<string, unknown> = {};
    const wall = lengthBy(text, /walls?|thick/) ?? all[0]?.mm;
    if (wall !== undefined) input.wall = round(wall);
    else assumed.push("the usual wall");
    const open = /\b(closed|sealed)\b/.test(text)
      ? "none"
      : (/\bopen (?:at the |on the )?(top|bottom|front|back|left|right)\b/.exec(text)?.[1] ?? undefined);
    if (open) input.open = open;
    return { calls: [{ tool: "hollow_out", input }], assumed };
  }

  const shape = /\b(cube|box|block|cuboid|cylinder|rod|disc|disk|tube|pipe|cone|sphere|ball)\b/.exec(text)?.[1];
  if (!shape) return null;
  const mode = /\b(cut|subtract|carve)\b/.test(text) ? "cut" : "add";
  const sizes: Record<string, number> = {};
  if (shape === "cube" || shape === "box" || shape === "block" || shape === "cuboid") {
    const three = new RegExp(
      `${NUMBER}\\s*${UNIT}\\s*(?:x|by)\\s*${NUMBER}\\s*${UNIT}\\s*(?:x|by)\\s*${NUMBER}\\s*${UNIT}`,
      "i",
    ).exec(text);
    if (three) {
      const unit = three[12] ?? three[8] ?? three[4];
      sizes.width = toMm(three[1]!, three[2], three[3], three[4] ?? unit);
      sizes.depth = toMm(three[5]!, three[6], three[7], three[8] ?? unit);
      sizes.height = toMm(three[9]!, three[10], three[11], three[12] ?? unit);
    } else if (shape === "cube" && all[0]) {
      sizes.width = sizes.depth = sizes.height = all[0].mm;
    } else {
      const w = lengthBy(text, /wide|width/);
      const d = lengthBy(text, /deep|depth/);
      const h = lengthBy(text, TALL);
      if (w !== undefined) sizes.width = w;
      if (d !== undefined) sizes.depth = d;
      if (h !== undefined) sizes.height = h;
      if (w === undefined && d === undefined && h === undefined && all[0]) {
        sizes.width = sizes.depth = sizes.height = all[0].mm;
      }
    }
    if (!Object.keys(sizes).length) assumed.push("a 20 mm cube");
    return { calls: [shapeCall("box", sizes, mode, part.top)], assumed };
  }
  if (shape === "sphere" || shape === "ball") {
    const d = lengthBy(text, WIDE) ?? (lengthBy(text, /radius/) ?? NaN) * 2;
    if (Number.isFinite(d)) sizes.diameter = d;
    else if (all[0]) sizes.diameter = all[0].mm;
    else assumed.push("20 mm across");
    return { calls: [shapeCall("sphere", sizes, mode, part.top)], assumed };
  }
  if (shape === "tube" || shape === "pipe") {
    const outer = lengthBy(text, /outside|outer|wide|across|diameter/);
    const inner = lengthBy(text, /inside|inner|hole|bore/);
    const h = lengthBy(text, /tall|high|height|long/);
    if (outer !== undefined) sizes.outerDiameter = outer;
    if (inner !== undefined) sizes.innerDiameter = inner;
    if (h !== undefined) sizes.height = h;
    if (!Object.keys(sizes).length) assumed.push("the usual tube size");
    return { calls: [shapeCall("tube", sizes, mode, part.top)], assumed };
  }
  if (shape === "cone") {
    const d = lengthBy(text, WIDE);
    const h = lengthBy(text, /tall|high|height/);
    if (d !== undefined) sizes.bottomDiameter = d;
    if (h !== undefined) sizes.height = h;
    if (!Object.keys(sizes).length) assumed.push("the usual cone size");
    return { calls: [shapeCall("cone", sizes, mode, part.top)], assumed };
  }
  // A cylinder, rod or disc: its width and height, in either order of words.
  const radius = lengthBy(text, /radius/);
  const d = lengthBy(text, /wide|across|diameter|dia\b|ø/) ?? (radius !== undefined ? radius * 2 : undefined);
  const h = lengthBy(text, /tall|high|height|long|thick/);
  if (d !== undefined) sizes.diameter = d;
  if (h !== undefined) sizes.height = h;
  const loose = all.filter((l) => ![sizes.diameter, sizes.height, radius].includes(l.mm));
  if (sizes.diameter === undefined && loose[0]) sizes.diameter = loose.shift()!.mm;
  if (sizes.height === undefined && loose[0]) sizes.height = loose.shift()!.mm;
  if (!Object.keys(sizes).length) assumed.push("20 mm across and 20 mm tall");
  return { calls: [shapeCall("cylinder", sizes, mode, part.top)], assumed };
}

/**
 * A shape for the part. With a part already there, a new shape stands on its top and a cut goes down into it from
 * the top, so it shows, rather than hiding inside the part at the middle of the plate.
 */
function shapeCall(shape: string, sizes: Record<string, number>, mode: string, top: number | null): LocalCall {
  const rounded = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, round(v)]));
  const tall = sizes.height ?? sizes.diameter ?? 20;
  const at = top === null ? {} : { z: round(mode === "cut" ? top - Math.min(tall, top) : top) };
  return { tool: "add_shape", input: { shape, sizes: rounded, mode, ...at } };
}
