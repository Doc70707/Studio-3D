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
import {
  buildBox,
  buildDocument,
  expectedBoxVolume,
  exportStl,
  faceOwners,
  makeShape,
  maxHoleVolume,
  tessellate,
  useKernel,
} from "./kernel";
import { faceCount, faceOfTriangle, facePoints, outlineOfFace, trianglesInPlane } from "./faces";
import {
  THREADS,
  threadProfile,
  threadVolume,
  type CylinderFeature,
  type ThreadSize,
  newHollow,
  newEdgeStep,
  newPattern,
  newMirror,
  newRevolve,
  type EdgeFeature,
  type OpenSide,
  PLATE_PLANE,
  offsetProfile,
  newSketch,
  toWorld,
  type Feature,
  type FaceOutline,
  type Profile,
  type SketchFeature,
  boxSideFace,
  currentFace,
  holeAxis,
  type BoxSide,
} from "@studio3d/document";
import { checkBinaryStl } from "./stl-check";
import { crc32, stlTo3mf } from "./threemf";
import { layerBounds, loopArea, sliceStl } from "./slice";
import { crc32 as nodeCrc32 } from "node:zlib";
import { makeBaseBox, measureVolume } from "replicad";

const require = createRequire(import.meta.url);
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const box = (over: Partial<BoxFeature> = {}): BoxFeature => ({
  id: "b1",
  ...DEFAULT_BOX,
  ...over,
});

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
    doc.features[0] = {
      ...(doc.features[0] as BoxFeature),
      width: 73.5,
      depth: 41.25,
      height: 19,
      wall: 1.6,
    };
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
      JSON.stringify({
        volume: expectedBoxVolume(b),
        size: [b.width, b.depth, b.height],
      }),
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
const design = (b: BoxFeature, ...holes: HoleFeature[]): ProjectDocument => ({
  units: "mm",
  features: [b, ...holes],
});
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
const part = (...shapes: ShapeFeature[]): ProjectDocument => ({
  units: "mm",
  features: shapes,
});

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
    const cutter = shape("cylinder", {
      diameter: 10,
      height: 40,
      z: 0,
      mode: "cut",
    });
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
    const r = designed({
      units: "mm",
      features: [base, post, hole({ diameter: 6 })],
    });
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
    const post = shape("tube", {
      outerDiameter: 14,
      innerDiameter: 6,
      height: 14,
      z: 6,
    });
    const cone = shape("cone", {
      bottomDiameter: 10,
      topDiameter: 0,
      height: 8,
      x: 13,
      z: 6,
    });
    const pocket = shape("cylinder", {
      diameter: 8,
      height: 4,
      x: -13,
      z: 3,
      mode: "cut",
    });
    const r = designed(part(base, post, cone, pocket));
    const stl = await exportStl(r.shape);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}shapes.stl`, Buffer.from(stl));
    writeFileSync(
      `${OUT}shapes.expected.json`,
      JSON.stringify({
        volume: r.measurements.volume,
        size: r.measurements.size,
      }),
    );
    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(report.consistentWinding).toBe(true);
    expect(rel(report.volume, r.measurements.volume)).toBeLessThan(0.005);
    const expected = 7200 + Math.PI * (49 - 9) * 14 + (Math.PI * 25 * 8) / 3 - cyl(8, 3);
    expect(rel(r.measurements.volume, expected)).toBeLessThan(1e-9);
  });
});

describe("sketches", () => {
  const block = () => shape("box", { width: 60, depth: 40, height: 30 });
  /** Builds a part and finds one of its flat faces the way a click in the 3D view does. */
  const faceOf = (features: Feature[], label: string): FaceOutline => {
    const mesh = tessellate(designed({ units: "mm", features }).shape);
    for (let f = 0; f < faceCount(mesh); f++) {
      const o = outlineOfFace(mesh, f);
      if (o?.label === label) return o;
    }
    throw new Error(`no ${label}`);
  };
  const sketch = (on: FaceOutline | null, profiles: Profile[], mode: "add" | "cut", depth: number): SketchFeature =>
    newSketch({ units: "mm", features: [] }, on?.plane ?? PLATE_PLANE, on?.label ?? "plate", profiles, mode, depth);
  const rect = (x: number, y: number, width: number, height: number): Profile => ({
    kind: "rectangle",
    x,
    y,
    width,
    height,
  });

  it("every flat face of a block is found, with its size, and curved faces are skipped", () => {
    const mesh = tessellate(designed(part(block(), shape("cylinder", { z: 30 }))).shape);
    const labels = Array.from({ length: faceCount(mesh) }, (_, f) => outlineOfFace(mesh, f)?.label ?? "curved");
    expect(labels).toContain("curved");
    const front = faceOf([block()], "front face");
    expect([front.width, front.height]).toEqual([60, 30]);
    expect(front.plane.origin).toEqual([-30, -20, 0]); // the face's bottom-left corner
    const top = faceOf([block()], "top face");
    expect([top.width, top.height, top.plane.origin[2]]).toEqual([60, 40, 30]);
    // A ray hit on any triangle maps back to its face.
    expect(faceOfTriangle(mesh, 0)).toBe(0);
    expect(faceOfTriangle(mesh, mesh.indices.length / 3 - 1)).toBe(faceCount(mesh) - 1);
  });

  it("a rectangle cut into the top face makes a pocket of exactly its size", () => {
    const top = faceOf([block()], "top face");
    const r = designed({
      units: "mm",
      features: [block(), sketch(top, [rect(10, 10, 20, 10)], "cut", 5)],
    });
    expect(rel(r.measurements.volume, 72000 - 20 * 10 * 5)).toBeLessThan(1e-9);
    expect(r.issues).toEqual([]);
  });

  it("positions on a face are measured from its bottom-left corner", () => {
    const front = faceOf([block()], "front face");
    expect(toWorld(front.plane, [0, 0])).toEqual([-30, -20, 0]);
    expect(toWorld(front.plane, [60, 30])).toEqual([30, -20, 30]);
    // A 10 mm boss on the front face, 8 mm long: sticks out of the front only.
    const boss = sketch(front, [{ kind: "circle", x: 30, y: 15, diameter: 10 }], "add", 8);
    const r = designed({ units: "mm", features: [block(), boss] });
    expect(rel(r.measurements.volume, 72000 + cyl(10, 8))).toBeLessThan(1e-9);
    expect(r.measurements.min[1]).toBeCloseTo(-28, 9);
    expect(r.measurements.size).toEqual([60, 48, 30]);
  });

  it("a cut with depth 0 goes all the way through", () => {
    const top = faceOf([block()], "top face");
    const triangle: Profile = {
      kind: "polygon",
      points: [
        [10, 10],
        [30, 10],
        [10, 30],
      ],
    };
    const r = designed({
      units: "mm",
      features: [block(), sketch(top, [triangle], "cut", 0)],
    });
    expect(rel(r.measurements.volume, 72000 - 200 * 30)).toBeLessThan(1e-9);
  });

  it("an L-shaped outline drawn on the plate becomes the whole part (a bracket)", () => {
    const L: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 30],
        [0, 30],
      ],
    };
    const r = designed({
      units: "mm",
      features: [sketch(null, [L], "add", 20)],
    });
    expect(rel(r.measurements.volume, (40 * 5 + 5 * 25) * 20)).toBeLessThan(1e-9);
    expect(r.measurements.size).toEqual([40, 30, 20]);
    expect(r.measurements.min).toEqual([0, 0, 0]);
  });

  it("outlines that overlap in one sketch are joined, not counted twice", () => {
    const top = faceOf([block()], "top face");
    const r = designed({
      units: "mm",
      features: [block(), sketch(top, [rect(0, 0, 20, 20), rect(10, 10, 20, 20)], "add", 4)],
    });
    expect(rel(r.measurements.volume, 72000 + (800 - 100) * 4)).toBeLessThan(1e-9);
  });

  it("several separate outlines are all cut", () => {
    const top = faceOf([block()], "top face");
    const holes = [5, 15, 25].map((x): Profile => ({ kind: "circle", x, y: 20, diameter: 4 }));
    const r = designed({
      units: "mm",
      features: [block(), sketch(top, holes, "cut", 10)],
    });
    expect(rel(r.measurements.volume, 72000 - 3 * cyl(4, 10))).toBeLessThan(1e-9);
  });

  it("a sketch cut into the side of a hollow box goes through the wall only", () => {
    const tray = shape("box", { width: 60, depth: 40, height: 30, wall: 2 });
    const front = faceOf([tray], "front face");
    const r = designed({
      units: "mm",
      features: [tray, sketch(front, [rect(20, 10, 20, 10)], "cut", 0)],
    });
    expect(rel(r.measurements.volume, shapeVolume(tray) - 2 * 200 * 2)).toBeLessThan(1e-9);
  });

  it("a cut drawn off the part gets a warning and changes nothing", () => {
    const top = faceOf([block()], "top face");
    const r = designed({
      units: "mm",
      features: [block(), sketch(top, [rect(100, 100, 5, 5)], "cut", 5)],
    });
    expect(r.measurements.volume).toBeCloseTo(72000, 6);
    expect(r.issues[0]?.message).toContain("doesn't cut anything");
  });

  it("an outline that crosses itself is refused with a plain message", () => {
    const bowtie: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ],
    };
    const r = buildDocument({
      units: "mm",
      features: [block(), sketch(faceOf([block()], "top face"), [bowtie], "add", 5)],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toContain("crosses over itself");
  });

  it("the face under a sketch can be found again after the part changes", () => {
    const top = faceOf([block()], "top face");
    const mesh = tessellate(
      designed({
        units: "mm",
        features: [block(), sketch(top, [rect(10, 10, 20, 10)], "cut", 5)],
      }).shape,
    );
    const tris = trianglesInPlane(mesh, top.plane);
    expect(tris.length).toBeGreaterThan(0);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i]!, tris[i + 1]!, tris[i + 2]!];
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
    expect(area).toBeCloseTo(60 * 40 - 200, 6); // the top face, minus the pocket's opening
  });

  it("an outline with an offset copy inside it makes a frame (the inner one is a hole)", () => {
    const outer = rect(0, 0, 40, 30);
    const inner = offsetProfile(outer, -3)!;
    const r = designed({ units: "mm", features: [sketch(null, [outer, inner], "add", 10)] });
    expect(rel(r.measurements.volume, (40 * 30 - 34 * 24) * 10)).toBeLessThan(1e-9);
  });

  it("a washer: a circle with a smaller circle inside, and an island inside the hole", () => {
    const profiles: Profile[] = [
      { kind: "circle", x: 0, y: 0, diameter: 30 },
      { kind: "circle", x: 0, y: 0, diameter: 20 },
      { kind: "circle", x: 0, y: 0, diameter: 6 },
    ];
    const r = designed({ units: "mm", features: [sketch(null, profiles, "add", 3)] });
    expect(rel(r.measurements.volume, cyl(30, 3) - cyl(20, 3) + cyl(6, 3))).toBeLessThan(1e-9);
    expect(r.measurements.size).toEqual([30, 30, 3]);
  });

  it("a frame-shaped cut leaves the middle standing", () => {
    const top = faceOf([block()], "top face");
    const outer = rect(10, 10, 30, 20);
    const r = designed({ units: "mm", features: [block(), sketch(top, [outer, offsetProfile(outer, -2)!], "cut", 4)] });
    expect(rel(r.measurements.volume, 72000 - (600 - 26 * 16) * 4)).toBeLessThan(1e-9);
  });

  it("a part made with sketches exports a watertight STL", async () => {
    const top = faceOf([block()], "top face");
    const front = faceOf([block()], "front face");
    const features: Feature[] = [
      block(),
      sketch(top, [rect(5, 5, 20, 30), { kind: "circle", x: 45, y: 20, diameter: 12 }], "cut", 8),
      sketch(
        front,
        [
          {
            kind: "polygon",
            points: [
              [10, 5],
              [50, 5],
              [30, 25],
            ],
          },
        ],
        "add",
        6,
      ),
    ];
    const r = designed({ units: "mm", features });
    const stl = await exportStl(r.shape);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}sketches.stl`, Buffer.from(stl));
    writeFileSync(
      `${OUT}sketches.expected.json`,
      JSON.stringify({
        volume: r.measurements.volume,
        size: r.measurements.size,
      }),
    );
    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(rel(report.volume, r.measurements.volume)).toBeLessThan(0.005);
    expect(rel(r.measurements.volume, 72000 - 600 * 8 - cyl(12, 8) + 400 * 6)).toBeLessThan(1e-9);
  });
});

