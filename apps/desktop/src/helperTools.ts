// What Blurry may do to the part when he is connected to Claude: a short list of tools, each one an ordinary step
// (or a change to one), checked exactly as a step typed into Properties or read from a saved file is checked, before
// it touches the part. A tool that would make a broken step is refused with the reason, and Claude is told it, so
// nothing half-done ever reaches the part. Every change is one undo step.
import type Anthropic from "@anthropic-ai/sdk";
import {
  EDGE_SETS,
  OPEN_SIDES,
  SHAPES,
  SPIN_PLANE,
  SPIN_SURFACE,
  THREADS,
  isCopyStep,
  isCopyable,
  isShape,
  moveFeature,
  newEdgeStep,
  newHole,
  newHollow,
  newId,
  newMirror,
  newPattern,
  newShape,
  newSketch,
  nextName,
  parseProject,
  serializeProject,
  validateDocument,
  type Feature,
  type Point2,
  type Profile,
  type ProjectDocument,
  type ShapeType,
  type SketchPlane,
  type Vec3,
} from "@studio3d/document";

/** What a tool asks to do, once checked: ready to apply to the project. */
export type HelperChange =
  | { kind: "add"; feature: Feature }
  | { kind: "update"; id: string; patch: Record<string, unknown> }
  | { kind: "remove"; id: string }
  | { kind: "command"; title: string };

export type ToolOutcome = { ok: true; change: HelperChange; said: string } | { ok: false; error: string };

const SHAPE_TYPES = Object.keys(SHAPES) as ShapeType[];
const MM = "All lengths are in millimetres.";

