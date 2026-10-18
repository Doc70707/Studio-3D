import { describe, expect, it } from "vitest";
import { intersectLoops, offsetLoops, subtractLoops, unionLoops } from "./offset";
import { loopArea } from "./slice";

const rect = (x0: number, y0: number, x1: number, y1: number, hole = false) =>
  Float64Array.from(hole ? [x0, y0, x0, y1, x1, y1, x1, y0] : [x0, y0, x1, y0, x1, y1, x0, y1]);
const circle = (cx: number, cy: number, r: number, n = 180, hole = false) => {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((hole ? -1 : 1) * 2 * Math.PI * i) / n;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return Float64Array.from(pts);
};
/** Area of a regular polygon with n corners on a circle of radius r. */
const polygonArea = (n: number, r: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
const total = (loops: Float64Array[]) => loops.reduce((s, l) => s + loopArea(l), 0);
const bounds = (loops: Float64Array[]) => {
  const xs = loops.flatMap((l) => [...l].filter((_, i) => i % 2 === 0));
  const ys = loops.flatMap((l) => [...l].filter((_, i) => i % 2 === 1));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6);
};

describe("offsetting outlines", () => {
  it("a rectangle shrinks by the distance on every side, with square corners", () => {
    const [r] = offsetLoops([rect(0, 0, 60, 40)], 0.21) as [Float64Array];
    expect(r.length).toBe(8);
    expect(bounds([r])).toEqual([0.21, 0.21, 59.79, 39.79]);
    expect(loopArea(r)).toBeCloseTo(59.58 * 39.58, 9);
  });

  it("growing a rectangle rounds its corners: the area is the rectangle, the sides and a circle", () => {
    const grown = offsetLoops([rect(0, 0, 10, 4)], -1);
    expect(grown).toHaveLength(1);
    expect(bounds(grown)).toEqual([-1, -1, 11, 5]);
    // 40 + 2 × (10 + 4) × 1 + a circle of radius 1. Each round corner is a quarter of a 36-sided circle (one point
    // every 10°), so the four together make that polygon.
    expect(total(grown)).toBeCloseTo(40 + 28 + polygonArea(36, 1), 9);
  });

  it("a hole grows as the material around it shrinks", () => {
    const loops = offsetLoops([rect(0, 0, 30, 30), circle(15, 15, 4, 360, true)], 0.5);
    expect(loops.filter((l) => loopArea(l) > 0)).toHaveLength(1);
    expect(loops.filter((l) => loopArea(l) < 0)).toHaveLength(1);
    expect(total(loops)).toBeCloseTo(29 * 29 - Math.PI * 4.5 ** 2, 1);
  });

  it("a circle shrinks to the smaller circle", () => {
    const [c] = offsetLoops([circle(0, 0, 10, 360)], 2) as [Float64Array];
    // Each side of the 360-sided polygon moves in by exactly 2, so it is the same polygon with its sides 2 nearer the
    // centre.
    expect(loopArea(c)).toBeCloseTo(polygonArea(360, 10 - 2 / Math.cos(Math.PI / 360)), 9);
  });

  it("every point stays exactly the distance from the old outline: inside corners round, outside corners don't", () => {
    // An L: 20 × 20 with a 10 × 10 bite out of the top right. Its corner at (10, 10) points into the material.
    const l = Float64Array.from([0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20]);
    const quarter = polygonArea(36, 1) / 4; // a round corner: a quarter of a 36-sided circle
    const shrunk = offsetLoops([l], 1);
    expect(shrunk).toHaveLength(1);
    // 18 × 8 + 8 × 10, plus the corner square that the arc round (10, 10) leaves filled.
    expect(total(shrunk)).toBeCloseTo(224 + 1 - quarter, 9);
    const grown = offsetLoops([l], -1);
    expect(grown).toHaveLength(1);
    // The L, a 1 mm strip along its 80 mm outline (the strips overlap in one square at the inside corner), and five
    // round outside corners.
    expect(total(grown)).toBeCloseTo(300 + 80 - 1 + 5 * quarter, 9);
  });

  it("a part thinner than twice the distance vanishes, and a narrow neck splits in two", () => {
    expect(offsetLoops([rect(0, 0, 50, 0.8)], 0.42)).toEqual([]);
    // Two 10 × 10 squares joined by a 0.6 mm neck: shrinking by 0.42 leaves two squares.
    const dumbbell = Float64Array.from([
      0, 0, 10, 0, 10, 4.7, 15, 4.7, 15, 0, 25, 0, 25, 10, 15, 10, 15, 5.3, 10, 5.3, 10, 10, 0, 10,
    ]);
    const parts = offsetLoops([dumbbell], 0.42);
    expect(parts).toHaveLength(2);
    // Each square, with a sliver where the neck met it (the corners there are round, 0.42 from the neck's corners).
    for (const p of parts) {
      expect(loopArea(p)).toBeGreaterThan((10 - 0.84) ** 2);
      expect(loopArea(p)).toBeLessThan((10 - 0.84) ** 2 + 0.05);
    }
  });

  it("walls one inside another: each step is the line width further in", () => {
    let loops: Float64Array[] = [rect(0, 0, 20, 10)];
    for (let i = 1; i <= 3; i++) {
      loops = offsetLoops(loops, 0.42);
      expect(bounds(loops)).toEqual(
        [0.42 * i, 0.42 * i, 20 - 0.42 * i, 10 - 0.42 * i].map((v) => Math.round(v * 1e6) / 1e6),
      );
    }
  });

  // Timings depend on the machine (a shared CI runner was 40% slower), so like perf.test.ts this runs with PERF=1.
  (process.env.PERF === "1" ? it : it.skip)("is quick enough for every wall of every layer", () => {
    const loops = [circle(0, 0, 40, 2000), circle(0, 0, 30, 2000, true), circle(20, 0, 3, 200, true)];
    const t = performance.now();
    for (let i = 0; i < 20; i++) offsetLoops(loops, 0.42);
    expect((performance.now() - t) / 20).toBeLessThan(100);
  });
});

describe("adding, overlapping and taking away areas", () => {
  const a = [rect(0, 0, 10, 10)];
  const b = [rect(5, 5, 15, 15)];
  it("union, intersection and difference of two overlapping squares", () => {
    expect(total(unionLoops(a, b))).toBeCloseTo(175, 9);
    expect(bounds(intersectLoops(a, b))).toEqual([5, 5, 10, 10]);
    expect(total(intersectLoops(a, b))).toBeCloseTo(25, 9);
    expect(total(subtractLoops(a, b))).toBeCloseTo(75, 9);
    expect(subtractLoops(a, b)).toHaveLength(1);
  });

  it("taking away a smaller area inside leaves a hole; areas that don't touch don't overlap", () => {
    const framed = subtractLoops(a, [rect(2, 2, 8, 8)]);
    expect(framed.map(loopArea).sort((x, y) => x - y)).toEqual([-36, 100].map((v) => expect.closeTo(v, 9)));
    expect(intersectLoops(a, [rect(20, 0, 30, 10)])).toEqual([]);
    expect(subtractLoops(a, a)).toEqual([]);
  });

  it("works with holes in the inputs", () => {
    const ring = [rect(0, 0, 10, 10), rect(3, 3, 7, 7, true)];
    // A bar across the ring: only the parts over material count.
    expect(total(intersectLoops(ring, [rect(-1, 4, 11, 6)]))).toBeCloseTo(2 * 3 * 2, 9);
    expect(total(subtractLoops(ring, [rect(-1, 4, 11, 6)]))).toBeCloseTo(84 - 12, 9);
  });
});
