// Measurements for the selected shape or hole in the 3D view, so it's clear where it sits on the part.
import { shapeSize, type Feature } from "@studio3d/document";
import type { Dimension, Vec3 } from "@studio3d/viewport";

const fmt = (n: number) => `${Math.round(n * 100) / 100 + 0} mm`;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * For a shape: its own width, depth and height, and how far its left and front sides are from the part's.
 * For a hole: its diameter on the top face, and how far its centre is from the part's left and front edges.
 * Distances that are 0 are left out, and a shape that is the whole part adds nothing to the overall size.
 */
export function featureDimensions(f: Feature, part: { min: Vec3; max: Vec3 }): Dimension[] {
  const [px0, py0] = part.min;
  const size = Math.max(...part.max.map((v, i) => v - part.min[i]!));
  const gap = Math.max(4, size * 0.06);
  const out: Dimension[] = [];
  const dim = (from: Vec3, to: Vec3, offset: Vec3, text: string) =>
    out.push({ from, to, offset, text, kind: "feature" });

  if (f.type === "hole") {
    const top = part.max[2];
    const r = f.diameter / 2;
    dim([f.x - r, f.y, top], [f.x + r, f.y, top], [0, 0, gap * 0.5], `Ø${fmt(f.diameter)}`);
    if (!near(f.x, px0)) dim([px0, f.y, top], [f.x, f.y, top], [0, 0, 0.01], fmt(f.x - px0));
    if (!near(f.y, py0)) dim([f.x, py0, top], [f.x, f.y, top], [0, 0, 0.01], fmt(f.y - py0));
    return out;
  }
  if (f.type === "sketch") return out;

  const [w, d, h] = shapeSize(f);
  const x0 = f.x - w / 2;
  const y0 = f.y - d / 2;
  const z0 = f.z;
  const whole =
    near(x0, part.min[0]) &&
    near(y0, part.min[1]) &&
    near(z0, part.min[2]) &&
    near(x0 + w, part.max[0]) &&
    near(y0 + d, part.max[1]) &&
    near(z0 + h, part.max[2]);
  if (whole) return out;
  dim([x0, y0, z0 + h], [x0 + w, y0, z0 + h], [0, -gap, 0], fmt(w));
  dim([x0 + w, y0, z0 + h], [x0 + w, y0 + d, z0 + h], [gap, 0, 0], fmt(d));
  dim([x0, y0, z0], [x0, y0, z0 + h], [-gap, 0, 0], fmt(h));
  if (!near(x0, px0)) dim([px0, y0, z0], [x0, y0, z0], [0, 0, 0.01], fmt(x0 - px0));
  if (!near(y0, py0)) dim([x0, py0, z0], [x0, y0, z0], [0, 0, 0.01], fmt(y0 - py0));
  if (z0 > 0.005) dim([x0, y0, 0], [x0, y0, z0], [0, 0, 0], fmt(z0));
  return out;
}