/** The tools, in a fixed order so the request's prefix stays the same from one question to the next. */
export const HELPER_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "add_shape",
    description:
      "Add a shape to the part as a new step. mode 'add' adds material, 'cut' removes it. x, y place the centre of " +
      "the shape's base from the centre of the build plate (x right, y back), z lifts its base off the plate. " +
      "Sizes by shape: box width (x), depth (y), height, wall (0 = solid, more = open-top container); cylinder " +
      "diameter, height; tube outerDiameter, innerDiameter, height; cone bottomDiameter, topDiameter (0 = a point), " +
      `height; sphere diameter (z is its lowest point). Sizes left out keep their defaults. ${MM}`,
    input_schema: {
      type: "object",
      properties: {
        shape: { type: "string", enum: SHAPE_TYPES },
        mode: { type: "string", enum: ["add", "cut"] },
        sizes: {
          type: "object",
          description: 'Size fields for this shape, in mm, e.g. {"width": 40, "depth": 20, "height": 10}.',
          additionalProperties: { type: "number" },
        },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
      },
      required: ["shape"],
    },
  },
  {
    name: "add_hole",
    description:
      "Drill a round hole straight down from the top of the part. x, y are its centre from the centre of the " +
      "build plate. depth 0 goes all the way through. Optional: thread (one of the sizes below) to " +
      "make it a threaded hole (the diameter then comes from the thread), fit (extra room in mm, default 0.3), " +
      "hand 'left' for a left-hand thread, threadDepth (thread only part way), simplified true (tap-drill hole, not " +
      `a modelled thread). Use this for new holes; to thread an existing hole, use change_step. ${MM} ` +
      `Thread sizes: ${Object.keys(THREADS).join(", ")}.`,
    input_schema: {
      type: "object",
      properties: {
        diameter: { type: "number" },
        depth: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
        thread: { type: "string" },
        fit: { type: "number" },
        hand: { type: "string", enum: ["left"] },
        threadDepth: { type: "number" },
        simplified: { type: "boolean" },
      },
    },
  },
  {
    name: "round_edges",
    description:
      "Round (fillet) or bevel (chamfer) edges of the part built so far. size is the fillet radius or how far the " +
      "chamfer cuts back. edges: all, vertical (upright edges), top, bottom (a small chamfer here stops elephant's " +
      `foot), or picked (the edges the person clicked in the 3D view; only when some are picked). ${MM}`,
    input_schema: {
      type: "object",
      properties: {
        finish: { type: "string", enum: ["fillet", "chamfer"] },
        size: { type: "number" },
        edges: { type: "string", enum: EDGE_SETS.map((e) => e.edges) },
      },
      required: ["finish"],
    },
  },
  {
    name: "hollow_out",
    description: `Hollow the part out, leaving walls this thick, open on one side (or none for a closed part). ${MM}`,
    input_schema: {
      type: "object",
      properties: {
        wall: { type: "number" },
        open: { type: "string", enum: OPEN_SIDES.map((s) => s.side) },
      },
    },
  },
  {
    name: "change_step",
    description:
      "Change settings of an existing step, named as in the step list (e.g. 'Box', 'Hole 1'). changes holds the " +
      'fields to set, using the field names shown in the step list, e.g. {"height": 30}, {"thread": "M5", ' +
      `"fit": 0.3}, {"mode": "cut"}. A field set to null is removed (e.g. {"thread": null} unthreads a hole). ${MM}`,
    input_schema: {
      type: "object",
      properties: {
        step: { type: "string" },
        changes: { type: "object" },
      },
      required: ["step", "changes"],
    },
  },
  {
    name: "remove_step",
    description: "Remove a step from the part, named as in the step list. Copies made from it go with it.",
    input_schema: {
      type: "object",
      properties: { step: { type: "string" } },
      required: ["step"],
    },
  },
  {
    name: "draw_outline",
    description:
      "Draw flat outlines and push them into a solid: for any shape the other tools don't make (an L bracket, a " +
      "phone stand's side, a hook, a star, a plate with a notch), or to cut a pocket or a slot. on picks the drawing " +
      "surface: 'level' is flat at height z (drawing x, y = plate x, y), pushed up by depth to add, or down from z " +
      "into the part to cut (depth 0 = all the way through); 'front' stands upright at y = offset facing the front " +
      "(drawing x = plate x, drawing up = height z), pushed towards the front (-y) by depth; 'side' stands upright " +
      "at x = offset facing right (drawing x = plate y, drawing up = height z), pushed right (+x) by depth. To " +
      "centre a front or side drawing, set offset to half the depth (front: offset = +depth/2). outlines: each is " +
      '{"points": [[x, y], ...]} (corners in order, at least 3, not crossing itself), {"circle": [x, y], ' +
      '"diameter": d} or {"rectangle": [x, y], "width": w, "height": h} (x, y = bottom-left corner). Outlines ' +
      "inside another make a hole in it. revolve: degrees (up to 360) to spin a 'front' drawing at offset 0 round " +
      "its up line (x = 0) like a lathe, for round parts (a vase, a knob, a bottle); its corners must have x >= 0. " +
      MM,
    input_schema: {
      type: "object",
      properties: {
        on: { type: "string", enum: ["level", "front", "side"] },
        z: { type: "number" },
        offset: { type: "number" },
        outlines: { type: "array", items: { type: "object" } },
        mode: { type: "string", enum: ["add", "cut"] },
        depth: { type: "number" },
        revolve: { type: "number" },
      },
      required: ["on", "outlines"],
    },
  },
  {
    name: "copy_step",
    description:
      "Make an independent copy of a shape, hole or drawing step, moved by dx, dy, dz (dz is ignored for holes). " +
      `The copy can then be changed on its own with change_step. ${MM}`,
    input_schema: {
      type: "object",
      properties: { step: { type: "string" }, dx: { type: "number" }, dy: { type: "number" }, dz: { type: "number" } },
      required: ["step"],
    },
  },
  {
    name: "pattern_step",
    description:
      "Repeat a shape, hole or drawing step. kind 'grid': count copies in a row along x, spacing apart, and rows " +
      "rows along y, rowSpacing apart (count and rows include the original). kind 'circle': count copies round " +
      "the point cx, cy, spread over angle degrees (360 = evenly all the way round). The copies follow the " +
      `original when it changes. ${MM}`,
    input_schema: {
      type: "object",
      properties: {
        step: { type: "string" },
        kind: { type: "string", enum: ["grid", "circle"] },
        count: { type: "number" },
        spacing: { type: "number" },
        rows: { type: "number" },
        rowSpacing: { type: "number" },
        angle: { type: "number" },
        cx: { type: "number" },
        cy: { type: "number" },
      },
      required: ["step"],
    },
  },
  {
    name: "mirror_step",
    description:
      "Add a mirror image of a shape, hole or drawing step across an upright line: axis 'x' mirrors left to right " +
      `across x = at, axis 'y' front to back across y = at. ${MM}`,
    input_schema: {
      type: "object",
      properties: { step: { type: "string" }, axis: { type: "string", enum: ["x", "y"] }, at: { type: "number" } },
      required: ["step"],
    },
  },
  {
    name: "run_command",
    description:
      "Run one of the app's own commands by its exact title from the command list (for example 'Sizes in inches', " +
      "'Prepare to print', 'Measure distance', 'Pattern in a grid', 'Undo'). Use the other tools for adding and " +
      "changing steps; use this for everything else the app can do.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
  },
];

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const findStep = (doc: ProjectDocument, step: unknown) =>
  typeof step === "string" ? doc.features.find((f) => f.name.toLowerCase() === step.trim().toLowerCase()) : undefined;

