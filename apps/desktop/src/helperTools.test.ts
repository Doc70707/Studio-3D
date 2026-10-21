import { describe, expect, it } from "vitest";
import { newDocument, newHole, newShape, type BoxFeature, type ProjectDocument } from "@studio3d/document";
import { HELPER_TOOLS, describeModel, planTool } from "./helperTools";

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

  it("describe the part as numbered steps with their settings", () => {
    expect(describeModel(empty())).toBe("The build plate is empty.");
    expect(describeModel(block())).toMatch(/^1\. Box 1 \(box\) \{.*"width":60/);
  });
});
