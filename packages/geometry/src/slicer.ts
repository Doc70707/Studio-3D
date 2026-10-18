// Studio 3D's own slicer: the whole part, layer by layer. Runs in its own worker (slicer.worker.ts) because a
// curved part takes seconds; `slicePart` itself is plain code, tested directly.

import { sliceStl, type Layer, type Loop } from "./slice";
import { MISSED_TOLERANCE_MM2, layerWalls } from "./walls";

export interface SlicerSettings {
  layerHeight: number;
  /** Number of walls round every outline. */
  walls: number;
  /** Width of one printed line, mm. */
  lineWidth: number;
}

export interface SlicedLayer extends Layer {
  /** The nozzle's path for each wall, outermost first. */
  walls: Loop[][];
  /** What's left inside the walls, to be filled. */
  inside: Loop[];
  /** Material no line reaches (thinner than one line), mm². */
  missed: number;
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
  const thinLayers: number[] = [];
  const sliced = layers.map((layer, i) => {
    const w = layerWalls(layer, { count: settings.walls, lineWidth: settings.lineWidth });
    if (w.missed > MISSED_TOLERANCE_MM2) thinLayers.push(i);
    return { ...layer, ...w };
  });
  return { settings, layers: sliced, openEnds, thinLayers };
}
