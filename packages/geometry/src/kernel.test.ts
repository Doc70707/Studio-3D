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
  type OpenSide,
  PLATE_PLANE,
  offsetProfile,
  newSketch,
  toWorld,
  type Feature,
  type FaceOutline,
  type Profile,
  type SketchFeature,
} from "@studio3d/document";
import { checkBinaryStl } from "./stl-check";
import { measureVolume } from "replicad";

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
    const owners = faceOwners(mesh, r.pieces!, doc);
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