const stepNames = (doc: ProjectDocument) => doc.features.map((f) => f.name).join(", ") || "none yet";

/**
 * Checks a changed document as a saved file would be checked when opened (only known settings, of the right kinds)
 * and as the design is checked while editing (sizes that make sense). Returns why it can't be used, or nothing.
 */
function problem(next: ProjectDocument, id: string): string | null {
  const read = parseProject(serializeProject(next, { name: "Studio 3D", version: "check" }));
  if (!read.ok) return read.error.replace(/^This project file is damaged: /, "");
  const back = read.document.features.find((f) => f.id === id);
  const mine = next.features.find((f) => f.id === id);
  if (mine && back) {
    const unknown = Object.keys(mine).filter((k) => !(k in back));
    if (unknown.length) return `${mine.name} has no setting called ${unknown.join(", ")}.`;
  }
  const errors = validateDocument(next).filter((i) => i.severity === "error" && (!i.featureId || i.featureId === id));
  return errors.length ? errors.map((i) => i.message).join(" ") : null;
}

const checked = (change: HelperChange, id: string, next: ProjectDocument, said: string) => {
  const why = problem(next, id);
  return why ? ({ ok: false, error: why } as const) : ({ ok: true, change, said } as const);
};

/** Shapes go in before the first hole or hollow, as the Add buttons put them. */
export function withAdded(doc: ProjectDocument, f: Feature): ProjectDocument {
  if (!isShape(f)) return { ...doc, features: [...doc.features, f] };
  const first = doc.features.findIndex((g) => g.type === "hole" || g.type === "hollow");
  const at = first === -1 ? doc.features.length : first;
  return { ...doc, features: [...doc.features.slice(0, at), f, ...doc.features.slice(at)] };
}

const point = (v: unknown): Point2 | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))
    ? [v[0] as number, v[1] as number]
    : null;

/** One outline from a tool call, or what is wrong with it. */
function profileOf(o: unknown): Profile | string {
  const r = record(o);
  if (!r) return "each outline is an object.";
  if (Array.isArray(r.points)) {
    const points = r.points.map(point);
    if (points.some((p) => !p)) return "points are [x, y] pairs of numbers.";
    if (points.length < 3) return "an outline needs at least 3 corners.";
    return { kind: "polygon", points: points as Point2[] };
  }
  if (r.circle !== undefined) {
    const c = point(r.circle);
    const d = num(r.diameter);
    if (!c || d === undefined) return 'a circle is {"circle": [x, y], "diameter": d}.';
    return { kind: "circle", x: c[0], y: c[1], diameter: d };
  }
  if (r.rectangle !== undefined) {
    const c = point(r.rectangle);
    const [w, h] = [num(r.width), num(r.height)];
    if (!c || w === undefined || h === undefined)
      return 'a rectangle is {"rectangle": [x, y], "width": w, "height": h}.';
    return { kind: "rectangle", x: c[0], y: c[1], width: w, height: h };
  }
  return "give points, a circle or a rectangle.";
}

