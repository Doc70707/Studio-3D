// Measurement lines for the 3D view: a line between two points, pushed out to the side so it doesn't sit
// on the part, with short lines back to the points it measures and a label in the middle.
import type { Vec3 } from "./views";

export interface Dimension {
  from: Vec3;
  to: Vec3;
  /** How far, and which way, the measurement line sits from the points it measures. */
  offset: Vec3;
  text: string;
  /** "part" for the overall size, "feature" for the selected shape or hole. */
  kind: "part" | "feature";
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Line segments (pairs of points) that draw a measurement: two extension lines and the measurement line. */
export function dimensionLines(d: Dimension): number[] {
  const a = add(d.from, d.offset);
  const b = add(d.to, d.offset);
  // Extension lines start a little way out from the part and run slightly past the measurement line.
  const ext = (p: Vec3, q: Vec3) => [...lerp(p, q, 0.15), ...lerp(p, q, 1.15)];
  return [...ext(d.from, a), ...ext(d.to, b), ...a, ...b];
}

/** Where the label goes: the middle of the measurement line. */
export const labelPoint = (d: Dimension): Vec3 => lerp(add(d.from, d.offset), add(d.to, d.offset), 0.5);

let fmt = (n: number) => `${Math.round(n * 100) / 100 + 0} mm`;

/** How sizes on the part are written (millimetres by default; the app passes its own for inches). */
export function setDimensionFormat(format: (mm: number) => string): void {
  fmt = format;
}

/**
 * The overall size of a part: width along the front edge, depth along the right edge and height up the
 * front-left corner, each set out from the part by a gap that grows with its size.
 */
export function partDimensions(min: Vec3, max: Vec3): Dimension[] {
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const gap = Math.max(6, size * 0.12);
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return [
    { from: [x0, y0, z0], to: [x1, y0, z0], offset: [0, -gap, 0], text: fmt(x1 - x0), kind: "part" },
    { from: [x1, y0, z0], to: [x1, y1, z0], offset: [gap, 0, 0], text: fmt(y1 - y0), kind: "part" },
    { from: [x0, y0, z0], to: [x0, y0, z1], offset: [-gap, 0, 0], text: fmt(z1 - z0), kind: "part" },
  ];
}