describe("hollow", () => {
  const block = (): ShapeFeature =>
    ({ ...newShape({ units: "mm", features: [] }, "box"), width: 60, depth: 40, height: 30 }) as ShapeFeature;
  const hollowed = (open: OpenSide, wall = 2, ...before: Feature[]): Feature[] => [
    ...(before.length ? before : [block()]),
    { ...newHollow({ units: "mm", features: [] }), wall, open },
  ];
  const fails = (features: Feature[]) => {
    const r = buildDocument({ units: "mm", features });
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.issues[0]!.message;
  };

  it("a block open at the top keeps its outside size and loses exactly its inside", () => {
    const r = designed({ units: "mm", features: hollowed("top") });
    expect(r.measurements.size).toEqual([60, 40, 30]);
    expect(rel(r.measurements.volume, 72000 - 56 * 36 * 28)).toBeLessThan(1e-9);
  });

  it("every side can be the open one, each removing the same inside box", () => {
    for (const [open, inside] of [
      ["bottom", 56 * 36 * 28],
      ["front", 56 * 38 * 26],
      ["back", 56 * 38 * 26],
      ["left", 58 * 36 * 26],
      ["right", 58 * 36 * 26],
    ] as const) {
      const r = designed({ units: "mm", features: hollowed(open) });
      expect(r.measurements.size, open).toEqual([60, 40, 30]);
      expect(rel(r.measurements.volume, 72000 - inside), open).toBeLessThan(1e-9);
    }
  });

  it("closed: the part keeps all its outside faces with an empty space inside", () => {
    const r = designed({ units: "mm", features: hollowed("none") });
    expect(rel(r.measurements.volume, 72000 - 56 * 36 * 26)).toBeLessThan(1e-9);
    const sphere = { ...newShape({ units: "mm", features: [] }, "sphere"), diameter: 20 } as ShapeFeature;
    const s = designed({ units: "mm", features: hollowed("none", 2, sphere) });
    expect(rel(s.measurements.volume, (4 / 3) * Math.PI * (10 ** 3 - 8 ** 3))).toBeLessThan(1e-6);
  });

  it("a cylinder open at the top becomes a cup", () => {
    const c = { ...newShape({ units: "mm", features: [] }, "cylinder"), diameter: 20, height: 20 } as ShapeFeature;
    const r = designed({ units: "mm", features: hollowed("top", 2, c) });
    expect(rel(r.measurements.volume, cyl(20, 20) - cyl(16, 18))).toBeLessThan(1e-6);
  });

  it("thick walls that still fit are exact too", () => {
    const r = designed({ units: "mm", features: hollowed("top", 14) });
    expect(rel(r.measurements.volume, 72000 - 32 * 12 * 16)).toBeLessThan(1e-9);
  });

  it("walls too thick for the part are refused, with the part's thinnest size", () => {
    expect(fails(hollowed("top", 20))).toContain("only 30 mm across at its thinnest");
    expect(fails(hollowed("top", 0.2))).toContain("at least 0.4 mm");
  });

  it("a pointed cone on the part makes the geometry engine fail; that's caught and explained", () => {
    const cone = { ...newShape({ units: "mm", features: [] }, "cone"), z: 30 } as ShapeFeature;
    expect(fails(hollowed("bottom", 2, block(), cone))).toContain("Sharp points (like the tip of a cone)");
  });

  it("a rounded side can't be left open, and says so", () => {
    const sphere = { ...newShape({ units: "mm", features: [] }, "sphere"), diameter: 20 } as ShapeFeature;
    expect(fails(hollowed("top", 2, sphere))).toContain("top of the part isn't flat");
  });

  it("holes drilled after hollowing go through the walls; the hollow part exports watertight", async () => {
    const hole: HoleFeature = { id: "h1", type: "hole", name: "Hole 1", x: 0, y: 0, diameter: 6, depth: 0 };
    const r = designed({ units: "mm", features: [...hollowed("top"), hole] });
    // Only the 2 mm floor is drilled: the hole is over the hollow inside.
    expect(rel(r.measurements.volume, 72000 - 56 * 36 * 28 - cyl(6, 2))).toBeLessThan(1e-9);
    const stl = await exportStl(r.shape);
    expect(checkBinaryStl(stl).watertight).toBe(true);
    writeFileSync(`${OUT}hollow.stl`, Buffer.from(stl));
    writeFileSync(
      `${OUT}hollow.expected.json`,
      JSON.stringify({ volume: r.measurements.volume, size: r.measurements.size }),
    );
  });

  it("a part with a boss on top, hollowed from below, keeps walls inside the boss", () => {
    const boss = {
      ...newShape({ units: "mm", features: [] }, "cylinder"),
      diameter: 20,
      height: 10,
      z: 30,
    } as ShapeFeature;
    const r = designed({ units: "mm", features: hollowed("bottom", 2, block(), boss) });
    expect(r.measurements.size).toEqual([60, 40, 40]);
    expect(r.measurements.volume).toBeLessThan(72000 + cyl(20, 10));
    expect(r.measurements.volume).toBeGreaterThan(72000 - 56 * 36 * 28);
  });
});

