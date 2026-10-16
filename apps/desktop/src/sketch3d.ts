// Showing a sketch in the 3D view: its outlines as lines on the face, and a good angle to look from.
import {
  add3,
  cross,
  normalize,
  profileBounds,
  scale,
  toWorld,
  type Point2,
  type SketchFeature,
  type Vec3,
} from "@studio3d/document";
import type { SketchDraft } from "./SketchEditor";

/** The outlines as pairs of 3D points, lifted a hair off the face so they aren't hidden by it. */
export function sketchLines(s: SketchFeature): Float32Array {
  const out: number[] = [];
  const lift = 0.05;
  const loop = (pts: Point2[]) =>
    pts.forEach((p, i) =>
      out.push(
        ...toWorld(s.plane, p, lift),
        ...toWorld(s.plane, pts[(i + 1) % pts.length]!, lift),
      ),
    );
  for (const p of s.profiles) {
    if (p.kind === "rectangle")
      loop([
        [p.x, p.y],
        [p.x + p.width, p.y],
        [p.x + p.width, p.y + p.height],
        [p.x, p.y + p.height],
      ]);
    else if (p.kind === "circle")
      loop(
        Array.from(
          { length: 64 },
          (_, i): Point2 => [
            p.x + (p.diameter / 2) * Math.cos((i / 32) * Math.PI),
            p.y + (p.diameter / 2) * Math.sin((i / 32) * Math.PI),
          ],
        ),
      );
    else loop(p.points);
  }
  return new Float32Array(out);
}

/** Looking at the sketch from in front of the face, a little above and to the side, so its depth reads. */
export function sketchViewpoint(d: SketchDraft): {
  target: Vec3;
  direction: Vec3;
  size: number;
} {
  let [x0, y0, x1, y1] = d.face ? [0, 0, d.face.width, d.face.height] : d.area;
  for (const p of d.feature.profiles) {
    const b = profileBounds(p);
    [x0, y0, x1, y1] = [
      Math.min(x0, b[0]),
      Math.min(y0, b[1]),
      Math.max(x1, b[2]),
      Math.max(y1, b[3]),
    ];
  }
  const { plane } = d.feature;
  const target = toWorld(plane, [(x0 + x1) / 2, (y0 + y1) / 2]);
  const yDir = cross(plane.normal, plane.xDir);
  const direction = normalize(
    add3(
      add3(scale(plane.normal, 2), scale(yDir, -0.8)),
      scale(plane.xDir, 0.5),
    ),
  );
  return { target, direction, size: Math.max(x1 - x0, y1 - y0) * 1.4 };
}
