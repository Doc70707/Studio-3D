import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { blendPose, settled, springProgress } from "./glide";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("camera glide", () => {
  it("eases in from rest, never overshoots, and settles in about half a second", () => {
    expect(springProgress(0)).toBe(0);
    let last = 0;
    for (let t = 0.01; t < 2; t += 0.01) {
      const p = springProgress(t);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThan(1);
      last = p;
    }
    expect(springProgress(0.02)).toBeLessThan(0.05); // starts gently
    expect(settled(springProgress(0.4))).toBe(false);
    expect(settled(springProgress(0.75))).toBe(true);
  });

  it("swings round the look-at point at the same distance instead of cutting through the part", () => {
    const front = { position: v(0, -100, 0), target: v(0, 0, 0), up: v(0, 0, 1) };
    const right = { position: v(100, 0, 0), target: v(0, 0, 0), up: v(0, 0, 1) };
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const p = blendPose(front, right, k);
      expect(p.position.length()).toBeCloseTo(100, 6);
      expect(p.up.z).toBeCloseTo(1, 6); // stays upright the whole way
    }
    const half = blendPose(front, right, 0.5).position;
    expect(half.x).toBeCloseTo(100 * Math.SQRT1_2, 6);
    expect(half.y).toBeCloseTo(-100 * Math.SQRT1_2, 6);
  });

  it("ends exactly on the new view, sliding the look-at point and changing the distance", () => {
    const a = { position: v(0, -50, 0), target: v(0, 0, 0), up: v(0, 0, 1) };
    const b = { position: v(10, 0, 200), target: v(10, 0, 0), up: v(0, 1, 0) };
    const end = blendPose(a, b, 1);
    expect(end.position.distanceTo(b.position)).toBeLessThan(1e-6);
    expect(end.target.distanceTo(b.target)).toBeLessThan(1e-9);
    expect(end.up.distanceTo(b.up)).toBeLessThan(1e-6);
    expect(blendPose(a, b, 0.5).position.distanceTo(blendPose(a, b, 0.5).target)).toBeCloseTo(125, 6);
  });
});
