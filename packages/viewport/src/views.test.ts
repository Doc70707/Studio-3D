import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  STANDARD_VIEWS,
  boundsRadius,
  fitDistance,
  orthoHalfHeight,
  perspectiveDistance,
  placeCamera,
  viewDirection,
  type Bounds,
} from "./views";

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

describe("all six sides and the iso view", () => {
  it("has seven views, and each side's opposite looks the other way", () => {
    expect(STANDARD_VIEWS).toEqual(["top", "bottom", "front", "back", "left", "right", "iso"]);
    const pairs = [
      ["top", "bottom"],
      ["front", "back"],
      ["left", "right"],
    ] as const;
    for (const [a, b] of pairs) {
      const da = viewDirection(a);
      const db = viewDirection(b);
      for (let i = 0; i < 3; i++) expect(da[i]! + db[i]!).toBeCloseTo(0, 12);
    }
  });

  it("bottom looks up from under the plate, back from +Y and left from -X", () => {
    const b = placeCamera("bottom", plate, 45, 1.5);
    expect(b.position[2]).toBeLessThan(0);
    expect(b.up).toEqual([0, -1, 0]);
    expect(placeCamera("back", plate, 45, 1.5).position[1]).toBeGreaterThan(0);
    expect(placeCamera("left", plate, 45, 1.5).position[0]).toBeLessThan(0);
  });

  it("every view's up direction is square to the way it looks", () => {
    for (const v of STANDARD_VIEWS) {
      const c = placeCamera(v, plate, 45, 1.5);
      const [px, py, pz] = c.position;
      const [tx, ty, tz] = c.target;
      const dot = (px - tx) * c.up[0] + (py - ty) * c.up[1] + (pz - tz) * c.up[2];
      if (v !== "iso") expect(Math.abs(dot)).toBeLessThan(1e-9);
    }
  });
});

describe("switching between perspective and orthographic", () => {
  it("shows the same height at the target, both ways round", () => {
    for (const d of [10, 250, 4000]) {
      const half = orthoHalfHeight(d, 45);
      expect(half).toBeCloseTo(d * Math.tan(Math.PI / 8), 9);
      expect(perspectiveDistance(half, 1, 45)).toBeCloseTo(d, 9);
      // Zooming the orthographic view in 2x means coming twice as close when switching back.
      expect(perspectiveDistance(half, 2, 45)).toBeCloseTo(d / 2, 9);
    }
  });

  it("an orthographic camera keeps parallel edges parallel; perspective does not", () => {
    type P = [number, number, number];
    const project = (camera: THREE.Camera, p: P) => new THREE.Vector3(...p).project(camera);
    // Two parallel 10 mm edges running away from the camera, one near the middle and one off to the side.
    const near: [P, P] = [
      [0, -5, 0],
      [0, 5, 0],
    ];
    const side: [P, P] = [
      [40, -5, 0],
      [40, 5, 0],
    ];
    const slope = (camera: THREE.Camera, [p, q]: [P, P]) => {
      const a = project(camera, p);
      const b = project(camera, q);
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const place = (camera: THREE.Camera) => {
      camera.up.set(0, 0, 1);
      camera.position.set(-60, -200, 120);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    };
    const persp = new THREE.PerspectiveCamera(45, 1.5, 0.1, 2000);
    place(persp);
    const half = orthoHalfHeight(persp.position.length(), 45);
    const ortho = new THREE.OrthographicCamera(-half * 1.5, half * 1.5, half, -half, 0.1, 4000);
    place(ortho);
    expect(slope(ortho, near)).toBeCloseTo(slope(ortho, side), 9);
    expect(Math.abs(slope(persp, near) - slope(persp, side))).toBeGreaterThan(0.01);
  });
});