// Threads take a few seconds each to build: the helix has to be swept and joined to the core.
describe("threads", { timeout: 120_000 }, () => {
  const solid = (): ShapeFeature =>
    ({ ...newShape({ units: "mm", features: [] }, "box"), width: 60, depth: 40, height: 30 }) as ShapeFeature;
  const bolt = (thread: ThreadSize, height: number, over: Partial<CylinderFeature> = {}): ShapeFeature =>
    ({
      ...newShape({ units: "mm", features: [] }, "cylinder"),
      diameter: THREADS[thread].diameter,
      height,
      thread,
      fit: 0.3,
      ...over,
    }) as ShapeFeature;
  const tapped = (thread: ThreadSize, depth = 0, fit = 0.3): HoleFeature => ({
    id: `h-${thread}`,
    type: "hole",
    name: "Hole 1",
    x: 0,
    y: 0,
    diameter: THREADS[thread].diameter,
    depth,
    thread,
    fit,
  });

  it.each(["M3", "M8", "M20"] as const)("an %s bolt has the exact ISO thread volume, 0.3 mm smaller across", (size) => {
    const r = designed({ units: "mm", features: [bolt(size, 12)] });
    const t = threadProfile(size, 0.3, true);
    expect(rel(r.measurements.volume, threadVolume(t, 12))).toBeLessThan(2e-5);
    const d = THREADS[size].diameter - 0.3;
    r.measurements.size.forEach((v, i) => expect(Math.abs(v - [d, d, 12][i]!)).toBeLessThan(1e-2));
  });

  it("a threaded hole through a block removes exactly the thread's space", () => {
    const r = designed({ units: "mm", features: [solid(), tapped("M5")] });
    const removed = 72000 - r.measurements.volume;
    expect(rel(removed, threadVolume(threadProfile("M5", 0.3, false), 30))).toBeLessThan(2e-5);
  });

  it("a blind threaded hole 10 mm deep", () => {
    const r = designed({ units: "mm", features: [solid(), tapped("M6", 10)] });
    expect(rel(72000 - r.measurements.volume, threadVolume(threadProfile("M6", 0.3, false), 10))).toBeLessThan(2e-5);
  });

  it("a bolt screwed into its threaded hole doesn't touch it anywhere, so it will turn", () => {
    // The hole's thread starts 1 mm below the part; lifting the bolt to a whole number of pitches above that
    // lines the two threads up, like screwing it in.
    const p = THREADS.M8.pitch;
    const holed = designed({ units: "mm", features: [solid(), tapped("M8")] });
    const screwed = makeShape(bolt("M8", 4, { id: "bolt", z: 5 * p - 1 }));
    expect(measureVolume(holed.shape.intersect(screwed))).toBeLessThan(1e-6);
    // The check can see contact: the same bolt half a millimetre off centre bites into the hole's thread.
    const offCentre = makeShape(bolt("M8", 4, { id: "bolt", z: 5 * p - 1, x: 0.5 }));
    expect(measureVolume(holed.shape.intersect(offCentre))).toBeGreaterThan(0.1);
  });

  it("a threaded rod standing on a block is one piece and exports watertight", async () => {
    const r = designed({ units: "mm", features: [solid(), bolt("M8", 15, { z: 30 })] });
    expect(r.measurements.size[2]).toBeCloseTo(45, 6);
    expect(rel(r.measurements.volume, 72000 + threadVolume(threadProfile("M8", 0.3, true), 15))).toBeLessThan(2e-5);
    const stl = await exportStl(r.shape);
    writeFileSync(`${OUT}thread.stl`, Buffer.from(stl));
    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    writeFileSync(
      `${OUT}thread.expected.json`,
      JSON.stringify({ volume: r.measurements.volume, size: r.measurements.size }),
    );
  });

  it("a thread too short for two turns is refused, with the shortest length", () => {
    const r = buildDocument({ units: "mm", features: [bolt("M8", 2)] });
    expect(!r.ok && r.issues[0]!.message).toContain("at least 2.5 mm long");
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

  it("notices two closed pieces stuck together at a seam, even when their corners differ by a hair", async () => {
    const a = await exportStl(built(box({ wall: 0, width: 10, depth: 10, height: 10 })).shape);
    // The same block moved right by its own width, plus a hair, so the two share their touching face.
    const b = a.slice(0);
    const view = new DataView(b);
    const n = view.getUint32(80, true);
    for (let t = 0; t < n; t++)
      for (let v = 0; v < 3; v++) {
        const o = 84 + t * 50 + 12 + v * 12;
        view.setFloat32(o, view.getFloat32(o, true) + 10, true);
        view.setFloat32(o + 4, view.getFloat32(o + 4, true) + 1e-13, true);
      }
    const both = new Uint8Array(84 + 2 * n * 50);
    both.set(new Uint8Array(a), 0);
    both.set(new Uint8Array(b, 84), 84 + n * 50);
    new DataView(both.buffer).setUint32(80, 2 * n, true);
    expect(checkBinaryStl(a).watertight).toBe(true);
    expect(checkBinaryStl(both.buffer).watertight).toBe(false);
  });
});

describe("which step made each face (for clicking a piece of the part)", () => {
  const owned = (doc: ProjectDocument) => {
    const r = buildDocument(doc, true);
    if (!r.ok) throw new Error(r.issues.map((i) => i.message).join("; "));
    const mesh = tessellate(r.shape);
    const t = performance.now();
    const owners = faceOwners(mesh, r.pieces!);
    const ms = performance.now() - t;
    r.pieces!.forEach((p) => p.shape.delete());
    expect(owners).toHaveLength(faceCount(mesh));
    /** The owner of the face with a triangle under a point of the part's surface. */
    const at = (p: [number, number, number]) => {
      for (let f = 0; f < owners.length; f++) {
        const pts = facePoints(mesh, f);
        for (let i = 0; i < pts.length; i += 3) if (onTriangle(p, pts[i]!, pts[i + 1]!, pts[i + 2]!)) return owners[f];
      }
      return undefined;
    };
    const count = (id: string) => owners.filter((o) => o === id).length;
    return { owners, at, count, ms };
  };

  it("a block with a cylinder on top, a hole and a pocket: each face belongs to the step that made it", () => {
    const block = { ...box({ wall: 0 }), id: "block" };
    const peg = { ...shape("cylinder", { diameter: 10, height: 8, x: -15, y: 0, z: 30 }), id: "peg" };
    const hole: HoleFeature = { id: "hole", type: "hole", name: "Hole 1", x: 20, y: 10, diameter: 6, depth: 0 };
    const mesh = tessellate(designed({ units: "mm", features: [block] }).shape);
    const front = [...Array(faceCount(mesh)).keys()]
      .map((f) => outlineOfFace(mesh, f))
      .find((o) => o?.label === "front face")!;
    const pocket = {
      ...newSketch(
        { units: "mm", features: [] },
        front.plane,
        front.label,
        [{ kind: "rectangle", x: 5, y: 5, width: 10, height: 8 } as Profile],
        "cut",
        4,
      ),
      id: "pocket",
    };
    const r = owned({ units: "mm", features: [block, peg, hole, pocket] });
    expect(r.owners.every((o) => o)).toBe(true);
    expect(r.at([0, 15, 30])).toBe("block"); // top of the block
    expect(r.at([0, -20, 25])).toBe("block"); // front of the block, above the pocket
    expect(r.at([-15, 0, 38])).toBe("peg"); // top of the peg
    expect(r.at([-10, 0, 34])).toBe("peg"); // side of the peg
    expect(r.at([23, 10, 15])).toBe("hole"); // inside the hole
    expect(r.at([-30 + 10, -16, 9])).toBe("pocket"); // floor of the pocket, 4 mm in
    for (const id of ["block", "peg", "hole", "pocket"]) expect(r.count(id)).toBeGreaterThan(0);
  });

  it("round shapes, and a dish cut by a sphere, belong to their own shapes", () => {
    const block = { ...box({ wall: 0 }), id: "block" };
    const cone = { ...shape("cone", { bottomDiameter: 12, topDiameter: 4, height: 10, x: -18, z: 30 }), id: "cone" };
    const tube = { ...shape("tube", { outerDiameter: 12, innerDiameter: 6, height: 6, x: 18, z: 30 }), id: "tube" };
    const dish = { ...shape("sphere", { diameter: 16, z: 24 }), mode: "cut", id: "dish" } as ShapeFeature;
    const r = owned({ units: "mm", features: [block, cone, tube, dish] });
    expect(r.owners.every((o) => o)).toBe(true);
    expect(r.at([-18, 0, 40])).toBe("cone");
    expect(r.at([18, 6, 33])).toBe("tube"); // outside of the tube
    expect(r.at([18, 3, 33])).toBe("tube"); // inside of the tube
    expect(r.at([0, 0, 24])).toBe("dish"); // bottom of the dish
    expect(r.at([0, 15, 30])).toBe("block");
  });

  it("the inside walls a hollow makes belong to the hollow", () => {
    const block = { ...box({ wall: 0 }), id: "block" };
    const h = { ...newHollow({ units: "mm", features: [] }), id: "hollow", wall: 2, open: "top" as const };
    const r = owned({ units: "mm", features: [block, h] });
    expect(r.at([0, 0, 2])).toBe("hollow"); // inside floor
    expect(r.at([0, -18, 15])).toBe("hollow"); // inside front wall
    expect(r.at([0, -20, 15])).toBe("block"); // outside front wall
    expect(r.at([0, 0, 0])).toBe("block"); // underneath
  });

  it("rounded corners belong to the fillet; the flat faces stay the block's", () => {
    const block = { ...box({ wall: 0 }), id: "block" };
    const round = {
      ...newEdgeStep({ units: "mm", features: [] }, "fillet"),
      id: "round",
      size: 5,
      edges: "vertical" as const,
    };
    const r = owned({ units: "mm", features: [block, round] });
    const d = 4.99 * Math.SQRT1_2; // just inside the curve, where the display's flat triangles are
    expect(r.at([25 + d, 15 + d, 15])).toBe("round");
    expect(r.at([0, -20, 15])).toBe("block");
    expect(r.at([0, 0, 30])).toBe("block");
  });

  it("the bosses a pattern adds belong to the pattern", () => {
    const block = { ...box({ wall: 0, height: 10 }), id: "block" };
    const boss = { ...shape("cylinder", { diameter: 10, height: 5, x: -20, z: 10 }), id: "boss" } as ShapeFeature;
    const row = { ...newPattern({ units: "mm", features: [] }, "boss"), id: "row", count: 3, spacing: 20 };
    const r = owned({ units: "mm", features: [block, boss, row] });
    expect(r.at([-20, 0, 15])).toBe("boss");
    expect(r.at([0, 0, 15])).toBe("row");
    expect(r.at([20, 0, 15])).toBe("row");
    expect(r.at([10, 15, 10])).toBe("block");
  });

  it("a threaded rod's faces belong to it, quickly enough to do after every change", () => {
    const block = { ...box({ wall: 0, height: 10 }), id: "block" };
    const rod = {
      ...shape("cylinder", { diameter: 8, height: 15, z: 10 }),
      thread: "M8" as const,
      fit: 0.3,
      id: "rod",
    } as ShapeFeature;
    const r = owned({ units: "mm", features: [block, rod] });
    expect(r.count("rod")).toBeGreaterThan(0);
    expect(r.at([0, 15, 10])).toBe("block");
    expect(r.at([0, 0, 25])).toBe("rod");
    expect(r.ms).toBeLessThan(1500);
  });
});

describe("fillets and chamfers", () => {
  const block = (): ShapeFeature =>
    ({ ...newShape({ units: "mm", features: [] }, "box"), width: 60, depth: 40, height: 30 }) as ShapeFeature;
  const edges = (type: EdgeFeature["type"], over: Partial<EdgeFeature>): EdgeFeature => ({
    ...newEdgeStep({ units: "mm", features: [] }, type),
    ...over,
  });
  const fails = (features: Feature[]) => {
    const r = buildDocument({ units: "mm", features });
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.issues[0]!.message;
  };

  it("rounding every edge of a block gives exactly a rounded box", () => {
    const r = designed({ units: "mm", features: [block(), edges("fillet", { size: 2, edges: "all" })] });
    const [a, b, c, k] = [56, 36, 26, 2];
    const rounded =
      a * b * c + 2 * k * (a * b + b * c + a * c) + Math.PI * k * k * (a + b + c) + (4 / 3) * Math.PI * k ** 3;
    expect(r.measurements.size).toEqual([60, 40, 30]);
    expect(rel(r.measurements.volume, rounded)).toBeLessThan(1e-6);
  });

  it("rounding the upright edges takes a quarter-circle corner off each one", () => {
    const r = designed({ units: "mm", features: [block(), edges("fillet", { size: 5, edges: "vertical" })] });
    expect(rel(r.measurements.volume, 72000 - 4 * (1 - Math.PI / 4) * 25 * 30)).toBeLessThan(1e-6);
  });

  it("a chamfer round the bottom takes a mitred 1 mm bevel, and the part exports watertight", async () => {
    const r = designed({ units: "mm", features: [block(), edges("chamfer", { size: 1, edges: "bottom" })] });
    // The bevel's cross-section (0.5 mm²) swept along the loop through its centre, 1/3 mm in from each side.
    expect(rel(r.measurements.volume, 72000 - 0.5 * 2 * (60 - 2 / 3 + 40 - 2 / 3))).toBeLessThan(1e-6);
    r.measurements.size.forEach((v, i) => expect(v).toBeCloseTo([60, 40, 30][i]!, 9));
    const report = checkBinaryStl(await exportStl(r.shape));
    expect(report.watertight).toBe(true);
  });

  it("a chamfer on a cylinder's top edge takes a ring off, by Pappus' rule", () => {
    const rod = shape("cylinder", { diameter: 20, height: 10 }) as ShapeFeature;
    const r = designed({ units: "mm", features: [rod, edges("chamfer", { size: 1, edges: "top" })] });
    expect(rel(r.measurements.volume, cyl(20, 10) - 2 * Math.PI * (10 - 1 / 3) * 0.5)).toBeLessThan(1e-6);
  });

  it("too big a size, or edges the part doesn't have, are explained and the last good part is kept", () => {
    expect(fails([block(), edges("fillet", { size: 20, edges: "all" })])).toContain("try a smaller size");
    const ball = shape("sphere", { diameter: 20 }) as ShapeFeature;
    expect(fails([ball, edges("fillet", { size: 1, edges: "vertical" })])).toContain("no upright edges to round");
  });
});

describe("patterns and mirrors", () => {
  const plate = () => shape("box", { width: 60, depth: 40, height: 10, wall: 0, id: "plate" });
  const grid = (source: string, over = {}) => ({ ...newPattern({ units: "mm", features: [] }, source), ...over });
  const doc = (...features: Feature[]): ProjectDocument => ({ units: "mm", features });
  const fails = (d: ProjectDocument) => {
    const r = buildDocument(d);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.issues[0]!.message;
  };

  it("a 3 × 2 grid of through holes cuts six exact holes", () => {
    const h = hole({ id: "h", x: -20, y: -10, diameter: 5 });
    const r = designed(doc(plate(), h, grid("h", { count: 3, spacing: 20, rows: 2, rowSpacing: 20 })));
    expect(rel(r.measurements.volume, 24000 - 6 * cyl(5, 10))).toBeLessThan(1e-6);
  });

  it("holes round a circle: six evenly spaced on a disc", () => {
    const disc = shape("cylinder", { diameter: 50, height: 5, id: "disc" });
    const h = hole({ id: "h", x: 15, y: 0, diameter: 5 });
    const r = designed(doc(disc, h, grid("h", { kind: "circle", count: 6, angle: 360, cx: 0, cy: 0 })));
    expect(rel(r.measurements.volume, cyl(50, 5) - 6 * cyl(5, 5))).toBeLessThan(1e-6);
  });

  it("a row of bosses on top adds three of them", () => {
    const boss = shape("cylinder", { diameter: 10, height: 5, x: -20, y: 0, z: 10, id: "boss" });
    const r = designed(doc(plate(), boss, grid("boss", { count: 3, spacing: 20 })));
    expect(rel(r.measurements.volume, 24000 + 3 * cyl(10, 5))).toBeLessThan(1e-6);
    expect(r.measurements.size).toEqual([60, 40, 15]);
  });

  it("boxes turned round a circle stand at each quarter, rotated with it", () => {
    const disc = shape("cylinder", { diameter: 30, height: 5, id: "disc" });
    const arm = shape("box", { width: 20, depth: 4, height: 5, x: 20, y: 0, z: 0, wall: 0, id: "arm" });
    const r = designed(doc(disc, arm, grid("arm", { kind: "circle", count: 4, angle: 360, cx: 0, cy: 0 })));
    r.measurements.size.forEach((v, i) => expect(v).toBeCloseTo([60, 60, 5][i]!, 6));
    // Each arm overlaps the disc the same way, so the four together add four times what one adds.
    const one = designed(doc(disc, arm)).measurements.volume - cyl(30, 5);
    expect(rel(r.measurements.volume, cyl(30, 5) + 4 * one)).toBeLessThan(1e-6);
  });

  it("a mirror copies a boss to the other side of the part", () => {
    const boss = shape("box", { width: 10, depth: 10, height: 5, x: 20, y: 5, z: 10, wall: 0, id: "boss" });
    const m = { ...newMirror({ units: "mm", features: [] }, "boss"), axis: "x" as const, at: 0 };
    const r = designed(doc(plate(), boss, m));
    expect(rel(r.measurements.volume, 24000 + 2 * 500)).toBeLessThan(1e-9);
    expect(r.measurements.min[0]).toBeCloseTo(-30, 9);
    const across = { ...m, axis: "y" as const, at: 0 };
    const r2 = designed(doc(plate(), boss, across));
    expect(rel(r2.measurements.volume, 24000 + 2 * 500)).toBeLessThan(1e-9);
  });

  it("a pattern that copies a missing or later step, or has too few, is explained", () => {
    expect(fails(doc(plate(), grid("gone")))).toContain("Choose an earlier shape, hole or sketch");
    const h = hole({ id: "h" });
    expect(fails(doc(plate(), h, grid("h", { count: 1 })))).toContain("at least 2");
    expect(fails(doc(plate(), grid("h"), h))).toContain("Choose an earlier");
  });
});

describe("revolves", () => {
  const doc = (...features: Feature[]): ProjectDocument => ({ units: "mm", features });
  const spin = (profiles: Profile[], over: Partial<SketchFeature> = {}): SketchFeature => ({
    ...newRevolve(doc()),
    id: "spin",
    profiles,
    ...over,
  });
  const rect = (x: number, y: number, width: number, height: number): Profile => ({
    kind: "rectangle",
    x,
    y,
    width,
    height,
  });

  it("a rectangle off the spin line makes a tube standing on the plate", () => {
    const r = designed(doc(spin([rect(5, 0, 10, 20)])));
    expect(rel(r.measurements.volume, Math.PI * (15 ** 2 - 5 ** 2) * 20)).toBeLessThan(1e-6);
    r.measurements.min.forEach((v, i) => expect(v).toBeCloseTo([-15, -15, 0][i]!, 6));
    r.measurements.max.forEach((v, i) => expect(v).toBeCloseTo([15, 15, 20][i]!, 6));
  });

  it("a triangle touching the line makes a cone; half a turn makes half of it", () => {
    const tri: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [10, 0],
        [0, 20],
      ],
    };
    expect(rel(designed(doc(spin([tri]))).measurements.volume, (Math.PI * 100 * 20) / 3)).toBeLessThan(1e-6);
    const half = designed(doc(spin([tri], { revolve: 180 })));
    expect(rel(half.measurements.volume, (Math.PI * 100 * 20) / 6)).toBeLessThan(1e-6);
    // Half a turn, anticlockwise seen from above, from the right-hand side round the back.
    expect(half.measurements.min[1]).toBeCloseTo(0, 6);
    expect(half.measurements.max[1]).toBeCloseTo(10, 6);
  });

  it("a circle spun round makes a ring (torus); a notched outline makes a V-groove pulley", () => {
    const ring = designed(doc(spin([{ kind: "circle", x: 20, y: 5, diameter: 10 }])));
    expect(rel(ring.measurements.volume, 2 * Math.PI ** 2 * 20 * 25)).toBeLessThan(1e-6);
    const notched: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [20, 0],
        [20, 3],
        [17, 5],
        [20, 7],
        [20, 10],
        [0, 10],
      ],
    };
    // The disc less the notch (a triangle of area 6 whose centre is 19 mm from the line) spun round.
    const pulley = designed(doc(spin([notched])));
    expect(rel(pulley.measurements.volume, Math.PI * 400 * 10 - 2 * Math.PI * 6 * 19)).toBeLessThan(1e-6);
  });

  it("a revolve can cut: a cone-shaped countersink in a block", () => {
    const block = shape("box", { width: 40, depth: 40, height: 20, wall: 0, id: "block" });
    const sink: Profile = {
      kind: "polygon",
      points: [
        [0, 10],
        [10, 20],
        [10, 21],
        [0, 21],
      ],
    };
    const r = designed(doc(block, spin([sink], { mode: "cut" })));
    // The cone from radius 0 at z = 10 to radius 10 at z = 20 is removed; the 1 mm above the block cuts nothing.
    expect(rel(r.measurements.volume, 32000 - (Math.PI * 100 * 10) / 3)).toBeLessThan(1e-6);
  });

  it("an outline crossing the spin line, or a bad angle, is explained before building", () => {
    const r = buildDocument(doc(spin([rect(-5, 0, 10, 20)])));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.issues[0]!.message).toContain("crosses the spin line");
    const zero = buildDocument(doc(spin([rect(5, 0, 10, 20)], { revolve: 0 })));
    expect(zero.ok ? "" : zero.issues[0]!.message).toContain("from 1° to 360°");
  });

  it("a revolve can be moved, patterned and mirrored like any sketch", () => {
    const peg = spin([rect(0, 0, 3, 10)], { plane: { ...newRevolve(doc()).plane, origin: [10, 0, 0] } });
    const p = { ...newPattern(doc(), "spin"), count: 3, spacing: 10 };
    expect(rel(designed(doc(peg, p)).measurements.volume, 3 * cyl(6, 10))).toBeLessThan(1e-6);
    const m = { ...newMirror(doc(), "spin"), axis: "x" as const, at: 0 };
    const r = designed(doc(peg, m));
    expect(rel(r.measurements.volume, 2 * cyl(6, 10))).toBeLessThan(1e-6);
    expect(r.measurements.min[0]).toBeCloseTo(-13, 6);
  });
});

