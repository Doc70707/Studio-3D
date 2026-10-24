// Walls (perimeters): the lines the nozzle draws round each layer's outlines, one line width apart, before anything
// fills the inside. Each wall's path is the outline moved inwards by half a line width, plus a line width per wall
// further in, so the outside of the first line sits exactly on the part's surface.

import { offsetLoops } from "./offset";
import { loopArea, type Layer, type Loop } from "./slice";

export interface WallOptions {
  /** How many walls, 1 or more. */
  count: number;
  /** Width of one printed line, mm. */
  lineWidth: number;
}

export interface LayerWalls {
  /** The nozzle's path for each wall, outermost first. A wall can be missing where the part is too thin for it. */
  walls: Loop[][];
  /** What's left inside the walls, to be filled. */
  inside: Loop[];
  /** Material no line reaches: places thinner than one line width. mm². */
  missed: number;
}

/** Less than this much material missed in a layer is only the round corners lines make, not a thin part. */
export const MISSED_TOLERANCE_MM2 = 0.1;

export function layerWalls(layer: Layer, options: WallOptions): LayerWalls {
  const w = options.lineWidth;
  if (!(w > 0) || !(options.count >= 1)) throw new Error("Walls need a line width and at least one wall.");
  const walls: Loop[][] = [];
  // A wall path enclosing less than a line's width squared would be a blob of plastic, not a line: in a corner where
  // two walls nearly meet there's often room for a speck of one more. It's left out.
  for (let i = 0; i < options.count; i++)
    walls.push(offsetLoops(layer.loops, w / 2 + i * w).filter((l) => Math.abs(loopArea(l)) >= w * w));
  const inside = offsetLoops(layer.loops, options.count * w);
  // What the first wall's line covers, grown back out by half a line: the material any line can reach.
  const reached = offsetLoops(walls[0]!, -w / 2);
  const area = (loops: Loop[]) => loops.reduce((s, l) => s + loopArea(l), 0);
  return { walls, inside, missed: Math.max(0, area(layer.loops) - area(reached)) };
}
