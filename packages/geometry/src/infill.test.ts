import { describe, expect, it } from "vitest";
import { fillLines, linesLength } from "./infill";

const rect = (x0: number, y0: number, x1: number, y1: number, hole = false) =>
  Float64Array.from(hole ? [x0, y0, x0, y1, x1, y1, x1, y0] : [x0, y0, x1, y0, x1, y1, x0, y1]);

describe("fill lines", () => {
  it("lines across a square, one spacing apart, each the square's width", () => {
    const lines = fillLines([rect(0, 0, 10, 10)], 1, 0);
    expect(lines.length / 4).toBe(10);
    for (let i = 0; i < lines.length; i += 4) {
      expect(lines[i + 1]).toBe(lines[i + 3]); // straight across
      expect(lines[i + 2]! - lines[i]!).toBeCloseTo(10, 9);
    }
  });

  it("at any angle, the lines' total length is the area over the spacing", () => {
    for (const angle of [45, 135, 30, 90]) {
      expect(linesLength(fillLines([rect(0, 0, 20, 10)], 0.5, angle))).toBeCloseTo(200 / 0.5, -1);
    }
  });

  it("lines stop at holes and start again past them", () => {
    const lines = fillLines([rect(0, 0, 10, 10), rect(3, 3, 7, 7, true)], 1, 0);
    expect(linesLength(lines)).toBeCloseTo(100 - 4 * 4, 9);
    // The lines through the hole are in two pieces.
    expect(lines.length / 4).toBe(10 + 4);
  });

  it("the same settings put lines in the same places on every layer, whatever the outline", () => {
    const a = fillLines([rect(0, 0, 10, 10)], 2, 0);
    const b = fillLines([rect(1, 1, 9, 9)], 2, 0);
    const ys = (l: Float64Array) => [...l].filter((_, i) => i % 4 === 1);
    expect(ys(b).every((y) => ys(a).includes(y))).toBe(true);
  });

  it("leaves out pieces shorter than asked", () => {
    expect(fillLines([rect(0, 0, 0.3, 10)], 0.4, 0, 0.42).length).toBe(0);
  });
});