/** Whether a point lies on a triangle (within the display mesh's accuracy). */
function onTriangle(p: number[], a: number[], b: number[], c: number[]): boolean {
  const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]!);
  const dotp = (u: number[], v: number[]) => u.reduce((t, x, i) => t + x * v[i]!, 0);
  const cross = (u: number[], v: number[]) => [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(...n);
  if (len < 1e-12 || Math.abs(dotp(sub(p, a), n)) / len > 0.06) return false;
  const side = (u: number[], v: number[]) => dotp(cross(sub(v, u), sub(p, u)), n) >= -1e-9;
  return side(a, b) && side(b, c) && side(c, a);
}

describe("holes on any flat face, measured from its edges", () => {
  const block = (over: Partial<BoxFeature> = {}) => box({ id: "blk", wall: 0, ...over }); // 60 x 40 x 30
  const onSide = (b: BoxFeature, side: BoxSide, over: Partial<HoleFeature> = {}, follow = true): HoleFeature => ({
    ...hole({ diameter: 6, depth: 0 }),
    x: 15,
    y: 10,
    face: {
      ...boxSideFace(b, side),
      ...(follow && { on: { shape: b.id, side } }),
      across: "left",
      up: "bottom",
    },
    ...over,
  });

  it("each side of a box, worked out from the box, is the same face a click finds", () => {
    const b = block();
    const mesh = tessellate(designed(design(b)).shape);
    const picked = Array.from({ length: faceCount(mesh) }, (_, f) => outlineOfFace(mesh, f)!);
    for (const side of ["top", "bottom", "front", "back", "left", "right"] as const) {
      const face = boxSideFace(b, side);
      const o = picked.find((p) => p.label === face.surface)!;
      expect(face.plane).toEqual(o.plane);
      expect([face.width, face.height]).toEqual([o.width, o.height]);
    }
  });

  it("a through hole in the front face goes straight through the 40 mm depth", () => {
    const b = block();
    const r = designed(design(b, onSide(b, "front")));
    expect(rel(r.measurements.volume, 72000 - cyl(6, 40))).toBeLessThan(1e-9);
    expect(r.issues).toEqual([]);
  });

  it("blind holes stop at their depth on every side", () => {
    const b = block();
    for (const side of ["top", "bottom", "front", "back", "left", "right"] as const) {
      const r = designed(design(b, onSide(b, side, { depth: 7 })));
      expect(rel(r.measurements.volume, 72000 - cyl(6, 7))).toBeLessThan(1e-9);
    }
  });

  it("measured from the right edge or the middle puts the hole where it says", () => {
    const b = block();
    // On the right face (40 wide, 30 tall) 5 from the right edge and 4 above the middle, 20 deep.
    const h = onSide(b, "right", { x: 5, y: 4, depth: 20, diameter: 4 });
    h.face = { ...h.face!, across: "right", up: "centre" };
    const { point, direction } = holeAxis(currentFace(design(b, h), h.face), h.x, h.y);
    expect(point).toEqual([30, 15, 19]);
    expect(direction).toEqual([-1, -0, -0]);
    const r = designed(design(b, h));
    expect(rel(r.measurements.volume, 72000 - cyl(4, 20))).toBeLessThan(1e-9);
  });

  it("follows its box: wider, taller or moved, the hole keeps its distances from the edges", () => {
    const b = block();
    const h = onSide(b, "front", { x: 10, y: 8 });
    h.face = { ...h.face!, across: "right", up: "top" };
    for (const changed of [block({ width: 90 }), block({ height: 50 }), block({ x: 12, y: -7, z: 5 })]) {
      const doc = design(changed, h);
      const face = currentFace(doc, h.face);
      expect(face.plane.origin[1]).toBe(changed.y - changed.depth / 2); // still on the front face
      const { point } = holeAxis(face, h.x, h.y);
      expect(point[0]).toBeCloseTo(changed.x + changed.width / 2 - 10, 9); // 10 from the right edge
      expect(point[2]).toBeCloseTo(changed.z + changed.height - 8, 9); // 8 below the top edge
      const r = designed(doc);
      const v = changed.width * changed.depth * changed.height;
      expect(rel(r.measurements.volume, v - cyl(6, changed.depth))).toBeLessThan(1e-9);
    }
  });

  it("a hole that runs off an edge of its face is refused, naming the edge; nothing is moved to fit", () => {
    const b = block();
    const off = onSide(b, "front", { x: 2 }); // 6 across, 2 from the left edge
    const r = buildDocument(design(b, off));
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({
      field: "x",
      message: "Hole 1 runs off the left edge of the front face. Move it in or make it smaller.",
    });
    const thin = designed(design(b, onSide(b, "front", { y: 3.2 })));
    expect(thin.issues[0]).toMatchObject({ severity: "warning", field: "y" });
    expect(thin.issues[0]!.message).toContain("bottom edge of the front face");
  });

  it("a blind hole deeper than the part is under it says how deep it can go", () => {
    const b = block();
    const r = buildDocument(design(b, onSide(b, "left", { depth: 75 })));
    expect(r.ok).toBe(false);
    expect(r.issues[0]!.message).toBe(
      "The part is only 60 mm deep under Hole 1. Use 60 mm or less, or 0 to go all the way through.",
    );
  });

  it("a threaded hole in a side face removes exactly the thread's space", { timeout: 60_000 }, () => {
    const b = block();
    const h = onSide(b, "front", { x: 30, y: 15, thread: "M6", fit: 0.3, diameter: THREADS.M6.diameter });
    const r = designed(design(b, h));
    expect(rel(72000 - r.measurements.volume, threadVolume(threadProfile("M6", 0.3, false), 40))).toBeLessThan(2e-5);
  });

  it("a hole on a face that doesn't follow a box stays where it was picked; copies of it are drilled too", () => {
    const b = block();
    const fixed = onSide(b, "front", { x: 10, depth: 5 }, false);
    const moved = block({ x: 5 });
    // The box moved 5 right but the hole didn't: 5 + 10 = 15 from the box's new left edge.
    expect(holeAxis(currentFace(design(moved, fixed), fixed.face!), fixed.x, fixed.y).point[0]).toBe(-20);
    const doc = design(b, fixed);
    doc.features.push({ ...newPattern(doc, fixed.id), kind: "grid", count: 3, spacing: 15, rows: 1 });
    const r = designed(doc);
    expect(rel(r.measurements.volume, 72000 - 3 * cyl(6, 5))).toBeLessThan(1e-9);
  });

  it("saves and opens with its face", () => {
    const b = block();
    const doc = design(b, onSide(b, "back", { depth: 4 }));
    const back = parseProject(serializeProject(doc, { name: "Studio 3D", version: "test" }));
    expect(back.ok && back.document).toEqual(doc);
  });
});

