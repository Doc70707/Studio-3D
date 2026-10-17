// Real modelled ISO threads: a core cylinder with a helical tooth around it.
//
// OCCT sweeps a tooth along a helix accurately for about 20 turns but drifts beyond that, so the tooth is swept
// for a few turns at a time and the pieces are stacked end to end (a helix lines up with itself one pitch higher).
// Neighbouring pieces touch at a flat seam, and the boolean engine only joins touching pieces cleanly when they
// are separate inputs, so alternate pieces go in two groups. Building a thread takes a few seconds, so finished
// threads are kept and reused while the design is being edited.
import {
  cast,
  draw,
  genericSweep,
  getOC,
  makeCompound,
  makeCylinder,
  makeHelix,
  type Shape3D,
  type Sketch,
} from "replicad";
import type { ThreadProfile } from "@studio3d/document";

const TURNS_PER_SWEEP = 8;
/** How far the tooth's root sinks into the core, so the two fuse into one solid. */
const ROOT_OVERLAP = 0.02;

const cache = new Map<string, Shape3D>();
const CACHE_SIZE = 12;

/** Forgets every finished thread, so the next one is built from scratch (for timing a cold build). */
export function clearThreadCache(): void {
  cache.forEach((shape) => shape.delete());
  cache.clear();
}

/**
 * A threaded solid standing on z = 0, `length` tall, centred on the z axis. The caller owns the returned shape.
 */
export function makeThread(t: ThreadProfile, length: number): Shape3D {
  const key = JSON.stringify([t, length]);
  let shape = cache.get(key);
  if (!shape) {
    shape = build(t, length);
    cache.set(key, shape);
    if (cache.size > CACHE_SIZE) {
      const [oldest, old] = cache.entries().next().value!;
      cache.delete(oldest);
      old.delete();
    }
  } else {
    // Most recently used goes to the back.
    cache.delete(key);
    cache.set(key, shape);
  }
  return shape.clone();
}

function build(t: ThreadProfile, length: number): Shape3D {
  const p = t.pitch;
  const root = t.minor - ROOT_OVERLAP;
  // The flanks are 30° from flat, so sinking the root widens it by 2 × overlap × tan 30°.
  const a = t.rootWidth / 2 + ROOT_OVERLAP * Math.tan(Math.PI / 6);
  const b = t.crestWidth / 2;
  const tooth = draw([root, -a]).lineTo([t.major, -b]).lineTo([t.major, b]).lineTo([root, a]).close();
  const sweepHeight = TURNS_PER_SWEEP * p;
  const sweep = genericSweep((tooth.sketchOnPlane("XZ") as Sketch).wire, makeHelix(p, sweepHeight, t.major), {
    frenet: true,
  });

  // Start a turn below 0 and end a turn above the top, so the trimmed ends are full thread.
  const copies = Math.ceil((length + 2 * p) / sweepHeight);
  const pieces = Array.from({ length: copies }, (_, i) => sweep.clone().translate([0, 0, -p + i * sweepHeight]));
  sweep.delete();
  const groups = [0, 1]
    .map((g) => pieces.filter((_, i) => i % 2 === g))
    .filter((g) => g.length)
    .map((g) => makeCompound(g) as Shape3D);
  const core = makeCylinder(t.minor, copies * sweepHeight + 2 * p, [0, 0, -2 * p]);
  const rough = fuseAll(core, groups);
  core.delete();
  groups.forEach((g) => g.delete());
  const trim = makeCylinder(t.major + 1, length, [0, 0, 0]);
  const shape = rough.intersect(trim);
  rough.delete();
  trim.delete();
  return shape;
}

/** Joins `shape` with every tool in one boolean, so tools that touch each other are joined cleanly too. */
function fuseAll(shape: Shape3D, tools: Shape3D[]): Shape3D {
  const oc = getOC();
  const args = new oc.NCollection_List_TopoDS_Shape();
  const toolList = new oc.NCollection_List_TopoDS_Shape();
  const builder = new oc.BRepAlgoAPI_Fuse();
  const progress = new oc.Message_ProgressRange();
  try {
    args.Append(shape.wrapped);
    tools.forEach((t) => toolList.Append(t.wrapped));
    builder.SetArguments(args);
    builder.SetTools(toolList);
    builder.Build(progress);
    if (!builder.IsDone()) throw new Error("The thread's pieces couldn't be joined.");
    builder.SimplifyResult(true, true, 1e-3);
    return cast(builder.Shape()) as Shape3D;
  } finally {
    progress.delete();
    builder.delete();
    toolList.delete();
    args.delete();
  }
}
