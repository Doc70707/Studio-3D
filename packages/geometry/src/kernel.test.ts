// Real-geometry tests: the actual OCCT WebAssembly kernel, no mocks.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import {
  newShape,
  shapeSize,
  shapeVolume,
  type ShapeFeature,
  DEFAULT_BOX,
  newDocument,
  parseProject,
  serializeProject,
  type BoxFeature,
  type HoleFeature,
  type ProjectDocument,
} from "@studio3d/document";
import { buildBox, buildDocument, expectedBoxVolume, exportStl, makeShape, maxHoleVolume, tessellate, useKernel } from "./kernel";
import { checkBinaryStl } from "./stl-check";

const require = createRequire(import.meta.url);
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const box = (over: Partial<BoxFeature> = {}): BoxFeature => ({ id: "b1", ...DEFAULT_BOX, ...over });

beforeAll(async () => {
  const oc = await opencascade({
    locateFile: () => require.resolve("replicad-opencascadejs/wasm"),
    print: () => {},
    printErr: () => {},
  });
  useKernel(oc);
}, 60_000);

const built = (b: BoxFeature) => {
  const r = buildBox(b);
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join("; "));
  return r;
};

describe("box geometry", () => {
  it("solid block has the exact volume and size", () => {
    const r = built(box({ width: 60, depth: 40, height: 30, wall: 0 }));
    expect(r.measurements.volume).toBeCloseTo(72000, 6);
    expect(r.measurements.size).toEqual([60, 40, 30]);
    expect(r.measurements.min[2]).toBeCloseTo(0, 9); // sits on the plate
  });

  it("open-top container matches the hand calculation", () => {
    const r = built(box({ width: 60, depth: 40, height: 30, wall: 2 }));
    // 60*40*30 - 56*36*28
    expect(r.measurements.volume).toBeCloseTo(15552, 6);
  });

  it.each([
    [10, 10, 10, 1],
    [120, 80, 45, 1.2],
    [1, 1, 1, 0],
    [1000, 1000, 1000, 5],
    [33.3, 12.7, 8.4, 0.8],
  ])("changing dimensions rebuilds exactly: %s × %s × %s, wall %s", (width, depth, height, wall) => {
    const b = box({ width, depth, height, wall });
    const r = built(b);
    expect(Math.abs(r.measurements.volume - expectedBoxVolume(b)) / expectedBoxVolume(b)).toBeLessThan(1e-9);
    expect(r.measurements.size[0]).toBeCloseTo(width, 9);
    expect(r.measurements.size[1]).toBeCloseTo(depth, 9);
    expect(r.measurements.size[2]).toBeCloseTo(height, 9);
  });

  it("invalid walls are refused before reaching the kernel (which would silently return a solid block)", () => {
    const r = buildBox(box({ width: 80, depth: 40, wall: 50 }));
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toContain("fill the whole box");
  });

  it("produces a display mesh with matching buffers", () => {
    const m = tessellate(built(box()).shape);
    expect(m.positions.length % 3).toBe(0);
    expect(m.normals.length).toBe(m.positions.length);
    expect(m.indices.length % 3).toBe(0);
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
    expect(m.edges.length).toBeGreaterThan(0);
  });
});

describe("save, reopen, rebuild", () => {
  it("a reopened project rebuilds to identical geometry", () => {
    const doc = newDocument();
    doc.features[0] = { ...(doc.features[0] as BoxFeature), width: 73.5, depth: 41.25, height: 19, wall: 1.6 };
    const before = buildDocument(doc);
    const reopened = parseProject(serializeProject(doc, { name: "Studio 3D", version: "test" }));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok || !before.ok) return;
    const after = buildDocument(reopened.document);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.measurements).toEqual(before.measurements);
  });
});