describe("clearance, tapped, counterbored and countersunk holes", { timeout: 120_000 }, () => {
  const block = () => box({ id: "blk", wall: 0 }); // 60 x 40 x 30, 72000 mm³
  const frustum = (D: number, d: number, h: number) =>
    (Math.PI * h * ((D / 2) ** 2 + (D / 2) * (d / 2) + (d / 2) ** 2)) / 3;

  it("an M5 normal clearance hole is ISO 273's 5.5 mm, whatever diameter was typed", () => {
    const h = hole({ diameter: 3, clearance: { screw: "M5", series: "medium" } });
    const r = designed(design(block(), h));
    expect(rel(r.measurements.volume, 72000 - cyl(5.5, 30))).toBeLessThan(1e-9);
  });

  it("a counterbore for an M5 cap screw adds a 9.5 mm step 5 mm deep", async () => {
    const h = hole({
      clearance: { screw: "M5", series: "medium" },
      head: { kind: "counterbore", diameter: 9.5, depth: 5 },
    });
    const r = designed(design(block(), h));
    expect(rel(r.measurements.volume, 72000 - cyl(5.5, 25) - cyl(9.5, 5))).toBeLessThan(1e-7);
    expect(maxHoleVolume(h, 30)).toBeCloseTo(cyl(5.5, 25) + cyl(9.5, 5), 6);
    expect(checkBinaryStl(await exportStl(r.shape)).watertight).toBe(true);
  });

  it("a 90° countersink for an M6 flat head is a cone from 13.44 mm at the face down to the hole", () => {
    const h = hole({
      depth: 12,
      clearance: { screw: "M6", series: "medium" },
      head: { kind: "countersink", diameter: 13.44 },
    });
    const sink = (13.44 - 6.6) / 2; // 45° each side: as deep as it is wide on each side
    const r = designed(design(block(), h));
    expect(rel(r.measurements.volume, 72000 - cyl(6.6, 12 - sink) - frustum(13.44, 6.6, sink))).toBeLessThan(1e-7);
  });

  it("a countersink on a side face opens out at that face, not the far side", () => {
    const b = block();
    const h: HoleFeature = {
      ...hole({ diameter: 6, head: { kind: "countersink", diameter: 12 } }),
      x: 30,
      y: 15,
      face: { ...boxSideFace(b, "front"), on: { shape: b.id, side: "front" }, across: "left", up: "bottom" },
    };
    const r = designed(design(b, h));
    expect(rel(r.measurements.volume, 72000 - cyl(6, 37) - frustum(12, 6, 3))).toBeLessThan(1e-7);
    // The 1 mm slice behind the front face has the wide end of the cone in it.
    const slice = makeBaseBox(60, 1, 30).translate([0, -19.5, 0]);
    const kept = measureVolume(r.shape.intersect(slice));
    expect(kept).toBeCloseTo(1800 - frustum(12, 10, 1), 6);
  });

  it("a simplified M6 tapped hole is the 5 mm tap drill; no thread is built", () => {
    const h = hole({ depth: 10, thread: "M6", fit: 0.3, diameter: 6, simplified: true });
    const r = designed(design(block(), h));
    expect(rel(r.measurements.volume, 72000 - cyl(5, 10))).toBeLessThan(1e-9);
  });

  it("an M6 thread 8 mm deep at the top of a 15 mm hole; the hole carries on at the thread's root", () => {
    const h = hole({ depth: 15, thread: "M6", fit: 0.3, diameter: 6, threadDepth: 8 });
    const t = threadProfile("M6", 0.3, false);
    const r = designed(design(block(), h));
    expect(rel(72000 - r.measurements.volume, threadVolume(t, 8) + Math.PI * t.minor ** 2 * 7)).toBeLessThan(2e-5);
    // The thread is at the top: a 1 mm slice under the top face has thread grooves cut wider than the root.
    const top = measureVolume(r.shape.intersect(makeBaseBox(60, 40, 1).translate([0, 0, 29])));
    expect(2400 - top).toBeGreaterThan(Math.PI * t.minor ** 2 * 1.01);
  });

  it.each(["1/4-20 UNC", "#10-32 UNF", "M10x1.25"] as const)(
    "a %s threaded hole has its exact thread volume",
    (size) => {
      const h = hole({ depth: 10, thread: size, fit: 0.3, diameter: THREADS[size].diameter });
      const r = designed(design(block(), h));
      expect(rel(72000 - r.measurements.volume, threadVolume(threadProfile(size, 0.3, false), 10))).toBeLessThan(2e-5);
    },
  );

  it("a counterbore as deep as the part, or a thread deeper than it, is refused with the depth there is", () => {
    const deep = buildDocument(
      design(block(), hole({ diameter: 5, head: { kind: "counterbore", diameter: 9, depth: 30 } })),
    );
    expect(!deep.ok && deep.issues[0]!.message).toBe(
      "The counterbore on Hole 1 reaches 30 mm deep, but the part is only 30 mm deep there. " +
        "Make the counterbore smaller.",
    );
    const thread = buildDocument(design(block(), hole({ thread: "M6", diameter: 6, threadDepth: 40 })));
    expect(!thread.ok && thread.issues[0]).toMatchObject({ field: "threadDepth" });
    expect(!thread.ok && thread.issues[0]!.message).toContain("only 30 mm deep under Hole 1");
  });

  it("a counterbored hole can be patterned", () => {
    const doc = design(block(), hole({ x: -15, diameter: 4, head: { kind: "counterbore", diameter: 8, depth: 3 } }));
    doc.features.push({ ...newPattern(doc, doc.features[1]!.id), kind: "grid", count: 3, spacing: 15, rows: 1 });
    const r = designed(doc);
    expect(rel(r.measurements.volume, 72000 - 3 * (cyl(4, 27) + cyl(8, 3)))).toBeLessThan(1e-7);
  });
});

