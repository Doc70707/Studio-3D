// Camera math for the standard views. Pure functions, so they are unit-testable without WebGL.
// Convention: Z is up (like slicers and most CAD tools) and units are millimetres.

export type Vec3 = readonly [number, number, number];

export type StandardView = "top" | "front" | "right" | "iso";

export const STANDARD_VIEWS: readonly StandardView[] = [
  "top",
  "front",
  "right",
  "iso",
];

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
    case "front":
      return [0, -1, 0];
    case "right":
      return [1, 0, 0];
    case "iso":
      return normalize([1, -1, 1]);
  }
}

/** Looking straight down Z needs a different "up" so the camera isn't degenerate. */
export function viewUp(view: StandardView): Vec3 {
  return view === "top" ? [0, 1, 0] : [0, 0, 1];
}

export function boundsCenter(b: Bounds): Vec3 {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

export function boundsRadius(b: Bounds): number {
  return (
    Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) /
    2
  );
}

/**
 * Distance at which a sphere of `radius` fits inside a perspective camera's view,
 * whichever of the vertical or horizontal field of view is tighter.
 */
export function fitDistance(
  radius: number,
  verticalFovDeg: number,
  aspect: number,
  margin = 1.1,
): number {
  if (!(radius > 0)) return 1;
  const vFov = (verticalFovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const limiting = Math.min(vFov, hFov);
  return (radius * margin) / Math.sin(limiting / 2);
}

export function placeCamera(
  view: StandardView,
  bounds: Bounds,
  verticalFovDeg: number,
  aspect: number,
): CameraPlacement {
  const target = boundsCenter(bounds);
  const d = fitDistance(boundsRadius(bounds), verticalFovDeg, aspect);
  const dir = viewDirection(view);
  return {
    target,
    position: [
      target[0] + dir[0] * d,
      target[1] + dir[1] * d,
      target[2] + dir[2] * d,
    ],
    up: viewUp(view),
  };
}