describe("STL export", () => {
  it.each([
    ["container", box({ width: 80, depth: 40, height: 30, wall: 2 })],
    ["solid", box({ width: 25, depth: 25, height: 10, wall: 0 })],
  ])("%s exports a watertight STL with exact size and near-exact volume", async (name, b) => {
    const stl = await exportStl(built(b).shape);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}${name}.stl`, Buffer.from(stl));
    writeFileSync(
      `${OUT}${name}.expected.json`,
      JSON.stringify({ volume: expectedBoxVolume(b), size: [b.width, b.depth, b.height] }),
    );

    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(report.consistentWinding).toBe(true);
    expect(report.max[0] - report.min[0]).toBeCloseTo(b.width, 4);
    expect(report.max[1] - report.min[1]).toBeCloseTo(b.depth, 4);
    expect(report.max[2] - report.min[2]).toBeCloseTo(b.height, 4);
    expect(Math.abs(report.volume - expectedBoxVolume(b)) / expectedBoxVolume(b)).toBeLessThan(0.005);
  });
});

const hole = (over: Partial<HoleFeature> = {}): HoleFeature => ({
  id: `h${Math.random()}`,
  type: "hole",
  name: "Hole 1",
  x: 0,
  y: 0,
  diameter: 10,
  depth: 0,
  ...over,
});
const design = (b: BoxFeature, ...holes: HoleFeature[]): ProjectDocument => ({ units: "mm", features: [b, ...holes] });
const designed = (doc: ProjectDocument) => {
  const r = buildDocument(doc);
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join("; "));
  return r;
};
const cyl = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h;
const rel = (a: number, b: number) => Math.abs(a - b) / b;

describe("holes", () => {
  it("a through hole in a solid block removes exactly one cylinder", () => {
    const r = designed(design(box({ wall: 0 }), hole({ diameter: 10, depth: 0 })));
    expect(rel(r.measurements.volume, 72000 - cyl(10, 30))).toBeLessThan(1e-9);
    expect(r.measurements.size).toEqual([60, 40, 30]);
    expect(r.issues).toEqual([]);
  });

  it("a blind hole stops at its depth", () => {
    const r = designed(design(box({ wall: 0 }), hole({ diameter: 6, depth: 12 })));
    expect(rel(r.measurements.volume, 72000 - cyl(6, 12))).toBeLessThan(1e-9);
  });

  it("a through hole in a container cuts only the floor", () => {
    const r = designed(design(box({ wall: 2 }), hole({ diameter: 5 })));
    expect(rel(r.measurements.volume, 15552 - cyl(5, 2))).toBeLessThan(1e-9);
  });

  it("a hole off-centre and several holes each remove their own cylinder", () => {
    const holes = [
      hole({ x: -22, y: -12, diameter: 4 }),
      hole({ x: 22, y: -12, diameter: 4 }),
      hole({ x: 0, y: 10, diameter: 8, depth: 20 }),
    ];
    const r = designed(design(box({ wall: 0 }), ...holes));
    expect(rel(r.measurements.volume, 72000 - 2 * cyl(4, 30) - cyl(8, 20))).toBeLessThan(1e-9);
  });

  it("a hole drilled into a side wall of a container cuts through the wall", () => {
    // 60 × 40 × 30, walls 2: a 3 mm hole 1.6 mm in from the left edge (x = -28.4) only cuts wall material.
    const b = box({ wall: 2 });
    const h = hole({ x: -28.4, y: 0, diameter: 3, depth: 10 });
    const r = designed(design(b, h));
    expect(r.measurements.volume).toBeLessThan(15552);
    expect(15552 - r.measurements.volume).toBeLessThanOrEqual(maxHoleVolume(h, b.height) * (1 + 1e-9));
    expect(r.issues.some((i) => i.severity === "warning")).toBe(true); // only 0.1 mm left at the edge
  });

  it("a hole that only goes into the empty inside is built, with a plain warning", () => {
    const r = designed(design(box({ wall: 2 }), hole({ depth: 5 })));
    expect(r.measurements.volume).toBeCloseTo(15552, 6);
    expect(r.issues[0]?.message).toContain("doesn't cut anything");
  });

  it("holes that run off the edge, are too deep or too small are refused", () => {
    for (const [h, text] of [
      [hole({ x: -28, diameter: 10 }), "runs off the left edge"],
      [hole({ y: 19, diameter: 4 }), "runs off the back edge"],
      [hole({ depth: 31 }), "only 30 mm tall"],
      [hole({ diameter: 0.2 }), "at least 0.5 mm"],
      [hole({ depth: -1 }), "can't be negative"],
    ] as const) {
      const r = buildDocument(design(box(), h));
      expect(r.ok).toBe(false);
      expect(r.issues.map((i) => i.message).join(" ")).toContain(text);
      expect(r.issues[0]?.featureId).toBe(h.id);
    }
  });

  it("an invalid box is reported before any hole", () => {
    const r = buildDocument(design(box({ wall: 25 }), hole()));
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toContain("fill the whole box");
  });

  it("a design with holes survives save and reopen", () => {
    const doc = design(box({ wall: 0 }), hole({ diameter: 7.5, x: -17.75 }), hole({ depth: 9 }));
    const reopened = parseProject(serializeProject(doc, { name: "Studio 3D", version: "test" }));
    if (!reopened.ok) throw new Error(reopened.error);
    expect(reopened.document).toEqual(doc);
    expect(designed(reopened.document).measurements).toEqual(designed(doc).measurements);
  });

  it("exports a watertight STL with the holes in it", async () => {
    const b = box({ width: 50, depth: 30, height: 20, wall: 0 });
    const doc = design(b, hole({ x: -15, y: 0, diameter: 6 }), hole({ x: 10, y: 0, diameter: 10, depth: 8 }));
    const stl = await exportStl(designed(doc).shape);
    const expected = 30000 - cyl(6, 20) - cyl(10, 8);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}holes.stl`, Buffer.from(stl));
    writeFileSync(`${OUT}holes.expected.json`, JSON.stringify({ volume: expected, size: [50, 30, 20] }));
    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(report.consistentWinding).toBe(true);
    expect(report.max[0] - report.min[0]).toBeCloseTo(50, 4);
    expect(rel(report.volume, expected)).toBeLessThan(0.005);
  });
});