describe("print checks on the exported file", () => {
  it("counts separate pieces in the solid and in the STL, and a hollow box is still one piece", async () => {
    const apart = designed(part(shape("box", { wall: 0 }), shape("cylinder", { x: 80, z: 0 })));
    expect(apart.measurements.solids).toBe(2);
    expect(checkBinaryStl(await exportStl(apart.shape)).bodies).toBe(2);
    const touching = designed(part(shape("box", { wall: 0 }), shape("cylinder", { z: 20 }))); // on its 20 mm top
    expect(touching.measurements.solids).toBe(1);
    expect(checkBinaryStl(await exportStl(touching.shape)).bodies).toBe(1);
    const hollow = designed(part(shape("box", { wall: 2 })));
    expect(hollow.measurements.solids).toBe(1);
    expect(checkBinaryStl(await exportStl(hollow.shape)).bodies).toBe(1);
  });
});

/** Reads a ZIP of stored entries back, checking each entry's CRC with Node's own zlib (not our code). */
function unzipStored(zip: Uint8Array): Map<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const files = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    expect(v.getUint16(at + 8, true)).toBe(0); // stored
    const size = v.getUint32(at + 18, true);
    const nameLength = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength));
    const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(v.getUint32(at + 14, true)).toBe(nodeCrc32(data));
    files.set(name, new TextDecoder().decode(data));
    at += 30 + nameLength + size;
  }
  expect(v.getUint32(zip.length - 22, true)).toBe(0x06054b50); // end of central directory
  expect(v.getUint16(zip.length - 22 + 10, true)).toBe(files.size);
  return files;
}

