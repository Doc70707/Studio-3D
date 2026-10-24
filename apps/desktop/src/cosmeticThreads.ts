// Where cosmetic threads are marked in the 3D view: a dashed circle at the thread's full size at the face where the
// hole starts and another where the thread ends, as CAD drawings show a thread that isn't modelled.
import { THREADS, currentFace, holeAxis, type ProjectDocument, type Vec3 } from "@studio3d/document";

const SEGMENTS = 48;

/** Line pairs (x, y, z) for every cosmetic thread in the design; empty when there are none. */
export function cosmeticThreadLines(doc: ProjectDocument, m: { min: number[]; max: number[] }): number[] {
  const out: number[] = [];
  for (const h of doc.features) {
    if (h.type !== "hole" || !h.thread || !h.simplified || !(h.thread in THREADS)) continue;
    const { point, direction } = h.face
      ? holeAxis(currentFace(doc, h.face), h.x, h.y)
      : { point: [h.x, h.y, m.max[2]] as Vec3, direction: [0, 0, -1] as Vec3 };
    // A through hole runs across the part's whole size in its direction.
    const across = direction.reduce((a, d, i) => a + Math.abs(d) * (m.max[i]! - m.min[i]!), 0);
    const deep = h.depth === 0 ? across : h.depth;
    const length = Math.min(h.threadDepth ?? deep, deep);
    const r = THREADS[h.thread].diameter / 2;
    const ref: Vec3 = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = unit(cross(direction, ref));
    const v = cross(direction, u);
    for (const along of [0, length]) {
      const c = point.map((p, i) => p + direction[i]! * along) as Vec3;
      for (let k = 0; k < SEGMENTS; k++)
        for (const t of [k, k + 1].map((j) => (j / SEGMENTS) * 2 * Math.PI))
          out.push(...c.map((p, i) => p + r * (Math.cos(t) * u[i]! + Math.sin(t) * v[i]!)));
    }
  }
  return out;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