const shape = (type: "box" | "cylinder" | "tube" | "cone" | "sphere", over: Partial<Record<string, unknown>> = {}) =>
  ({ ...newShape(newDocument(), type), ...over }) as ShapeFeature;
const part = (...shapes: ShapeFeature[]): ProjectDocument => ({ units: "mm", features: shapes });

describe("shapes", () => {
  it.each([
    ["cylinder", shape("cylinder", { diameter: 12, height: 7, x: 5, y: -3, z: 2 })],
    ["tube", shape("tube", { outerDiameter: 30, innerDiameter: 22.5, height: 9 })],
    ["cone", shape("cone", { bottomDiameter: 20, topDiameter: 8, height: 15 })],
    ["pointed cone", shape("cone", { bottomDiameter: 20, topDiameter: 0, height: 15 })],
    ["upside-down cone", shape("cone", { bottomDiameter: 4, topDiameter: 18, height: 10 })],
    ["sphere", shape("sphere", { diameter: 17, z: 3 })],
    ["moved box", shape("box", { width: 10, depth: 12, height: 4, x: -40, y: 25, z: 6 })],
  ])("%s has the exact volume, size and position", (_, s) => {
    const r = designed(part(s));
    expect(rel(r.measurements.volume, shapeVolume(s))).toBeLessThan(1e-9);
    const want = shapeSize(s);
    r.measurements.size.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
    expect(r.measurements.min[2]).toBeCloseTo(s.z, 6); // the base sits at its lift height
    expect((r.measurements.min[0] + r.measurements.max[0]) / 2).toBeCloseTo(s.x, 6);
    expect((r.measurements.min[1] + r.measurements.max[1]) / 2).toBeCloseTo(s.y, 6);
  });

  it("adding overlapping shapes counts the shared material once", () => {
    // Two 20 mm cubes overlapping by 5 mm: 8000 + 8000 - 20·20·5
    const a = shape("box", { width: 20, depth: 20, height: 20 });
    const b = shape("box", { width: 20, depth: 20, height: 20, x: 15 });
    const r = designed(part(a, b));
    expect(rel(r.measurements.volume, 16000 - 2000)).toBeLessThan(1e-9);
    expect(r.measurements.size).toEqual([35, 20, 20]);
    expect(r.issues).toEqual([]);
  });

  it("a cylinder standing on a block makes one piece", () => {
    const base = shape("box", { width: 40, depth: 40, height: 5 });
    const post = shape("cylinder", { diameter: 10, height: 20, z: 5 });
    const r = designed(part(base, post));
    expect(rel(r.measurements.volume, 8000 + cyl(10, 20))).toBeLessThan(1e-9);
    expect(r.issues).toEqual([]);
  });

  it("a cut shape removes exactly its overlap", () => {
    // A 10 mm cylinder cut fully through a 30 mm-tall block
    const block = shape("box", { width: 40, depth: 40, height: 30 });
    const cutter = shape("cylinder", { diameter: 10, height: 40, z: 0, mode: "cut" });
    const r = designed(part(block, cutter));
    expect(rel(r.measurements.volume, 48000 - cyl(10, 30))).toBeLessThan(1e-9);
  });

  it("a sphere cut into a block makes a round dish", () => {
    // Sphere of diameter 20 with its centre on the top face (z = 10): removes half a ball.
    const block = shape("box", { width: 40, depth: 40, height: 10 });
    const ball = shape("sphere", { diameter: 20, z: 0, mode: "cut" });
    const r = designed(part(block, ball));
    expect(rel(r.measurements.volume, 16000 - ((4 / 3) * Math.PI * 1000) / 2)).toBeLessThan(1e-9);
  });

  it("shapes that don't touch are built, with a warning that they print separately", () => {
    const r = designed(part(shape("box"), shape("cylinder", { x: 60 })));
    expect(r.issues.map((i) => i.message).join()).toContain("separate piece");
  });

  it("a cut that misses the part gets a warning and changes nothing", () => {
    const r = designed(part(shape("box"), shape("cylinder", { x: 80, mode: "cut" })));
    expect(r.measurements.volume).toBeCloseTo(8000, 6);
    expect(r.issues[0]?.message).toContain("doesn't cut anything");
  });

  it("a cut that would remove everything is refused", () => {
    const r = buildDocument(part(shape("box"), shape("box", { width: 50, depth: 50, height: 50, mode: "cut" })));
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toContain("cut away the whole part");
  });

  it("a cut that splits the part is built, with a warning", () => {
    const bar = shape("box", { width: 60, depth: 10, height: 10 });
    const slot = shape("box", { width: 4, depth: 20, height: 20, mode: "cut" });
    const r = designed(part(bar, slot));
    expect(r.issues[0]?.message).toContain("2 separate pieces");
  });

  it("holes are drilled from the top of the whole part", () => {
    // A 10 mm-tall base with a 20 mm post on top; a through hole down the post's centre goes through both.
    const base = shape("box", { width: 40, depth: 40, height: 10 });
    const post = shape("cylinder", { diameter: 16, height: 20, z: 10 });
    const r = designed({ units: "mm", features: [base, post, hole({ diameter: 6 })] });
    expect(rel(r.measurements.volume, 16000 + cyl(16, 20) - cyl(6, 30))).toBeLessThan(1e-9);
  });

  it("every shape on its own passes the exact-maths check made inside the kernel", () => {
    for (const type of ["box", "cylinder", "tube", "cone", "sphere"] as const) makeShape(shape(type)).delete();
  });

  it.each([
    ["sphere", shape("sphere")],
    ["pointed cone", shape("cone")],
  ])("a %s exports a watertight STL (no collapsed triangles at its tip)", async (_, s) => {
    const report = checkBinaryStl(await exportStl(designed(part(s)).shape));
    expect(report.watertight).toBe(true);
    expect(rel(report.volume, shapeVolume(s))).toBeLessThan(0.005);
  });

  it("a part made of several shapes exports a watertight STL", async () => {
    const base = shape("box", { width: 40, depth: 30, height: 6 });
    const post = shape("tube", { outerDiameter: 14, innerDiameter: 6, height: 14, z: 6 });
    const cone = shape("cone", { bottomDiameter: 10, topDiameter: 0, height: 8, x: 13, z: 6 });
    const pocket = shape("cylinder", { diameter: 8, height: 4, x: -13, z: 3, mode: "cut" });
    const r = designed(part(base, post, cone, pocket));
    const stl = await exportStl(r.shape);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}shapes.stl`, Buffer.from(stl));
    writeFileSync(`${OUT}shapes.expected.json`, JSON.stringify({ volume: r.measurements.volume, size: r.measurements.size }));
    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(report.consistentWinding).toBe(true);
    expect(rel(report.volume, r.measurements.volume)).toBeLessThan(0.005);
    const expected = 7200 + Math.PI * (49 - 9) * 14 + (Math.PI * 25 * 8) / 3 - cyl(8, 3);
    expect(rel(r.measurements.volume, expected)).toBeLessThan(1e-9);
  });
});

describe("STL checker itself", () => {
  it("notices a missing triangle", async () => {
    const stl = await exportStl(built(box({ wall: 0 })).shape);
    const n = new DataView(stl).getUint32(80, true);
    const cut = stl.slice(0, 84 + (n - 1) * 50);
    new DataView(cut).setUint32(80, n - 1, true);
    expect(checkBinaryStl(cut).watertight).toBe(false);
  });
});
