// The order the nozzle draws each layer in: walls from the innermost out (so the outside wall is laid against
// walls already there), then the skin and infill lines. Written for Studio 3D: each next loop or line is simply the
// one that starts nearest to where the nozzle is, and a loop starts at its corner nearest the nozzle.

import type { SlicedLayer } from "./slicer";

export type PathRole = "outer-wall" | "inner-wall" | "skin" | "infill";

/** One stretch of printing without travelling: x, y pairs in order. A loop ends back at its start. */
export interface ToolPath {
  role: PathRole;
  points: number[];
}

/** Total length of a path's lines, mm. */
export function pathLength(path: ToolPath): number {
  const p = path.points;
  let total = 0;
  for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return total;
}

/** Orders one layer's walls and fill lines, starting from where the nozzle is. Returns the paths and where it ends. */
export function layerPaths(layer: SlicedLayer, from: [number, number]): { paths: ToolPath[]; end: [number, number] } {
  const paths: ToolPath[] = [];
  let at = from;
  for (let w = layer.walls.length - 1; w >= 0; w--) {
    const loops = layer.walls[w]!.slice();
    const role: PathRole = w === 0 ? "outer-wall" : "inner-wall";
    while (loops.length) {
      // The loop with the corner nearest the nozzle, started at that corner.
      let best = 0;
      let bestCorner = 0;
      let bestD = Infinity;
      loops.forEach((loop, i) => {
        for (let c = 0; c < loop.length; c += 2) {
          const d = (loop[c]! - at[0]) ** 2 + (loop[c + 1]! - at[1]) ** 2;
          if (d < bestD) [bestD, best, bestCorner] = [d, i, c];
        }
      });
      const loop = loops.splice(best, 1)[0]!;
      const points: number[] = [];
      for (let k = 0; k <= loop.length; k += 2) {
        const c = (bestCorner + k) % loop.length;
        points.push(loop[c]!, loop[c + 1]!);
      }
      paths.push({ role, points });
      at = [points[0]!, points[1]!];
    }
  }
  for (const [role, lines] of [
    ["skin", layer.solidLines],
    ["infill", layer.sparseLines],
  ] as const) {
    const left = new Set<number>();
    for (let i = 0; i < lines.length; i += 4) left.add(i);
    while (left.size) {
      // The line with an end nearest the nozzle, drawn from that end.
      let best = -1;
      let flip = false;
      let bestD = Infinity;
      for (const i of left) {
        const d1 = (lines[i]! - at[0]) ** 2 + (lines[i + 1]! - at[1]) ** 2;
        const d2 = (lines[i + 2]! - at[0]) ** 2 + (lines[i + 3]! - at[1]) ** 2;
        if (d1 < bestD) [bestD, best, flip] = [d1, i, false];
        if (d2 < bestD) [bestD, best, flip] = [d2, i, true];
      }
      left.delete(best);
      const [x1, y1, x2, y2] = [lines[best]!, lines[best + 1]!, lines[best + 2]!, lines[best + 3]!];
      const points = flip ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
      paths.push({ role, points });
      at = [points[2]!, points[3]!];
    }
  }
  return { paths, end: at };
}
