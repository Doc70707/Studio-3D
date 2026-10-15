// Real-geometry tests: the actual OCCT WebAssembly kernel, no mocks.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import { DEFAULT_BOX, newDocument, parseProject, serializeProject, type BoxFeature } from "@studio3d/document";
import { buildBox, buildDocument, expectedBoxVolume, exportStl, tessellate, useKernel } from "./kernel";
import { checkBinaryStl } from "./stl-check";

const require = createRequire(import.meta.url);
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const box = (over: Partial<BoxFeature> = {}): BoxFeature => ({ id: "b1", ...DEFAULT_BOX, ...over });

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => require.resolve("replicad-opencascadejs/wasm"), print: () => {}, printErr: () => {} });
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
    doc.features[0] = { ...doc.features[0]!, width: 73.5, depth: 41.25, height: 19, wall: 1.6 };
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
    writeFileSync(`${OUT}${name}.expected.json`, JSON.stringify({ volume: expectedBoxVolume(b), size: [b.width, b.depth, b.height] }));

    const report = checkBinaryStl(stl);
    expect(report.watertight).toBe(true);
    expect(report.consistentWinding).toBe(true);
    expect(report.max[0] - report.min[0]).toBeCloseTo(b.width, 4);
    expect(report.max[1] - report.min[1]).toBeCloseTo(b.depth, 4);
    expect(report.max[2] - report.min[2]).toBeCloseTo(b.height, 4);
    expect(Math.abs(report.volume - expectedBoxVolume(b)) / expectedBoxVolume(b)).toBeLessThan(0.005);
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
