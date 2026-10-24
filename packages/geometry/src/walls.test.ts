import { describe, expect, it } from "vitest";
import { MISSED_TOLERANCE_MM2, layerWalls } from "./walls";
import { loopArea, type Layer } from "./slice";

const layer = (...loops: number[][]): Layer => {
  const l = loops.map((p) => Float64Array.from(p));
  return { bottom: 0, top: 0.2, z: 0.1, loops: l, area: l.reduce((s, x) => s + loopArea(x), 0) };
};
const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
const hole = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x0, y1, x1, y1, x1, y0];
const box = (loops: Float64Array[]) => {
  const xs = loops.flatMap((l) => [...l].filter((_, i) => i % 2 === 0));
  const ys = loops.flatMap((l) => [...l].filter((_, i) => i % 2 === 1));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6);
};
const area = (loops: Float64Array[]) => loops.reduce((s, l) => s + loopArea(l), 0);

describe("walls", () => {
  it("the first wall's line sits half a line in, so its outside edge is the part's surface", () => {
    const r = layerWalls(layer(rect(0, 0, 60, 40)), { count: 3, lineWidth: 0.42 });
    expect(r.walls.map(box)).toEqual([
      [0.21, 0.21, 59.79, 39.79],
      [0.63, 0.63, 59.37, 39.37],
      [1.05, 1.05, 58.95, 38.95],
    ]);
    expect(box(r.inside)).toEqual([1.26, 1.26, 58.74, 38.74]);
    // Only the tiny round corners the line makes are missed.
    expect(r.missed).toBeLessThan(MISSED_TOLERANCE_MM2);
  });

  it("a 2 mm wall of a container gets two walls each side of it and a strip to fill between", () => {
    const r = layerWalls(layer(rect(0, 0, 60, 40), hole(2, 2, 58, 38)), { count: 2, lineWidth: 0.42 });
    for (const w of r.walls) expect(w).toHaveLength(2); // round the outside and round the hole
    // The hole's wall goes round it in the material, outside the hole.
    expect(box([r.walls[0]![1]!])).toEqual([1.79, 1.79, 58.21, 38.21]);
    // The strip left inside is 2 − 4 × 0.42 = 0.32 mm wide all round. Its inner corners stay 0.84 mm from the hole's
    // corners, so they are round: each fills a 0.84 mm square less a quarter circle (a quarter of a 36-sided one).
    const quarter = ((36 / 2) * 0.84 ** 2 * Math.sin((2 * Math.PI) / 36)) / 4;
    const holeArea = (56 + 1.68) * (36 + 1.68) - 4 * (0.84 ** 2 - quarter);
    expect(area(r.inside)).toBeCloseTo((60 - 1.68) * (40 - 1.68) - holeArea, 9);
    expect(r.missed).toBeLessThan(MISSED_TOLERANCE_MM2);
  });

  it("where the part is too thin for another wall, that wall is left out", () => {
    // 1 mm wide: room for two 0.42 mm lines, not three.
    const r = layerWalls(layer(rect(0, 0, 20, 1)), { count: 3, lineWidth: 0.42 });
    expect(r.walls[0]).toHaveLength(1);
    expect(r.walls[1]).toHaveLength(0);
    expect(r.walls[2]).toHaveLength(0);
    expect(r.inside).toHaveLength(0);
  });

  it("a fin thinner than one line can't be printed, and says how much is missed", () => {
    const r = layerWalls(layer(rect(0, 0, 10, 10), rect(20, 0, 30, 0.3)), { count: 2, lineWidth: 0.42 });
    expect(r.walls[0]).toHaveLength(1); // only the square gets a wall
    expect(r.missed).toBeCloseTo(3, 1);
  });
});

describe("walls in corners", () => {
  it("a speck of wall where a frame's corner has a little more room is left out", () => {
    // A 2 mm frame: two 0.42 mm walls from each side fit; a third doesn't, except for specks in the four corners.
    const r = layerWalls(layer(rect(0, 0, 60, 40), hole(2, 2, 58, 38)), { count: 3, lineWidth: 0.42 });
    expect(r.walls.map((w) => w.length)).toEqual([2, 2, 0]);
  });
});
