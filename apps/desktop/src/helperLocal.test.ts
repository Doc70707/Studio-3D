import { afterEach, describe, expect, it } from "vitest";
import { newDocument, setLengthFormat, validateDocument, type ProjectDocument } from "@studio3d/document";
import { planLocal } from "./helperLocal";
import { applyChange, planTool } from "./helperTools";

const flat: { top: number | null; picked?: number } = { top: null };
const call = (text: string, part = flat) => planLocal(text, part)?.calls[0];

afterEach(() => setLengthFormat("mm"));

describe("Blurry making things without Claude", () => {
  it("leaves questions to the how-tos", () => {
    expect(planLocal("how do I add a hole?", flat)).toBeNull();
    expect(planLocal("what is a fillet", flat)).toBeNull();
    expect(planLocal("work in inches", flat)).toBeNull();
    expect(planLocal("", flat)).toBeNull();
  });

  it("reads boxes and cubes in the sizes people write them", () => {
    expect(call("add a 20 mm cube")).toEqual({
      tool: "add_shape",
      input: { shape: "box", sizes: { width: 20, depth: 20, height: 20 }, mode: "add" },
    });
    expect(call("make a box 60 x 40 x 30 mm")?.input.sizes).toEqual({ width: 60, depth: 40, height: 30 });
    expect(call("a block 60 by 40 by 30")?.input.sizes).toEqual({ width: 60, depth: 40, height: 30 });
    expect(call("box 50 wide, 20 deep and 10 tall")?.input.sizes).toEqual({ width: 50, depth: 20, height: 10 });
    expect(call("can you add a 2 in cube?")?.input.sizes).toEqual({ width: 50.8, depth: 50.8, height: 50.8 });
    expect(call("cut a 10 mm cube")?.input.mode).toBe("cut");
  });

  it("reads cylinders by diameter or radius and height, in either order", () => {
    expect(call("add a cylinder 12 wide and 40 tall")?.input.sizes).toEqual({ diameter: 12, height: 40 });
    expect(call("cylinder height 40, diameter 12")?.input.sizes).toEqual({ diameter: 12, height: 40 });
    expect(call("a rod with radius 3 mm, 50 long")?.input.sizes).toEqual({ diameter: 6, height: 50 });
    expect(call("a 30 mm disc 3 mm thick")?.input).toMatchObject({ shape: "cylinder" });
    expect(call("add a sphere 25 across")?.input.sizes).toEqual({ diameter: 25 });
  });

  it("stands a new shape on the part's top, and cuts down into it from the top, so it shows", () => {
    expect(call("a cylinder 10 wide 5 tall", { top: 30 })?.input).toMatchObject({ z: 30 });
    expect(call("cut a 10 mm cube", { top: 30 })?.input).toMatchObject({ z: 20, mode: "cut" });
    expect(call("cut a 50 mm cube", { top: 30 })?.input).toMatchObject({ z: 0 });
    expect(call("a cylinder 10 wide 5 tall")?.input).not.toHaveProperty("z");
  });

  it("rounds one edge only once it is picked", () => {
    expect(planLocal("round just one edge", flat)).toBeNull();
    expect(planLocal("round this edge 2 mm", { top: 30, picked: 1 })?.calls[0]?.input).toEqual({
      finish: "fillet",
      size: 2,
      edges: "picked",
    });
  });

  it("uses the units shown when none is written", () => {
    setLengthFormat("in");
    expect(call("add a 1 cube")?.input.sizes).toEqual({ width: 25.4, depth: 25.4, height: 25.4 });
    expect(call("a 10 mm cube")?.input.sizes).toEqual({ width: 10, depth: 10, height: 10 });
    expect(call("a 1 1/2 inch cube")?.input.sizes).toMatchObject({ width: 38.1 });
  });

  it("reads holes: plain, threaded, deep or through", () => {
    expect(call("add a 5 mm hole")).toEqual({ tool: "add_hole", input: { diameter: 5 } });
    expect(call("an M5 hole 10 deep")).toEqual({ tool: "add_hole", input: { thread: "M5", depth: 10 } });
    expect(call("drill an m8x1 hole all the way through")?.input).toEqual({ thread: "M8X1", depth: 0 });
    expect(call("a 1/4-20 unc hole")?.input).toMatchObject({ thread: "1/4-20 UNC" });
  });

  it("reads rounded and bevelled edges, and which edges", () => {
    expect(call("round the top edges 2 mm")).toEqual({
      tool: "round_edges",
      input: { finish: "fillet", size: 2, edges: "top" },
    });
    expect(call("chamfer the bottom edges 0.6")?.input).toEqual({ finish: "chamfer", size: 0.6, edges: "bottom" });
    expect(call("fillet the picked edges 1")?.input).toMatchObject({ edges: "picked" });
    expect(planLocal("round the corners", flat)?.assumed).toEqual(["the usual fillet size"]);
  });

  it("reads hollowing with its wall and open side", () => {
    expect(call("hollow it out with 2 mm walls")).toEqual({ tool: "hollow_out", input: { wall: 2 } });
    expect(call("shell it 1.5 thick, open at the bottom")?.input).toEqual({ wall: 1.5, open: "bottom" });
    expect(call("hollow it but keep it closed")?.input).toEqual({ open: "none" });
  });

  it("says which sizes it chose when none were given", () => {
    expect(planLocal("add a cylinder", flat)?.assumed).toEqual(["20 mm across and 20 mm tall"]);
    expect(planLocal("add a box", flat)?.assumed).toEqual(["a 20 mm cube"]);
  });

  it("makes steps the design checks accept, through Claude's own tools", () => {
    let doc: ProjectDocument = newDocument();
    for (const text of ["add a cylinder 12 wide and 10 tall", "an M3 hole 5 deep", "round the top edges 0.5"]) {
      const c = call(text, { top: 20 })!;
      const r = planTool(doc, c.tool, c.input, { picked: [], commands: [] });
      expect(r.ok, text).toBe(true);
      if (r.ok) doc = applyChange(doc, r.change);
    }
    expect(doc.features.map((f) => f.type)).toEqual(["box", "cylinder", "hole", "fillet"]);
    expect(validateDocument(doc).filter((i) => i.severity === "error")).toEqual([]);
  });
});