describe("3MF export", () => {
  it("our CRC-32 matches zlib's", () => {
    const bytes = new TextEncoder().encode("Studio 3D <3MF> & more");
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("holds the same closed mesh as the STL, in millimetres, named, and placed on the printer's plate", async () => {
    const b = box({ width: 80, depth: 40, height: 30, wall: 2 });
    const stl = await exportStl(built(b).shape);
    const report = checkBinaryStl(stl);
    const file = stlTo3mf(stl, { name: "Tray <A&B>", offset: [128, 128, 0], application: "Studio 3D test" });
    const parts = unzipStored(file);
    expect([...parts.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    expect(parts.get("_rels/.rels")).toContain('Target="/3D/3dmodel.model"');
    const model = parts.get("3D/3dmodel.model")!;
    expect(model).toContain('<model unit="millimeter"');
    expect(model).toContain('<object id="1" name="Tray &lt;A&amp;B&gt;" type="model">');
    expect(model).toContain('<item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/>');

    // Rebuild the mesh from the XML: same triangle count, every edge shared twice, same volume and size.
    const vertices = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) =>
      [m[1], m[2], m[3]].map(Number),
    );
    const triangles = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((m) =>
      [m[1], m[2], m[3]].map(Number),
    );
    expect(triangles.length).toBe(report.triangles);
    const edges = new Map<string, number>();
    let volume = 0;
    for (const t of triangles) {
      const [a, b2, c] = t.map((i) => vertices[i]!) as [number[], number[], number[]];
      volume +=
        (a[0]! * (b2[1]! * c[2]! - b2[2]! * c[1]!) -
          a[1]! * (b2[0]! * c[2]! - b2[2]! * c[0]!) +
          a[2]! * (b2[0]! * c[1]! - b2[1]! * c[0]!)) /
        6;
      for (let e = 0; e < 3; e++) edges.set(`${t[e]}>${t[(e + 1) % 3]}`, 1);
    }
    for (const k of edges.keys()) {
      const [from, to] = k.split(">");
      expect(edges.has(`${to}>${from}`)).toBe(true);
    }
    expect(volume).toBeCloseTo(report.volume, 3);
    for (const i of [0, 1, 2]) {
      const along = vertices.map((p) => p[i]!);
      expect(Math.max(...along) - Math.min(...along)).toBeCloseTo([80, 40, 30][i]!, 4);
    }

    // For the independent check with trimesh in CI (scripts/verify_stl.py).
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}tray.3mf`, file);
    writeFileSync(
      `${OUT}tray.3mf.expected.json`,
      JSON.stringify({ volume: expectedBoxVolume(b), size: [80, 40, 30], name: "Tray <A&B>", min: [88, 108, 0] }),
    );
  });
});

describe("slicing into layers", () => {
  const stlOf = async (doc: ProjectDocument) => exportStl(designed(doc).shape);
  const outsides = (loops: Float64Array[]) => loops.filter((l) => loopArea(l) > 0).length;
  const holes = (loops: Float64Array[]) => loops.filter((l) => loopArea(l) < 0).length;

  it("layers stack from the plate to the top, the first one its own height", () => {
    const b = layerBounds(0, 1, { layerHeight: 0.2, firstLayerHeight: 0.3 });
    expect(b.map((l) => [l.bottom, l.top].map((v) => Math.round(v * 1000) / 1000))).toEqual([
      [0, 0.3],
      [0.3, 0.5],
      [0.5, 0.7],
      [0.7, 0.9],
      [0.9, 1],
    ]);
    expect(layerBounds(0, 30, { layerHeight: 0.2 })).toHaveLength(150);
    expect(() => layerBounds(0, 1, { layerHeight: 0 })).toThrow("more than 0 mm");
  });

  it("a solid block is a 60 × 40 rectangle on every layer", async () => {
    const stl = await exportStl(built(box({ width: 60, depth: 40, height: 30, wall: 0 })).shape);
    const { layers, openEnds } = sliceStl(stl, { layerHeight: 0.2 });
    expect(openEnds).toBe(0);
    expect(layers).toHaveLength(150);
    for (const l of layers) {
      expect(l.loops).toHaveLength(1);
      expect(l.loops[0]!.length).toBe(8); // four corners: the cut lines along each side are merged
      expect(l.area).toBeCloseTo(2400, 6);
    }
  });

  it("an open-top container is a frame of 2 mm walls above its 2 mm floor", async () => {
    const stl = await exportStl(built(box({ width: 60, depth: 40, height: 30, wall: 2 })).shape);
    const { layers, openEnds } = sliceStl(stl, { layerHeight: 0.2, firstLayerHeight: 0.3 });
    expect(openEnds).toBe(0);
    for (const l of layers) {
      const floor = l.z < 2;
      expect([outsides(l.loops), holes(l.loops)]).toEqual(floor ? [1, 0] : [1, 1]);
      expect(l.area).toBeCloseTo(floor ? 2400 : 2400 - 56 * 36, 6);
    }
    // Area times thickness, layer by layer, is the volume that will print. With a 0.3 mm first layer the floor's top
    // falls mid-layer (1.9 to 2.1 mm), and that layer is a wall layer: the floor prints 1.9 mm thick.
    const printed = (ls: typeof layers) => ls.reduce((s, l) => s + l.area * (l.top - l.bottom), 0);
    expect(printed(layers)).toBeCloseTo(2400 * 1.9 + (2400 - 56 * 36) * 28.1, 6);
    // When layers meet at the floor's top, it is the part's exact volume.
    const aligned = sliceStl(stl, { layerHeight: 0.2 }).layers;
    expect(printed(aligned)).toBeCloseTo(15552, 6);
  });

  it("a cylinder's layers are circles of its area, and a hole through a block is a hole in every layer", async () => {
    const c = sliceStl(await stlOf(part(shape("cylinder", { diameter: 20, height: 10 }))), { layerHeight: 0.25 });
    expect(c.openEnds).toBe(0);
    expect(c.layers).toHaveLength(40);
    for (const l of c.layers) expect(rel(l.area, Math.PI * 100)).toBeLessThan(0.005);

    const block = box({ width: 30, depth: 30, height: 10, wall: 0 });
    const holed = sliceStl(await stlOf(design(block, hole({ diameter: 8 }))), { layerHeight: 0.2 });
    expect(holed.openEnds).toBe(0);
    for (const l of holed.layers) {
      expect([outsides(l.loops), holes(l.loops)]).toEqual([1, 1]);
      expect(rel(l.area, 900 - Math.PI * 16)).toBeLessThan(0.002);
    }
  });

  it("a sphere's layers follow the exact circle at each height", async () => {
    const stl = await stlOf(part(shape("sphere", { diameter: 20 })));
    const report = checkBinaryStl(stl);
    const { layers, openEnds } = sliceStl(stl, { layerHeight: 0.2 });
    expect(openEnds).toBe(0);
    const centre = (report.min[2] + report.max[2]) / 2;
    // Away from the poles, where a flat-faced mesh differs most from the true sphere.
    for (const l of layers.filter((l) => Math.abs(l.z - centre) < 8)) {
      expect(l.loops).toHaveLength(1);
      expect(rel(l.area, Math.PI * (100 - (l.z - centre) ** 2))).toBeLessThan(0.02);
    }
  });

  it("two separate shapes give two outlines on the layers they share", async () => {
    const stl = await stlOf(
      part(shape("box", { width: 10, depth: 10, height: 5 }), shape("cylinder", { diameter: 6, height: 8, x: 20 })),
    );
    const { layers } = sliceStl(stl, { layerHeight: 0.5 });
    expect(layers.map((l) => outsides(l.loops))).toEqual([...Array(10).fill(2), ...Array(6).fill(1)]);
  });

  it("a surface with a gap is reported, not hidden", async () => {
    const stl = await exportStl(built(box({ width: 10, depth: 10, height: 10, wall: 0 })).shape);
    // Drop one side triangle: every layer's outline is broken there.
    const view = new DataView(stl);
    const n = view.getUint32(80, true);
    let side = -1;
    for (let t = 0; t < n && side < 0; t++) {
      const zs = [0, 1, 2].map((v) => view.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true));
      if (Math.max(...zs) - Math.min(...zs) > 5) side = t;
    }
    const broken = new Uint8Array(84 + (n - 1) * 50);
    broken.set(new Uint8Array(stl, 0, 84 + side * 50));
    broken.set(new Uint8Array(stl, 84 + (side + 1) * 50), 84 + side * 50);
    new DataView(broken.buffer).setUint32(80, n - 1, true);
    expect(sliceStl(broken.buffer, { layerHeight: 1 }).openEnds).toBeGreaterThan(0);
  });
});
