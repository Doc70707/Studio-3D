// Camera math for the standard views. Pure functions, so they are unit-testable without WebGL.
// Convention: Z is up (like slicers and most CAD tools) and units are millimetres.

export type Vec3 = readonly [number, number, number];

export type StandardView = "top" | "bottom" | "front" | "back" | "left" | "right" | "iso";

export const STANDARD_VIEWS: readonly StandardView[] = ["top", "bottom", "front", "back", "left", "right", "iso"];

/** Perspective shows depth (far things smaller); orthographic keeps parallel edges parallel, like a drawing. */
export type Projection = "perspective" | "orthographic";

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface CameraPlacement {
  position: Vec3;
  target: Vec3;
  up: Vec3;
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Unit vector pointing from the target towards the camera. */
export function viewDirection(view: StandardView): Vec3 {
  switch (view) {
    case "top":
      return [0, 0, 1];
    case "bottom":
      return [0, 0, -1];
    case "front":
      return [0, -1, 0];
    case "back":
      return [0, 1, 0];
    case "left":
      return [-1, 0, 0];
    case "right":
      return [1, 0, 0];
    case "iso":
      return normalize([1, -1, 1]);
  }
}

/**
 * Which way is up on screen. Looking straight down or up Z needs a different "up" so the camera isn't degenerate;
 * from below, the front is at the top so that left and right stay the right way round.
 */
export function viewUp(view: StandardView): Vec3 {
  if (view === "top") return [0, 1, 0];
  if (view === "bottom") return [0, -1, 0];
  return [0, 0, 1];
}

export function boundsCenter(b: Bounds): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function boundsRadius(b: Bounds): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
}

/**
 * Distance at which a sphere of `radius` fits inside a perspective camera's view,
 * whichever of the vertical or horizontal field of view is tighter.
 */
export function fitDistance(radius: number, verticalFovDeg: number, aspect: number, margin = 1.1): number {
  if (!(radius > 0)) return 1;
  const vFov = (verticalFovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const limiting = Math.min(vFov, hFov);
  return (radius * margin) / Math.sin(limiting / 2);
}

export function placeCamera(view: StandardView, bounds: Bounds, verticalFovDeg: number, aspect: number): CameraPlacement {
  const target = boundsCenter(bounds);
  const d = fitDistance(boundsRadius(bounds), verticalFovDeg, aspect);
  const dir = viewDirection(view);
  return {
    target,
    position: [target[0] + dir[0] * d, target[1] + dir[1] * d, target[2] + dir[2] * d],
    up: viewUp(view),
  };
}

/**
 * Half the height of what an orthographic camera shows so that, at the target, it frames exactly what a
 * perspective camera with this field of view shows from `distance` away. Switching projection then keeps the part
 * the same size on screen.
 */
export function orthoHalfHeight(distance: number, verticalFovDeg: number): number {
  return distance * Math.tan((verticalFovDeg * Math.PI) / 360);
}

/** The distance a perspective camera needs to show what an orthographic one shows (half-height / zoom). */
export function perspectiveDistance(halfHeight: number, zoom: number, verticalFovDeg: number): number {
  return halfHeight / zoom / Math.tan((verticalFovDeg * Math.PI) / 360);
}
