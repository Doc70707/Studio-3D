// Filling the inside of a layer with straight lines: closely spaced for the solid top and bottom skins, further apart
// for the sparse infill in between. Written for Studio 3D: each line across the area is cut where it crosses the
// outlines, and the pieces inside the material are kept (outsides and holes wind in opposite directions, so a point
// is inside when an odd number of outline crossings lie to its left).

import type { Loop } from "./slice";

/** Line pieces, four numbers each: x1, y1, x2, y2. */
export type Lines = Float64Array;

/**
 * Parallel lines `spacing` apart at `angle` degrees, clipped to the area. Lines sit on a fixed grid through the
 * origin, so the same settings give the same lines on every layer. Pieces shorter than `minLength` are left out.
 */
export function fillLines(area: Loop[], spacing: number, angle: number, minLength = 0): Lines {
  if (!(spacing > 0)) throw new Error("Infill lines need a spacing above 0 mm.");
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Turn the area so the lines run along x: u = along the line, v = across.
  const edges: number[] = [];
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const loop of area) {
    const n = loop.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [x1, y1, x2, y2] = [loop[2 * i]!, loop[2 * i + 1]!, loop[2 * j]!, loop[2 * j + 1]!];
      const v1 = -s * x1 + c * y1;
      const v2 = -s * x2 + c * y2;
      edges.push(c * x1 + s * y1, v1, c * x2 + s * y2, v2);
      vMin = Math.min(vMin, v1, v2);
      vMax = Math.max(vMax, v1, v2);
    }
  }
  const out: number[] = [];
  for (let k = Math.ceil(vMin / spacing); k * spacing <= vMax; k++) {
    // Nudged off the grid by a hair so a line never runs exactly through a corner of the outline.
    const v = k * spacing + 1e-7;
    const us: number[] = [];
    for (let e = 0; e < edges.length; e += 4) {
      const va = edges[e + 1]!;
      const vb = edges[e + 3]!;
      if (va <= v === vb <= v) continue;
      const t = (v - va) / (vb - va);
      us.push(edges[e]! + t * (edges[e + 2]! - edges[e]!));
    }
    us.sort((p, q) => p - q);
    for (let i = 0; i + 1 < us.length; i += 2) {
      const u1 = us[i]!;
      const u2 = us[i + 1]!;
      if (u2 - u1 < minLength) continue;
      const vv = k * spacing;
      out.push(c * u1 - s * vv, s * u1 + c * vv, c * u2 - s * vv, s * u2 + c * vv);
    }
  }
  return Float64Array.from(out);
}

/** Total length of line pieces, mm. */
export function linesLength(lines: Lines): number {
  let total = 0;
  for (let i = 0; i < lines.length; i += 4)
    total += Math.hypot(lines[i + 2]! - lines[i]!, lines[i + 3]! - lines[i + 1]!);
  return total;
}
