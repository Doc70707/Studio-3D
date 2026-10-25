import { describe, expect, it } from "vitest";
import {
  SPIN_PLANE,
  newDocument,
  newHole,
  newShape,
  validateDocument,
  type BoxFeature,
  type ProjectDocument,
} from "@studio3d/document";
import { HELPER_TOOLS, applyChange, describeModel, planTool } from "./helperTools";

const empty = (): ProjectDocument => ({ ...newDocument(), features: [] });
const context = { picked: [], commands: ["Sizes in inches", "Prepare to print"] };
const block = (): ProjectDocument => {
  const d = empty();
  return { ...d, features: [{ ...(newShape(d, "box") as BoxFeature), width: 60, depth: 40, height: 30 }] };
};

describe("Blurry's tools", () => {
  it("are listed in a fixed order with schemas", () => {
    expect(HELPER_TOOLS.map((t) => t.name)).toEqual([
      "add_shape",
      "add_hole",
      "round_edges",
      "hollow_out",
      "change_step",
      "remove_step",
      "draw_outline",
      "copy_step",
      "pattern_step",
      "mirror_step",
      "run_command",
    ]);
    for (const t of HELPER_TOOLS) expect(t.input_schema.type).toBe("object");
  });

  it("add a shape with its sizes, and refuse sizes the shape doesn't have", () => {
    const r = planTool(empty(), "add_shape", { shape: "cylinder", sizes: { diameter: 12, height: 40 } }, context);
    expect(r.ok && r.change.kind === "add" && r.change.feature).toMatchObject({
      type: "cylinder",
      diameter: 12,
      height: 40,
      mode: "add",
    });
    const bad = planTool(empty(), "add_shape", { shape: "cylinder", sizes: { width: 3 } }, context);
    expect(!bad.ok && bad.error).toContain("no size called width");
  });

  it("refuse a step the design checks would reject, with the same reason", () => {
    const r = planTool(block(), "add_shape", { shape: "box", sizes: { width: -5 } }, context);
    expect(r.ok).toBe(false);
    expect(planTool(empty(), "add_hole", { diameter: 5 }, context).ok).toBe(false); // nothing to drill into
  });

  it("add a threaded hole by a size name in any case, with the usual fit", () => {
    const r = planTool(block(), "add_hole", { thread: "m5", depth: 10, x: 10 }, context);
    expect(r.ok && r.change.kind === "add" && r.change.feature).toMatchObject({
      type: "hole",
      thread: "M5",
      fit: 0.3,
      depth: 10,
      x: 10,
    });
    const bad = planTool(block(), "add_hole", { thread: "M7" }, context);
    expect(!bad.ok && bad.error).toContain("isn't a thread size");
  });

  it("change a step by its name, unthread with null, and say which steps exist when the name is wrong", () => {
    const d = block();
    const withHole = { ...d, features: [...d.features, { ...newHole(d), thread: "M5" as const, fit: 0.3 }] };
    const r = planTool(withHole, "change_step", { step: "box 1", changes: { height: 50 } }, context);
    expect(r.ok && r.change).toEqual({ kind: "update", id: d.features[0]!.id, patch: { height: 50 } });
    const off = planTool(withHole, "change_step", { step: "Hole 1", changes: { thread: null } }, context);
    expect(off.ok && off.change.kind === "update" && off.change.patch).toEqual({ thread: undefined });
    const none = planTool(withHole, "change_step", { step: "Lid", changes: { height: 5 } }, context);
    expect(!none.ok && none.error).toContain("The steps are: Box 1, Hole 1");
    const unknown = planTool(withHole, "change_step", { step: "Box 1", changes: { colour: "red" } }, context);
    expect(!unknown.ok && unknown.error).toContain("no setting called colour");
  });

  it("round picked edges when some are picked, and refuse picked edges when none are", () => {
    const picked = { ...context, picked: [[30, 0, 30] as [number, number, number]] };
    const r = planTool(block(), "round_edges", { finish: "fillet", size: 2 }, picked);
    expect(r.ok && r.change.kind === "add" && r.change.feature).toMatchObject({ edges: "picked", size: 2 });
    expect(planTool(block(), "round_edges", { finish: "chamfer", edges: "picked" }, context).ok).toBe(false);
  });

  it("run only commands that exist right now", () => {
    expect(planTool(block(), "run_command", { title: "sizes in inches" }, context)).toEqual({
      ok: true,
      change: { kind: "command", title: "Sizes in inches" },
      said: "Ran Sizes in inches",
    });
    expect(planTool(block(), "run_command", { title: "Format disk" }, context).ok).toBe(false);
  });

  it("draw outlines on the level, front and side planes, with the depth a cut or an add usually has", () => {
    const L = {
      points: [
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 30],
        [0, 30],
      ],
    };
    const front = planTool(empty(), "draw_outline", { on: "front", offset: 10, outlines: [L], depth: 20 }, context);
    expect(front.ok && front.change.kind === "add" && front.change.feature).toMatchObject({
      type: "sketch",
      mode: "add",
      depth: 20,
      plane: { origin: [0, 10, 0], xDir: [1, 0, 0], normal: [0, -1, 0] },
    });
    const side = planTool(empty(), "draw_outline", { on: "side", offset: -3, outlines: [L] }, context);
    expect(side.ok && side.change.kind === "add" && side.change.feature).toMatchObject({
      depth: 5,
      plane: { origin: [-3, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] },
    });
    const slot = { rectangle: [-10, -2], width: 20, height: 4 };
    const cut = planTool(block(), "draw_outline", { on: "level", z: 30, outlines: [slot], mode: "cut" }, context);
    expect(cut.ok && cut.change.kind === "add" && cut.change.feature).toMatchObject({
      mode: "cut",
      depth: 0, // all the way through
      plane: { origin: [0, 0, 30], normal: [0, 0, 1] },
      profiles: [{ kind: "rectangle", x: -10, y: -2, width: 20, height: 4 }],
    });
    expect(cut.ok && cut.said).toMatch(/^Cut Sketch/);
  });

  it("refuse outlines that aren't outlines, and a cut with nothing to cut", () => {
    const two = planTool(
      empty(),
      "draw_outline",
      {
        on: "level",
        outlines: [
          {
            points: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
      },
      context,
    );
    expect(!two.ok && two.error).toBe("Outline 1: an outline needs at least 3 corners.");
    const odd = planTool(empty(), "draw_outline", { on: "level", outlines: [{ star: 5 }] }, context);
    expect(!odd.ok && odd.error).toContain("give points, a circle or a rectangle");
    const nowhere = planTool(
      empty(),
      "draw_outline",
      { on: "roof", outlines: [{ circle: [0, 0], diameter: 5 }] },
      context,
    );
    expect(nowhere.ok).toBe(false);
    const cut = planTool(
      empty(),
      "draw_outline",
      { on: "level", outlines: [{ circle: [0, 0], diameter: 5 }], mode: "cut" },
      context,
    );
    expect(!cut.ok && cut.error).toContain("nothing to cut");
    // A circle with no size is caught by the same checks as a sketch drawn by hand.
    const flat = planTool(
      empty(),
      "draw_outline",
      { on: "level", outlines: [{ circle: [0, 0], diameter: 0 }] },
      context,
    );
    expect(flat.ok).toBe(false);
  });

  it("spin a front drawing into a round part, only from the up line outwards", () => {
    const vase = {
      points: [
        [0, 0],
        [20, 0],
        [25, 40],
        [18, 60],
        [0, 60],
      ],
    };
    const r = planTool(empty(), "draw_outline", { on: "front", outlines: [vase], revolve: 360 }, context);
    expect(r.ok && r.change.kind === "add" && r.change.feature).toMatchObject({
      name: "Revolve 1",
      revolve: 360,
      plane: SPIN_PLANE,
    });
    const across = {
      points: [
        [-5, 0],
        [20, 0],
        [20, 10],
      ],
    };
    const left = planTool(empty(), "draw_outline", { on: "front", outlines: [across], revolve: 180 }, context);
    expect(!left.ok && left.error).toContain("every x must be 0 or more");
    const level = planTool(empty(), "draw_outline", { on: "level", outlines: [vase], revolve: 90 }, context);
    expect(!level.ok && level.error).toContain("Only a front drawing");
  });

  it("copy a step as a new, independent step moved by the given distance", () => {
    const d = block();
    const r = planTool(d, "copy_step", { step: "Box 1", dx: 70 }, context);
    expect(r.ok && r.change.kind === "add" && r.change.feature).toMatchObject({
      type: "box",
      name: "Box 2",
      x: 70,
      width: 60,
    });
    expect(r.ok && r.change.kind === "add" && r.change.feature.id).not.toBe(d.features[0]!.id);
    const withHollow = planTool(d, "hollow_out", { wall: 2 }, context);
    const h = withHollow.ok ? applyChange(d, withHollow.change) : d;
    expect(planTool(h, "copy_step", { step: "Hollow 1" }, context).ok).toBe(false);
  });

  it("repeat a step in a grid or round a circle, and mirror it across a line", () => {
    const d = block();
    const hole = { ...newHole(d), diameter: 4 };
    const holed = { ...d, features: [...d.features, hole] };
    const grid = planTool(
      holed,
      "pattern_step",
      { step: "Hole 1", count: 3, spacing: 12, rows: 2, rowSpacing: 10 },
      context,
    );
    expect(grid.ok && grid.change.kind === "add" && grid.change.feature).toMatchObject({
      type: "pattern",
      source: hole.id,
      count: 3,
      spacing: 12,
      rows: 2,
      rowSpacing: 10,
    });
    const ring = planTool(holed, "pattern_step", { step: "Hole 1", kind: "circle", count: 6, angle: 360 }, context);
    expect(ring.ok && ring.change.kind === "add" && ring.change.feature).toMatchObject({ kind: "circle", count: 6 });
    const mirror = planTool(holed, "mirror_step", { step: "Hole 1", axis: "y", at: 5 }, context);
    expect(mirror.ok && mirror.change.kind === "add" && mirror.change.feature).toMatchObject({
      type: "mirror",
      source: hole.id,
      axis: "y",
      at: 5,
    });
    const tooMany = planTool(holed, "pattern_step", { step: "Hole 1", count: 0 }, context);
    expect(tooMany.ok).toBe(false);
  });

  it("apply changes as a typed edit would: shapes before holes, cleared settings, copies removed with their step", () => {
    const d = block();
    const hole = { ...newHole(d), thread: "M5" as const, fit: 0.3 };
    const holed = { ...d, features: [...d.features, hole] };
    const add = planTool(holed, "add_shape", { shape: "cylinder", sizes: { diameter: 10, height: 5 }, z: 30 }, context);
    const added = add.ok ? applyChange(holed, add.change) : holed;
    expect(added.features.map((f) => f.type)).toEqual(["box", "cylinder", "hole"]);
    expect(validateDocument(added).filter((i) => i.severity === "error")).toEqual([]);
    const off = planTool(holed, "change_step", { step: "Hole 1", changes: { thread: null } }, context);
    const unthreaded = off.ok ? applyChange(holed, off.change) : holed;
    expect("thread" in unthreaded.features[1]!).toBe(false);
    const grid = planTool(holed, "pattern_step", { step: "Hole 1", count: 2 }, context);
    const patterned = grid.ok ? applyChange(holed, grid.change) : holed;
    expect(patterned.features).toHaveLength(3);
    const gone = applyChange(patterned, { kind: "remove", id: hole.id });
    expect(gone.features.map((f) => f.type)).toEqual(["box"]);
    expect(applyChange(holed, { kind: "command", title: "Undo" })).toBe(holed);
  });

  it("describe the part as numbered steps with their settings", () => {
    expect(describeModel(empty())).toBe("The build plate is empty.");
    expect(describeModel(block())).toMatch(/^1\. Box 1 \(box\) \{.*"width":60/);
  });
});
