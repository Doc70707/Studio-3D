import { describe, expect, it } from "vitest";
import { dimensionLines, labelPoint, partDimensions } from "./dimensions";

describe("part measurements", () => {
  const dims = partDimensions([-30, -20, 0], [30, 20, 30]);

  it("labels width, depth and height with their exact sizes", () => {
    expect(dims.map((d) => d.text)).toEqual(["60 mm", "40 mm", "30 mm"]);
  });

  it("sets the lines out from the part so they don't sit on it", () => {
    const [width, depth] = dims;
    expect(labelPoint(width!)[1]).toBeLessThan(-20); // in front of the front face
    expect(labelPoint(depth!)[0]).toBeGreaterThan(30); // right of the right face
  });

  it("each measurement is two extension lines and the line itself", () => {
    const pts = dimensionLines(dims[0]!);
    expect(pts.length).toBe(3 * 2 * 3);
    // The measurement line runs exactly the measured length.
    const [ax, ay, az, bx, by, bz] = pts.slice(12);
    expect(Math.hypot(bx! - ax!, by! - ay!, bz! - az!)).toBeCloseTo(60, 9);
  });

  it("rounds labels to a hundredth of a millimetre", () => {
    expect(partDimensions([0, 0, 0], [12.3456, 1, 1])[0]!.text).toBe("12.35 mm");
  });
});