/** The x of every extreme point of a profile, to keep a spun drawing on one side of its axis. */
const profileXs = (p: Profile): number[] =>
  p.kind === "polygon" ? p.points.map((q) => q[0]) : p.kind === "circle" ? [p.x - p.diameter / 2] : [p.x];

/** The document after a checked change (not a command, which runs in the app). */
export function applyChange(doc: ProjectDocument, change: HelperChange): ProjectDocument {
  if (change.kind === "add") return withAdded(doc, change.feature);
  if (change.kind === "update") {
    const patch = change.patch;
    return {
      ...doc,
      features: doc.features.map((f) => {
        if (f.id !== change.id) return f;
        const next = { ...f } as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch))
          if (v === undefined) delete next[k];
          else next[k] = v;
        return next as unknown as Feature;
      }),
    };
  }
  if (change.kind === "remove")
    return {
      ...doc,
      features: doc.features.filter((f) => f.id !== change.id && !(isCopyStep(f) && f.source === change.id)),
    };
  return doc;
}

/**
 * Turns one tool call into a checked change, or the reason it can't be made. `picked` is the edges clicked in the
 * 3D view; `commands` the titles of the commands that can run right now.
 */
export function planTool(
  doc: ProjectDocument,
  name: string,
  input: unknown,
  context: { picked: Vec3[]; commands: string[] },
): ToolOutcome {
  const args = record(input) ?? {};
  const fail = (error: string) => ({ ok: false, error }) as const;

  if (name === "add_shape") {
    const type = args.shape as ShapeType;
    if (!SHAPE_TYPES.includes(type)) return fail(`shape must be one of ${SHAPE_TYPES.join(", ")}.`);
    const base = newShape(doc, type, { x: num(args.x) ?? 0, y: num(args.y) ?? 0, z: num(args.z) ?? 0 });
    const sizes = record(args.sizes) ?? {};
    const own = Object.keys(SHAPES[type].make()).filter((k) => !["type", "mode", "x", "y", "z"].includes(k));
    const wrong = Object.keys(sizes).filter((k) => !own.includes(k));
    if (wrong.length) return fail(`A ${type} has no size called ${wrong.join(", ")}. Its sizes are ${own.join(", ")}.`);
    const mode = args.mode === "cut" ? "cut" : "add";
    const feature = { ...base, ...sizes, mode } as Feature;
    if (mode === "cut" && !doc.features.length) return fail("The first shape can't be a cut: there's nothing to cut.");
    const said = `${mode === "cut" ? "Cut" : "Added"} ${feature.name}`;
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), said);
  }

  if (name === "add_hole") {
    const hole = newHole(doc, { x: num(args.x) ?? 0, y: num(args.y) ?? 0 });
    const feature: Feature = { ...hole };
    for (const k of ["diameter", "depth", "fit", "threadDepth"] as const)
      if (num(args[k]) !== undefined) Object.assign(feature, { [k]: args[k] });
    if (args.thread !== undefined) {
      const thread = String(args.thread).trim();
      const size = Object.keys(THREADS).find((t) => t.toLowerCase() === thread.toLowerCase());
      if (!size) return fail(`${thread} isn't a thread size the app knows. Sizes look like M3, M5, M8x1, 1/4-20 UNC.`);
      Object.assign(feature, { thread: size, fit: num(args.fit) ?? 0.3 });
    }
    if (args.hand === "left") Object.assign(feature, { hand: "left" });
    if (args.simplified === true) Object.assign(feature, { simplified: true });
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), `Added ${feature.name}`);
  }

  if (name === "round_edges") {
    const finish = args.finish === "chamfer" ? "chamfer" : "fillet";
    const edges = typeof args.edges === "string" ? args.edges : undefined;
    if (edges === "picked" && !context.picked.length) return fail("No edges are picked in the 3D view.");
    const usePicks = edges === "picked" || (edges === undefined && context.picked.length > 0);
    const step = newEdgeStep(doc, finish, usePicks ? context.picked : []);
    const feature = { ...step, ...(edges && edges !== "picked" ? { edges } : {}) } as Feature;
    if (num(args.size) !== undefined) Object.assign(feature, { size: args.size });
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), `Added ${feature.name}`);
  }

  if (name === "hollow_out") {
    const feature = { ...newHollow(doc) } as Feature;
    if (num(args.wall) !== undefined) Object.assign(feature, { wall: args.wall });
    if (typeof args.open === "string") Object.assign(feature, { open: args.open });
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), `Added ${feature.name}`);
  }

  if (name === "change_step") {
    const f = findStep(doc, args.step);
    if (!f) return fail(`There is no step called "${String(args.step)}". The steps are: ${stepNames(doc)}.`);
    const changes = record(args.changes);
    if (!changes || !Object.keys(changes).length) return fail("changes needs at least one setting to change.");
    if ("id" in changes || "type" in changes) return fail("A step's id and kind can't be changed; add a new step.");
    const patch: Record<string, unknown> = { ...changes };
    if (typeof patch.thread === "string") {
      const t = patch.thread.trim().toLowerCase();
      const size = Object.keys(THREADS).find((s) => s.toLowerCase() === t);
      if (!size) return fail(`${String(patch.thread)} isn't a thread size the app knows.`);
      patch.thread = size;
      if (f.type === "hole" || f.type === "cylinder") patch.fit ??= f.fit ?? 0.3;
    }
    const next: Feature = { ...f };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete (next as unknown as Record<string, unknown>)[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    const doc2 = { ...doc, features: doc.features.map((g) => (g.id === f.id ? next : g)) };
    const said = `Changed ${f.name}: ${Object.keys(patch).join(", ")}`;
    // A field set to null is cleared by setting it to undefined, which the edit then leaves out.
    const update = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]));
    return checked({ kind: "update", id: f.id, patch: update }, f.id, doc2, said);
  }

  if (name === "remove_step") {
    const f = findStep(doc, args.step);
    if (!f) return fail(`There is no step called "${String(args.step)}". The steps are: ${stepNames(doc)}.`);
    return { ok: true, change: { kind: "remove", id: f.id }, said: `Removed ${f.name}` };
  }

  if (name === "draw_outline") {
    const on = args.on;
    if (on !== "level" && on !== "front" && on !== "side") return fail("on must be level, front or side.");
    const raw = Array.isArray(args.outlines) ? args.outlines : [];
    if (!raw.length) return fail("outlines needs at least one outline.");
    const profiles: Profile[] = [];
    for (const [i, o] of raw.entries()) {
      const p = profileOf(o);
      if (typeof p === "string") return fail(`Outline ${i + 1}: ${p}`);
      profiles.push(p);
    }
    const mode = args.mode === "cut" ? "cut" : "add";
    if (mode === "cut" && !doc.features.length) return fail("There's nothing to cut yet: add something first.");
    const offset = num(args.offset) ?? 0;
    const revolve = num(args.revolve);
    let feature;
    if (revolve !== undefined) {
      if (on !== "front" || offset !== 0) return fail("Only a front drawing at offset 0 can be spun (revolve).");
      if (!(revolve > 0 && revolve <= 360)) return fail("revolve is in degrees, more than 0 and up to 360.");
      const left = profiles.some((p) => profileXs(p).some((x) => x < -1e-9));
      if (left) return fail("A spun drawing must stay right of its up line: every x must be 0 or more.");
      feature = { ...newSketch(doc, SPIN_PLANE, SPIN_SURFACE, profiles, mode, 10), revolve };
      feature.name = nextName(doc, "Revolve");
    } else {
      const plane: SketchPlane =
        on === "level"
          ? { origin: [0, 0, num(args.z) ?? 0], xDir: [1, 0, 0], normal: [0, 0, 1] }
          : on === "front"
            ? { origin: [0, offset, 0], xDir: [1, 0, 0], normal: [0, -1, 0] }
            : { origin: [offset, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] };
      const surface = on === "level" ? "level plane" : on === "front" ? "front plane" : "side plane";
      const depth = num(args.depth) ?? (mode === "cut" ? 0 : 5);
      feature = newSketch(doc, plane, surface, profiles, mode, depth);
    }
    const said = `${mode === "cut" ? "Cut" : "Added"} ${feature.name}`;
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), said);
  }

  if (name === "copy_step") {
    const f = findStep(doc, args.step);
    if (!f) return fail(`There is no step called "${String(args.step)}". The steps are: ${stepNames(doc)}.`);
    if (!isCopyable(f)) return fail(`${f.name} can't be copied: only shapes, holes and drawings can.`);
    const base =
      f.type === "hole" ? "Hole" : f.type === "sketch" ? (f.revolve ? "Revolve" : "Sketch") : SHAPES[f.type].label;
    const by: [number, number, number] = [num(args.dx) ?? 0, num(args.dy) ?? 0, num(args.dz) ?? 0];
    const feature = { ...moveFeature(f, by), id: newId(), name: nextName(doc, base) } as Feature;
    return checked(
      { kind: "add", feature },
      feature.id,
      withAdded(doc, feature),
      `Copied ${f.name} as ${feature.name}`,
    );
  }

  if (name === "pattern_step" || name === "mirror_step") {
    const f = findStep(doc, args.step);
    if (!f) return fail(`There is no step called "${String(args.step)}". The steps are: ${stepNames(doc)}.`);
    if (!isCopyable(f)) return fail(`${f.name} can't be repeated: only shapes, holes and drawings can.`);
    let feature: Feature;
    if (name === "mirror_step") {
      feature = { ...newMirror(doc, f.id, num(args.at) ?? 0), ...(args.axis === "y" ? { axis: "y" as const } : {}) };
    } else {
      const p = { ...newPattern(doc, f.id), ...(args.kind === "circle" ? { kind: "circle" as const } : {}) };
      for (const k of ["count", "spacing", "rows", "rowSpacing", "angle", "cx", "cy"] as const)
        if (num(args[k]) !== undefined) Object.assign(p, { [k]: args[k] });
      feature = p;
    }
    return checked({ kind: "add", feature }, feature.id, withAdded(doc, feature), `Added ${feature.name} of ${f.name}`);
  }

  if (name === "run_command") {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const found = context.commands.find((c) => c.toLowerCase() === title.toLowerCase());
    if (!found) return fail(`There is no command called "${title}" that can run now.`);
    return { ok: true, change: { kind: "command", title: found }, said: `Ran ${found}` };
  }

  return fail(`Unknown tool ${name}.`);
}

/** The part as a short list for Claude: each step's name, kind and settings, in millimetres. */
export function describeModel(doc: ProjectDocument): string {
  if (!doc.features.length) return "The build plate is empty.";
  return doc.features
    .map((f, i) => {
      const { id: _id, name, type, ...rest } = f as unknown as Record<string, unknown> & { name: string };
      // Long sketch outlines are lists of points: their count is enough to talk about them. Short ones are kept,
      // so Claude can redraw them with change_step.
      if (Array.isArray(rest.profiles) && JSON.stringify(rest.profiles).length > 600)
        rest.profiles = `${rest.profiles.length} outline(s)`;
      if (Array.isArray(rest.picked)) rest.picked = `${rest.picked.length} picked edge(s)`;
      return `${i + 1}. ${name} (${String(type)}) ${JSON.stringify(rest)}`;
    })
    .join("\n");
}
