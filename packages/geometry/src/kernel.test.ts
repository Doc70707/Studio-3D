// Real-geometry tests: the actual OCCT WebAssembly kernel, no mocks.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import {
  DEFAULT_BOX,
  boxOf,
  newDocument,
  parseProject,
  serializeProject,
  type BoxFeature,
  type HoleFeature,
  type ProjectDocument,
} from "@studio3d/document";
import { buildBox, buildDocument, expectedBoxVolume, exportStl, maxHoleVolume, tessellate, useKernel } from "./kernel";
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
    doc.features[0] = { ...boxOf(doc), width: 73.5, depth: 41.25, height: 19, wall: 1.6 };
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
  x: 30,
  y: 20,
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
      hole({ x: 8, y: 8, diameter: 4 }),
      hole({ x: 52, y: 8, diameter: 4 }),
      hole({ x: 30, y: 30, diameter: 8, depth: 20 }),
    ];
    const r = designed(design(box({ wall: 0 }), ...holes));
    expect(rel(r.measurements.volume, 72000 - 2 * cyl(4, 30) - cyl(8, 20))).toBeLessThan(1e-9);
  });

  it("a hole drilled into a side wall of a container cuts through the wall", () => {
    // 60 × 40 × 30, walls 2: a 3 mm hole centred in the left wall (x = 1) only cuts wall material.
    const b = box({ wall: 2 });
    const h = hole({ x: 1.6, y: 20, diameter: 3, depth: 10 });
    const r = designed(design(b, h));
    expect(r.measurements.volume).toBeLessThan(15552);
    expect(15552 - r.measurements.volume).toBeLessThanOrEqual(maxHoleVolume(h, b) * (1 + 1e-9));
    expect(r.issues.some((i) => i.severity === "warning")).toBe(true); // only 0.1 mm left at the edge
  });

  it("a hole that only goes into the empty inside is built, with a plain warning", () => {
    const r = designed(design(box({ wall: 2 }), hole({ depth: 5 })));
    expect(r.measurements.volume).toBeCloseTo(15552, 6);
    expect(r.issues[0]?.message).toContain("doesn't cut anything");
  });

  it("holes that run off the edge, are too deep or too small are refused before the kernel", () => {
    for (const [h, text] of [
      [hole({ x: 2, diameter: 10 }), "runs off the left edge"],
      [hole({ y: 39, diameter: 4 }), "runs off the back edge"],
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
    const doc = design(box({ wall: 0 }), hole({ diameter: 7.5, x: 12.25 }), hole({ depth: 9 }));
    const reopened = parseProject(serializeProject(doc, { name: "Studio 3D", version: "test" }));
    if (!reopened.ok) throw new Error(reopened.error);
    expect(reopened.document).toEqual(doc);
    expect(designed(reopened.document).measurements).toEqual(designed(doc).measurements);
  });

  it("exports a watertight STL with the holes in it", async () => {
    const b = box({ width: 50, depth: 30, height: 20, wall: 0 });
    const doc = design(b, hole({ x: 10, y: 15, diameter: 6 }), hole({ x: 35, y: 15, diameter: 10, depth: 8 }));
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

describe("STL checker itself", () => {
  it("notices a missing triangle", async () => {
    const stl = await exportStl(built(box({ wall: 0 })).shape);
    const n = new DataView(stl).getUint32(80, true);
    const cut = stl.slice(0, 84 + (n - 1) * 50);
    new DataView(cut).setUint32(80, n - 1, true);
    expect(checkBinaryStl(cut).watertight).toBe(false);
  });
});
