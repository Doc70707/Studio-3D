import { describe, expect, it } from "vitest";
import { STANDARD_VIEWS, boundsRadius, fitDistance, placeCamera, viewDirection, type Bounds } from "./views";

const plate: Bounds = { min: [-128, -128, 0], max: [128, 128, 0] };

describe("standard views", () => {
  it("every view direction is a unit vector", () => {
    for (const v of STANDARD_VIEWS) {
      const [x, y, z] = viewDirection(v);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("top looks straight down with +Y up on screen", () => {
    const c = placeCamera("top", plate, 45, 1.5);
    expect(c.position[0]).toBeCloseTo(0);
    expect(c.position[1]).toBeCloseTo(0);
    expect(c.position[2]).toBeGreaterThan(0);
    expect(c.up).toEqual([0, 1, 0]);
  });

  it("front camera sits on -Y, right camera on +X, both Z-up", () => {
    const f = placeCamera("front", plate, 45, 1.5);
    const r = placeCamera("right", plate, 45, 1.5);
    expect(f.position[1]).toBeLessThan(0);
    expect(r.position[0]).toBeGreaterThan(0);
    expect(f.up).toEqual([0, 0, 1]);
    expect(r.up).toEqual([0, 0, 1]);
  });

  it("targets the centre of the bounds", () => {
    const c = placeCamera("iso", { min: [0, 0, 0], max: [10, 20, 30] }, 45, 1);
    expect(c.target).toEqual([5, 10, 15]);
  });
});

describe("fitDistance", () => {
  it("keeps the whole bounding sphere inside the narrower field of view", () => {
    const r = boundsRadius(plate);
    for (const aspect of [0.5, 1, 2]) {
      const d = fitDistance(r, 45, aspect, 1);
      const vFov = (45 * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      // Angular radius of the sphere seen from distance d must not exceed half the tighter FOV.
      expect(Math.asin(r / d)).toBeLessThanOrEqual(Math.min(vFov, hFov) / 2 + 1e-12);
    }
  });

  it("portrait windows need a larger distance than landscape", () => {
    expect(fitDistance(100, 45, 0.5)).toBeGreaterThan(fitDistance(100, 45, 2));
  });

  it("handles empty bounds without returning NaN", () => {
    expect(fitDistance(0, 45, 1)).toBe(1);
  });
});
