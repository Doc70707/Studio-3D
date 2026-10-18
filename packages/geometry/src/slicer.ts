// Studio 3D's own slicer: the whole part, layer by layer. Runs in its own worker (slicer.worker.ts) because a
// curved part takes seconds; `slicePart` itself is plain code, tested directly.

import { fillLines, type Lines } from "./infill";
import { intersectLoops, offsetLoops, subtractLoops } from "./offset";
import { loopArea, sliceStl, type Layer, type Loop } from "./slice";
import { MISSED_TOLERANCE_MM2, layerWalls } from "./walls";

export interface SlicerSettings {
  layerHeight: number;
  /** Number of walls round every outline. */
  walls: number;
  /** Width of one printed line, mm. */
  lineWidth: number;
  /** How much of the inside is filled, 0 to 1. Top and bottom skins are always solid. */
  infillDensity: number;
}

/** Solid skin thickness at the top and bottom of the part, and over or under any overhang or step, mm. */
export const TOP_SKIN_MM = 0.8;
export const BOTTOM_SKIN_MM = 0.6;

export interface SlicedLayer extends Layer {
  /** The nozzle's path for each wall, outermost first. */
  walls: Loop[][];
  /** What's left inside the walls, to be filled. */
  inside: Loop[];
  /** Material no line reaches (thinner than one line), mm². */
  missed: number;
  /** Where the inside is filled solid (top and bottom skins), and where sparsely. Together they are the inside,
   * less strips too narrow for a line. */
  solid: Loop[];
  sparse: Loop[];
  /** The fill lines: solid skin lines, and sparse infill lines. */
  solidLines: Lines;
  sparseLines: Lines;
}

export interface SlicedPart {
  settings: SlicerSettings;
  layers: SlicedLayer[];
  /** Cut lines that didn't close into outlines: the surface has gaps. 0 for a good part. */
  openEnds: number;
  /** Layers with places thinner than one line, which won't print. */
  thinLayers: number[];
}

export function slicePart(stl: ArrayBuffer, settings: SlicerSettings): SlicedPart {
  const { layers, openEnds } = sliceStl(stl, { layerHeight: settings.layerHeight });
  const w = settings.lineWidth;
  const top = Math.ceil(TOP_SKIN_MM / settings.layerHeight - 1e-9);
  const bottom = Math.ceil(BOTTOM_SKIN_MM / settings.layerHeight - 1e-9);
  const thinLayers: number[] = [];
  const walled = layers.map((layer, i) => {
    const walls = layerWalls(layer, { count: settings.walls, lineWidth: w });
    if (walls.missed > MISSED_TOLERANCE_MM2) thinLayers.push(i);
    return { ...layer, ...walls };
  });
  const sliced = walled.map((layer, i): SlicedLayer => {
    // Only where a whole line fits: a strip narrower than one line between walls is left (filling such gaps with
    // thinner lines is for later).
    // Specks in corners where the strip widens a little are left too.
    const fillable = offsetLoops(offsetLoops(layer.inside, w / 2), -w / 2).filter(
      (l) => Math.abs(loopArea(l)) >= w * w,
    );
    // Solid wherever the material doesn't carry on for the skin's thickness above and below.
    let solid: Loop[] = fillable;
    let sparse: Loop[] = [];
    if (i >= bottom && i < walled.length - top) {
      const neighbours: Loop[][] = [];
      for (let j = i - bottom; j <= i + top; j++) if (j !== i) neighbours.push(walled[j]!.loops);
      const carriesOn = intersectLoops(...neighbours);
      sparse = intersectLoops(fillable, carriesOn);
      solid = subtractLoops(fillable, carriesOn);
    }
    // Lines cross at right angles from one layer to the next.
    const angle = i % 2 ? 135 : 45;
    const solidLines = fillLines(solid, w, angle, w);
    const sparseLines =
      settings.infillDensity > 0 ? fillLines(sparse, w / settings.infillDensity, angle, w) : new Float64Array();
    return { ...layer, solid, sparse, solidLines, sparseLines };
  });
  return { settings, layers: sliced, openEnds, thinLayers };
}
