// The only module that talks to the geometry kernel (OCCT through replicad).
// Everything else uses the plain data it returns, so the kernel can be swapped later.
import {
  setOC,
  getOC,
  asPnt,
  iterTopo,
  draw,
  drawCircle,
  drawRectangle,
  makeBaseBox,
  makeCylinder,
  makeSphere,
  makeVertex,
  measureArea,
  DistanceQuery,
  measureVolume,
  Plane,
  type Drawing,
  type Edge,
  type Face,
  type Shape3D,
} from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import {
  EDGE_SETS,
  isCopyStep,
  isCopyable,
  isEdgeStep,
  patternMoves,
  hasErrors,
  holeEdgeIssues,
  currentFace,
  holeAxis,
  cross,
  dot,
  normalize,
  type Vec3,
  threadOf,
  threadVolume,
  boreDiameter,
  headDepth,
  headOf,
  modelledThread,
  shapeSize,
  shapeVolume,
  validateDocument,
  validateShape,
  add3,
  nestingDepths,
  profileArea,
  profileMoment,
  yDirOf,
  scale,
  type BoxFeature,
  type Profile,
  type SketchFeature,
  type HoleFeature,
  type HollowFeature,
  type EdgeFeature,
  type MirrorFeature,
  type PatternFeature,
  type Issue,
  type ProjectDocument,
  type ShapeFeature,
} from "@studio3d/document";
import type { Measurements, MeshData } from "./protocol";
import { makeThread } from "./threads";

export function useKernel(oc: OpenCascadeInstance): void {
  setOC(oc);
}

/** Display quality. 0.05 mm chord error is finer than any printer resolves. */
const MESH = { tolerance: 0.05, angularTolerance: 0.2 } as const;
const STL = { tolerance: 0.01, angularTolerance: 0.1 } as const;

export type BuildResult =
  | { ok: true; shape: Shape3D; measurements: Measurements; issues: Issue[]; pieces?: Piece[] }
  | { ok: false; issues: Issue[] };

/** The solid one step added or cut, where it was used. Kept so the finished part's faces can be traced to it. */
export interface Piece {
  id: string;
  shape: Shape3D;
  /** A hollow, fillet or chamfer: the whole part after that step, which explains the faces the step made. */
  modifier?: boolean;
}

/** What the finished box must measure. Used to catch the kernel silently returning the wrong shape. */
export const expectedBoxVolume = (b: BoxFeature): number => shapeVolume(b);

/** Thrown when the kernel's answer fails a check; the message is shown to the user. */
class ShapeCheckFailed extends Error {
  constructor(
    message: string,
    readonly featureId?: string,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

/** Makes one shape in place on the plate, without any checks. */
function makeRaw(s: ShapeFeature): Shape3D {
  switch (s.type) {
    case "box": {
      let shape: Shape3D = makeBaseBox(s.width, s.depth, s.height);
      if (s.wall > 0) {
        const solid = shape;
        shape = solid.shell(s.wall, (f) => f.inPlane("XY", s.height));
        solid.delete();
      }
      return shape.translate([s.x, s.y, s.z]);
    }
    case "cylinder": {
      const thread = threadOf(s);
      if (thread) return makeThread(thread, s.height).translate([s.x, s.y, s.z]);
      return makeCylinder(s.diameter / 2, s.height, [s.x, s.y, s.z], [0, 0, 1]);
    }
    case "tube": {
      const outer = makeCylinder(s.outerDiameter / 2, s.height, [s.x, s.y, s.z], [0, 0, 1]);
      const inner = makeCylinder(s.innerDiameter / 2, s.height + 2, [s.x, s.y, s.z - 1], [0, 0, 1]);
      try {
        return outer.cut(inner);
      } finally {
        outer.delete();
        inner.delete();
      }
    }
    case "cone": {
      // A side profile spun around the vertical axis. A top diameter of 0 makes a point.
      const R = s.bottomDiameter / 2;
      const r = s.topDiameter / 2;
      const pen = draw([0, 0]).lineTo([R, 0]).lineTo([r, s.height]);
      const profile = r > 0 ? pen.lineTo([0, s.height]).close() : pen.close();
      return profile.sketchOnPlane("XZ").revolve([0, 0, 1]).translate([s.x, s.y, s.z]) as Shape3D;
    }
    case "sphere":
      return makeSphere(s.diameter / 2).translate([s.x, s.y, s.z + s.diameter / 2]);
  }
}

/**
 * How far a kernel volume may be from the exact maths. Flat and round shapes are exact to rounding; a thread's
 * helix is stored as a fitted curve, which is within about a part in a million; 1 in 10,000 leaves room.
 */
const tolerance = (f: { type: string; thread?: unknown }) => (f.thread ? 1e-4 : 1e-6);

/**
 * Makes one shape and checks it against the exact maths: volume and size must match,
 * otherwise the kernel silently returned something else (it can, e.g. for an impossible wall).
 */
export function makeShape(s: ShapeFeature): Shape3D {
  const shape = makeRaw(s);
  const volume = measureVolume(shape);
  const expected = shapeVolume(s);
  const bb = shape.boundingBox;
  const size = [bb.width, bb.height, bb.depth];
  const want = shapeSize(s);
  const tol = tolerance(s);
  const ok =
    Math.abs(volume - expected) <= tol * expected &&
    size.every((v, i) => Math.abs(v - want[i]!) <= (tol === 1e-6 ? 1e-6 * Math.max(1, want[i]!) : 1e-2));
  if (!ok) {
    shape.delete();
    throw new ShapeCheckFailed(`${s.name} came out wrong, so your last good version was kept.`, s.id);
  }
  return shape;
}

export function buildBox(b: BoxFeature): BuildResult {
  const issues = validateShape(b);
  if (hasErrors(issues)) return { ok: false, issues };
  try {
    const shape = makeShape(b);
    return { ok: true, shape, measurements: measure(shape), issues };
  } catch (e) {
    return { ok: false, issues: [failure(e, b.id, b.name)] };
  }
}

/**
 * The most material a hole can remove, worked out from its sizes: its bore all the way down, plus the ring of a
 * counterbore or the cone of a countersink; for a modelled thread, the thread plus the plain hole below it.
 */
export function maxHoleVolume(h: HoleFeature, partHeight: number): number {
  const depth = h.depth === 0 ? partHeight : h.depth;
  const thread = modelledThread(h) ? threadOf(h) : null;
  if (thread) {
    const threaded = Math.min(h.threadDepth ?? depth, depth);
    return threadVolume(thread, threaded) * (1 + tolerance(h)) + Math.PI * thread.minor ** 2 * (depth - threaded);
  }
  const r = boreDiameter(h) / 2;
  const bore = Math.PI * r * r * depth;
  const head = headOf(h);
  if (!head) return bore;
  const R = head.diameter / 2;
  const down = headDepth(h);
  if (head.kind === "counterbore") return bore + Math.PI * (R * R - r * r) * down;
  return bore + (Math.PI * down * (R * R + R * r + r * r)) / 3 - Math.PI * r * r * down;
}

interface Part {
  shape: Shape3D;
  volume: number;
  pieces: number;
}

/**
 * Adds or cuts one shape and checks the result against what is physically possible:
 * - adding can't make the part smaller than either piece, or bigger than both together;
 * - cutting can remove nothing, but never more than the cutting shape itself.
 */
function combine(part: Part, s: ShapeFeature, issues: Issue[], keep?: Piece[]): Part {
  const tool = makeShape(s);
  const v = shapeVolume(s);
  const tol = tolerance(s);
  return applyTool(part, { shape: tool, least: v * (1 - tol), most: v * (1 + tol) }, s, issues, keep);
}

/** A cutting or adding shape, with the range its volume must fall in. */
interface Tool {
  shape: Shape3D;
  least: number;
  most: number;
}

function applyTool(
  part: Part,
  tool: Tool,
  s: { id: string; name: string; mode: "add" | "cut" },
  issues: Issue[],
  keep?: Piece[],
): Part {
  let result: Shape3D;
  try {
    result = s.mode === "add" ? part.shape.fuse(tool.shape) : part.shape.cut(tool.shape);
  } finally {
    release(tool.shape, s.id, keep);
  }
  const volume = measureVolume(result);
  const pieces = result.solids.length;
  const eps = 1e-6 * (part.volume + tool.most);
  const warn = (message: string) => issues.push({ severity: "warning", featureId: s.id, field: null, message });

  if (s.mode === "add") {
    const ok =
      volume >= Math.max(part.volume, tool.least) - eps && volume <= part.volume + tool.most + eps && pieces >= 1;
    if (!ok) {
      result.delete();
      throw new ShapeCheckFailed(`${s.name} came out wrong when added, so your last good version was kept.`, s.id);
    }
    if (pieces > part.pieces)
      warn(`${s.name} doesn't touch the rest of the part, so it will print as a separate piece.`);
  } else {
    const removed = part.volume - volume;
    if (pieces === 0 || volume <= eps) {
      result.delete();
      throw new ShapeCheckFailed(`${s.name} would cut away the whole part. Make it smaller or move it.`, s.id);
    }
    if (removed < -eps || removed > tool.most + eps) {
      result.delete();
      throw new ShapeCheckFailed(`${s.name} came out wrong when cut, so your last good version was kept.`, s.id);
    }
    if (removed <= eps) warn(`${s.name} doesn't cut anything. Move it so it overlaps the part.`);
    else if (pieces > part.pieces) warn(`${s.name} splits the part into ${pieces} separate pieces.`);
  }
  return { shape: result, volume, pieces };
}

/** One outline as a flat drawing in sketch coordinates. */
function drawProfile(p: Profile): Drawing {
  switch (p.kind) {
    case "rectangle":
      return drawRectangle(p.width, p.height).translate(p.x + p.width / 2, p.y + p.height / 2);
    case "circle":
      return drawCircle(p.diameter / 2).translate(p.x, p.y);
    case "polygon": {
      const [first, ...rest] = p.points;
      let pen = draw(first!);
      for (const q of rest) pen = pen.lineTo(q);
      return pen.close();
    }
  }
}

/**
 * Pushes a sketch's outlines into a solid. Adding grows out of the face; cutting starts 1 mm outside the
 * face (so no paper-thin skin is left) and goes into it. Each outline is checked against its exact
 * area times its length before the outlines are joined.
 */
export function makeSketchTool(s: SketchFeature, partSize: number): Tool {
  if (s.revolve !== undefined) return makeRevolveTool(s);
  const cut = s.mode === "cut";
  const extra = cut ? 1 : 0;
  const length = (cut && s.depth === 0 ? partSize + 2 : s.depth) + extra;
  const origin = add3(s.plane.origin, scale(s.plane.normal, extra));
  return joinOutlines(s, (p) => [
    drawProfile(p)
      .sketchOnPlane(new Plane(origin, s.plane.xDir, s.plane.normal))
      .extrude(cut ? -length : length) as Shape3D,
    profileArea(p) * length,
  ]);
}

/**
 * Spins a revolve's outlines round the drawing's up line through its (0, 0). Each outline is checked against
 * its exact volume (Pappus: the angle times its area times how far its centre is from the line).
 */
function makeRevolveTool(s: SketchFeature): Tool {
  const angle = s.revolve!;
  const plane = new Plane(s.plane.origin, s.plane.xDir, s.plane.normal);
  return joinOutlines(s, (p) => [
    drawProfile(p).sketchOnPlane(plane).revolve(yDirOf(s.plane), { origin: s.plane.origin, angle }) as Shape3D,
    ((angle * Math.PI) / 180) * profileMoment(p),
  ]);
}

/**
 * Makes each outline's solid, checks it against the volume it must have, and joins them: outlines on their own
 * add, one drawn inside another is a hole in it, and an island in a hole adds again.
 */
function joinOutlines(s: SketchFeature, make: (p: Profile) => [Shape3D, number]): Tool {
  const depths = nestingDepths(s.profiles);
  const order = s.profiles.map((p, i) => ({ p, depth: depths[i]! })).sort((a, b) => a.depth - b.depth);
  const wrong = () => new ShapeCheckFailed(`${s.name} came out wrong, so your last good version was kept.`, s.id);
  let tool: Shape3D | null = null;
  let most = 0;
  let biggest = 0;
  let holes = 0;
  try {
    for (const { p, depth } of order) {
      const [solid, want] = make(p);
      if (Math.abs(measureVolume(solid) - want) > 1e-6 * want) {
        solid.delete();
        throw wrong();
      }
      if (depth % 2 === 0) {
        most += want;
        biggest = Math.max(biggest, want);
      } else holes += want;
      if (!tool) tool = solid;
      else {
        const next: Shape3D = depth % 2 === 0 ? tool.fuse(solid) : tool.cut(solid);
        tool.delete();
        solid.delete();
        tool = next;
      }
    }
  } catch (e) {
    tool?.delete();
    throw e;
  }
  if (!tool) throw new ShapeCheckFailed(`${s.name} is empty. Draw at least one shape in it.`, s.id);
  const v = measureVolume(tool);
  // Joined outlines can't be bigger than all of them together, or smaller than the biggest minus every hole.
  if (v > most * (1 + 1e-6) || v < (biggest - holes) * (1 - 1e-6) - 1e-9) {
    tool.delete();
    throw wrong();
  }
  if (v <= 1e-9 * most) {
    tool.delete();
    throw new ShapeCheckFailed(`The holes in ${s.name} cover all of it, so there's nothing left to make.`, s.id);
  }
  return { shape: tool, least: v, most: v };
}

/** The longest straight line through the part's bounding box: enough to cut through anything. */
function partSpan(part: Part | null): number {
  if (!part) return 0;
  const [min, max] = part.shape.boundingBox.bounds;
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/** How far the part's bounding box reaches from `point` in `direction`: the deepest a hole can go there. */
function reachInto(point: Vec3, direction: Vec3, min: number[], max: number[]): number {
  let most = 0;
  for (const x of [min[0]!, max[0]!])
    for (const y of [min[1]!, max[1]!])
      for (const z of [min[2]!, max[2]!])
        most = Math.max(most, dot([x - point[0], y - point[1], z - point[2]], direction));
  return most;
}

/** Turns a solid made along +Z so that +Z points along `n`, turning about the origin. */
function pointAlong(shape: Shape3D, n: Vec3): Shape3D {
  if (n[2] > 1 - 1e-9) return shape;
  if (n[2] < -1 + 1e-9) return shape.rotate(180, [0, 0, 0], [1, 0, 0]);
  return shape.rotate((Math.acos(n[2]) * 180) / Math.PI, [0, 0, 0], normalize(cross([0, 0, 1], n)));
}

/** Where a hole on a face drills, and how deep it can go: its own depth, or right through the part. */
function faceHole(h: HoleFeature & { face: NonNullable<HoleFeature["face"]> }, doc: ProjectDocument, part: Part) {
  const [min, max] = part.shape.boundingBox.bounds;
  const face = currentFace(doc, h.face);
  const { point, direction } = holeAxis(face, h.x, h.y);
  return { face, point, direction, reach: reachInto(point, direction, min, max) };
}

/** The solid a hole cuts. */
function holeTool(h: HoleFeature, doc: ProjectDocument, part: Part): Shape3D {
  const extra = 1; // the tool pokes 1 mm past the faces it cuts, so no paper-thin skin is left behind
  const [min, max] = part.shape.boundingBox.bounds;
  if (h.face) {
    // Square into the face: from the bottom of the hole (or past the far side of the part) out to 1 mm above the face.
    const { point, direction, reach } = faceHole({ ...h, face: h.face }, doc, part);
    const deep = h.depth === 0 ? reach + extra : h.depth;
    return pointAlong(localHoleTool(h, deep, extra), scale(direction, -1)).translate(point);
  }
  // From the top: down to its depth, or to 1 mm below the part.
  const deep = h.depth === 0 ? max[2]! - min[2]! + extra : h.depth;
  return localHoleTool(h, deep, extra).translate([h.x, h.y, max[2]!]);
}

/**
 * A hole's solid made with its face at z = 0, going `deep` down into -z and `extra` up out of the face.
 * - A modelled thread runs from its thread depth up; below it the hole carries on at the thread's smallest
 *   diameter, so there's no step.
 * - A plain, clearance or simplified threaded hole is a cylinder.
 * - A counterbore or countersink is the hole's side profile spun round its axis.
 */
function localHoleTool(h: HoleFeature, deep: number, extra: number): Shape3D {
  const thread = modelledThread(h) ? threadOf(h) : null;
  if (thread) {
    const threaded = Math.min(h.threadDepth ?? deep, deep);
    // A threaded tool is made in 5 mm steps of length (any extra pokes out of the face, cutting nothing), so a
    // thread already built is reused while the part or the hole's depth changes a little.
    const tool = makeThread(thread, Math.ceil((threaded + extra) / 5) * 5).translate([0, 0, -threaded]);
    if (threaded >= deep - 1e-9) return tool;
    const rest = makeCylinder(thread.minor, deep - threaded, [0, 0, -deep], [0, 0, 1]);
    try {
      return tool.fuse(rest);
    } finally {
      tool.delete();
      rest.delete();
    }
  }
  const r = boreDiameter(h) / 2;
  const head = headOf(h);
  if (!head) return makeCylinder(r, deep + extra, [0, 0, -deep], [0, 0, 1]);
  const R = head.diameter / 2;
  const down = headDepth(h);
  const pen = draw([0, -deep]).lineTo([r, -deep]).lineTo([r, -down]);
  const side = head.kind === "counterbore" ? pen.lineTo([R, -down]) : pen.lineTo([R, 0]);
  return side.lineTo([R, extra]).lineTo([0, extra]).close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape3D;
}

/**
 * Drills one hole straight down from the top of the part and checks the result.
 * The cut must remove some material but never more than the hole's own cylinder.
 */
function drill(part: Part, h: HoleFeature, doc: ProjectDocument, issues: Issue[], keep?: Piece[]): Part {
  const bb = part.shape.boundingBox;
  const [min, max] = bb.bounds;
  let height = max[2] - min[2];
  if (h.face) {
    // The face's own edges were checked with the document; here the depth is checked against the part.
    const { reach } = faceHole({ ...h, face: h.face }, doc, part);
    if (h.depth > reach + 1e-9)
      throw new ShapeCheckFailed(
        `The part is only ${fmt(reach)} deep under ${h.name}. Use ${fmt(reach)} or less, or 0 to go all the way through.`,
        h.id,
        "depth",
      );
    height = reach;
  } else {
    const edge = holeEdgeIssues(h, min, max, height);
    if (hasErrors(edge)) throw new ShapeCheckFailed(edge[0]!.message, h.id, edge[0]!.field);
    issues.push(...edge);
  }
  // A through hole's thread and head are checked against how deep the part is under it.
  if (modelledThread(h) && h.threadDepth !== undefined && h.threadDepth > height + 1e-9)
    throw new ShapeCheckFailed(
      `The part is only ${fmt(height)} deep under ${h.name}, so the thread can't go deeper than that.`,
      h.id,
      "threadDepth",
    );
  const head = headOf(h);
  if (head && headDepth(h) >= height - 1e-9) {
    const name = head.kind === "counterbore" ? "counterbore" : "countersink";
    throw new ShapeCheckFailed(
      `The ${name} on ${h.name} reaches ${fmt(headDepth(h))} deep, but the part is only ${fmt(height)} deep there. ` +
        `Make the ${name} smaller.`,
      h.id,
      head.kind === "counterbore" ? "headDepth" : "headDiameter",
    );
  }

  const tool = holeTool(h, doc, part);
  let result: Shape3D;
  try {
    result = part.shape.cut(tool);
  } finally {
    release(tool, h.id, keep);
  }
  const volume = measureVolume(result);
  const removed = part.volume - volume;
  const most = maxHoleVolume(h, height);
  if (!(volume > 0) || removed > most * (1 + 1e-6) + 1e-6 || removed < -1e-6 * part.volume) {
    result.delete();
    throw new ShapeCheckFailed(`${h.name} came out wrong, so your last good version was kept.`, h.id);
  }
  if (removed <= 1e-9 * part.volume) {
    issues.push({
      severity: "warning",
      featureId: h.id,
      field: null,
      message: `${h.name} doesn't cut anything. It's over empty space. Make it deeper or move it onto the part.`,
    });
  }
  return { shape: result, volume, pieces: result.solids.length };
}

/** For each open side: the plane its faces lie in, and which end of the part's bounding box that is. */
const SIDES = {
  top: { plane: "XY", axis: 2, end: "max" },
  bottom: { plane: "XY", axis: 2, end: "min" },
  front: { plane: "XZ", axis: 1, end: "min" },
  back: { plane: "XZ", axis: 1, end: "max" },
  left: { plane: "YZ", axis: 0, end: "min" },
  right: { plane: "YZ", axis: 0, end: "max" },
} as const;

/**
 * Hollows out the part, leaving walls `wall` thick and removing the flat faces on the open side.
 * The result must keep the part's outside size, have less material than before, and no more than the
 * walls could hold (their area times their thickness, with room for rounded inside corners).
 */
export function hollow(part: Part, h: HollowFeature): Part {
  const [min, max] = part.shape.boundingBox.bounds;
  const size = [0, 1, 2].map((i) => max[i]! - min[i]!);
  const thinnest = Math.min(...size);
  if (2 * h.wall >= thinnest - 1e-9)
    throw new ShapeCheckFailed(
      `Walls ${fmt(h.wall)} thick would fill the whole part, which is only ${fmt(thinnest)} across at its thinnest. Use thinner walls.`,
      h.id,
      "wall",
    );

  let openArea = 0;
  let inner: Shape3D;
  let result: Shape3D;
  try {
    if (h.open === "none") {
      // With nothing removed, OCCT gives the solid shrunk by the wall thickness: cut that out of the part.
      inner = part.shape.shell(h.wall, (f) => f.inPlane("XY", 1e9));
      try {
        result = part.shape.cut(inner);
      } finally {
        inner.delete();
      }
    } else {
      const side = SIDES[h.open];
      const at = [0, 0, 0] as [number, number, number];
      at[side.axis] = (side.end === "max" ? max : min)[side.axis]!;
      const faces = part.shape.faces;
      const open = faces.filter((face) => {
        const [lo, hi] = face.boundingBox.bounds;
        const flat = (v: number) => Math.abs(v - at[side.axis]!) < 1e-6;
        return face.geomType === "PLANE" && flat(lo[side.axis]!) && flat(hi[side.axis]!);
      });
      openArea = open.reduce((a, face) => a + measureArea(face), 0);
      const found = open.length;
      faces.forEach((face) => face.delete());
      if (!found)
        throw new ShapeCheckFailed(
          `The ${h.open} of the part isn't flat, so it can't be left open. Choose another side, or None to keep it closed.`,
          h.id,
          "open",
        );
      result = part.shape.shell(h.wall, (f) => f.inPlane(side.plane, at));
    }
  } catch (e) {
    if (e instanceof ShapeCheckFailed) throw e;
    throw new ShapeCheckFailed(cantHollow(h), h.id, "wall");
  }

  const volume = measureVolume(result);
  const [rmin, rmax] = result.boundingBox.bounds;
  const sameSize = [0, 1, 2].every((i) => Math.abs(rmin[i]! - min[i]!) < 1e-4 && Math.abs(rmax[i]! - max[i]!) < 1e-4);
  const most = Math.min(part.volume, 1.5 * (measureArea(part.shape) - openArea) * h.wall);
  if (!sameSize || !(volume > 0) || volume >= part.volume * (1 - 1e-9) || volume > most) {
    result.delete();
    throw new ShapeCheckFailed(cantHollow(h), h.id, "wall");
  }
  return { shape: result, volume, pieces: result.solids.length };
}

/** Whether an edge belongs to a fillet's or chamfer's set, judged from where it lies on the part. */
function edgeChooser(set: EdgeFeature["edges"], partMin: number[], partMax: number[]): (e: Edge) => boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return (e) => {
    if (set === "all") return true;
    const [lo, hi] = e.boundingBox.bounds;
    if (set === "top") return near(lo[2]!, partMax[2]!) && near(hi[2]!, partMax[2]!);
    if (set === "bottom") return near(lo[2]!, partMin[2]!) && near(hi[2]!, partMin[2]!);
    // Upright: a straight edge with no sideways extent.
    return e.geomType === "LINE" && near(lo[0]!, hi[0]!) && near(lo[1]!, hi[1]!) && hi[2]! - lo[2]! > 1e-6;
  };
}

/**
 * Rounds (fillet) or bevels (chamfer) the chosen edges. The result must be one solid per piece as before, no bigger
 * than the part, and its volume may change by at most what a cut of that size along every chosen edge could take
 * or add (a generous bound: the exact amounts are checked in the tests).
 */
export function edgeStep(part: Part, f: EdgeFeature): Part {
  const [min, max] = part.shape.boundingBox.bounds;
  const chosen = edgeChooser(f.edges, min, max);
  const edges = part.shape.edges;
  const picked = edges.filter(chosen);
  const length = picked.reduce((a, e) => a + e.length, 0);
  edges.forEach((e) => e.delete());
  const what = f.type === "fillet" ? "round" : "bevel";
  const set = EDGE_SETS.find((x) => x.edges === f.edges)!.label.toLowerCase();
  if (!picked.length)
    throw new ShapeCheckFailed(`The part has no ${set} to ${what}. Choose other edges.`, f.id, "edges");

  let result: Shape3D;
  try {
    const size = (e: Edge) => (chosen(e) ? f.size : null);
    result = f.type === "fillet" ? part.shape.fillet(size) : part.shape.chamfer(size);
  } catch {
    throw new ShapeCheckFailed(cantEdge(f, set), f.id, "size");
  }
  const volume = measureVolume(result);
  const pieces = result.solids.length;
  const [rmin, rmax] = result.boundingBox.bounds;
  const inside = [0, 1, 2].every((i) => rmin[i]! >= min[i]! - 1e-4 && rmax[i]! <= max[i]! + 1e-4);
  const most = 4 * length * f.size * f.size + 1e-6 * part.volume;
  if (!(volume > 0) || pieces !== part.pieces || !inside || Math.abs(volume - part.volume) > most) {
    result.delete();
    throw new ShapeCheckFailed(cantEdge(f, set), f.id, "size");
  }
  return { shape: result, volume, pieces };
}

/** The solid an earlier step adds or cuts, made again where it stood, with the range its volume must fall in. */
function sourceTool(
  src: ShapeFeature | HoleFeature | SketchFeature,
  part: Part,
  doc: ProjectDocument,
): Tool & { mode: "add" | "cut" } {
  if (src.type === "hole") {
    const shape = holeTool(src, doc, part);
    return { shape, least: 0, most: measureVolume(shape) * (1 + 1e-6), mode: "cut" };
  }
  if (src.type === "sketch") return { ...makeSketchTool(src, partSpan(part)), mode: src.mode };
  const shape = makeShape(src);
  const v = shapeVolume(src);
  const tol = tolerance(src);
  return { shape, least: v * (1 - tol), most: v * (1 + tol), mode: src.mode };
}

/**
 * Adds or cuts copies of an earlier step: moved in a grid, turned round an upright line, or mirrored. Each copy is
 * checked like the original would be (an added copy adds no more than its own volume; a cut takes no more).
 */
export function copyStep(
  part: Part,
  f: PatternFeature | MirrorFeature,
  doc: ProjectDocument,
  issues: Issue[],
  keep?: Piece[],
): Part {
  const src = doc.features.find((x) => x.id === f.source);
  if (!src || !isCopyable(src))
    throw new ShapeCheckFailed("Choose an earlier shape, hole or sketch to copy.", f.id, "source");
  const tool = sourceTool(src, part, doc);
  const copies: Shape3D[] = [];
  try {
    if (f.type === "mirror")
      copies.push(
        f.axis === "x" ? tool.shape.clone().mirror("YZ", [f.at, 0, 0]) : tool.shape.clone().mirror("XZ", [0, f.at, 0]),
      );
    else
      for (const m of patternMoves(f))
        copies.push(
          m.turn
            ? tool.shape.clone().rotate(m.turn, [f.cx, f.cy, 0], [0, 0, 1])
            : tool.shape.clone().translate([m.by[0], m.by[1], 0]),
        );
  } finally {
    tool.shape.delete();
  }
  let current = part;
  try {
    while (copies.length) {
      const copy = copies.shift()!;
      const step = { id: f.id, name: f.name, mode: tool.mode };
      const next = applyTool(current, { ...tool, shape: copy }, step, issues, keep);
      if (current !== part) current.shape.delete();
      current = next;
    }
  } catch (e) {
    copies.forEach((c) => c.delete());
    if (current !== part) current.shape.delete();
    throw e;
  }
  return current;
}

const cantEdge = (f: EdgeFeature, set: string) =>
  `${f.name} couldn't ${f.type === "fillet" ? "round" : "bevel"} the ${set} by ${fmt(f.size)}, so your last good ` +
  "version was kept. It is probably bigger than a face next to one of those edges: try a smaller size.";

/** Why a hollow failed, in words that point at what to change. */
const cantHollow = (h: HollowFeature) =>
  `${h.name} couldn't be made with ${fmt(h.wall)} walls, so your last good version was kept. ` +
  "Sharp points (like the tip of a cone) and parts thinner than two walls can't be hollowed. " +
  "Try thinner walls, or remove the pointed shape.";

const fmt = (n: number) => `${Math.round(n * 100) / 100} mm`;

function failure(e: unknown, featureId: string, name: string): Issue {
  if (e instanceof ShapeCheckFailed)
    return {
      severity: "error",
      featureId: e.featureId ?? featureId,
      field: e.field,
      message: e.message,
    };
  return {
    severity: "error",
    featureId,
    field: null,
    message: `The geometry engine couldn't build ${name}, so your last good version was kept.`,
  };
}

/** A used tool is either kept for tracing faces or deleted. */
function release(tool: Shape3D, id: string, keep?: Piece[]) {
  if (keep) keep.push({ id, shape: tool });
  else tool.delete();
}

/**
 * Builds the whole design: each step in order, checking every result.
 * With `keepPieces`, the result also holds the solid each step used (the caller deletes them).
 */
export function buildDocument(doc: ProjectDocument, keepPieces = false): BuildResult {
  if (!doc.features.length)
    return {
      ok: false,
      issues: [kernelIssue("There's nothing to build yet.")],
    };
  const issues = validateDocument(doc);
  if (hasErrors(issues)) return { ok: false, issues };

  let part: Part | null = null;
  const keep: Piece[] | undefined = keepPieces ? [] : undefined;
  for (const f of doc.features) {
    try {
      let next: Part;
      if (f.type === "hole") next = drill(part!, f, doc, issues, keep);
      else if (isCopyStep(f)) next = copyStep(part!, f, doc, issues, keep);
      else if (f.type === "hollow" || isEdgeStep(f)) {
        next = f.type === "hollow" ? hollow(part!, f) : edgeStep(part!, f);
        keep?.push({ id: f.id, shape: next.shape.clone(), modifier: true });
      } else if (f.type === "sketch") {
        const tool = makeSketchTool(f, partSpan(part));
        if (part) next = applyTool(part, tool, f, issues, keep);
        else {
          next = { shape: tool.shape, volume: measureVolume(tool.shape), pieces: tool.shape.solids.length };
          keep?.push({ id: f.id, shape: tool.shape.clone() });
        }
      } else if (!part) {
        const shape = makeShape(f);
        next = {
          shape,
          volume: measureVolume(shape),
          pieces: shape.solids.length,
        };
        keep?.push({ id: f.id, shape: shape.clone() });
      } else next = combine(part, f, issues, keep);
      part?.shape.delete();
      part = next;
    } catch (e) {
      part?.shape.delete();
      keep?.forEach((p) => p.shape.delete());
      return { ok: false, issues: [failure(e, f.id, f.name)] };
    }
  }
  return {
    ok: true,
    shape: part!.shape,
    measurements: measure(part!.shape),
    issues,
    pieces: keep,
  };
}

/** How far a mesh corner may be from the exact surface it lies on: float rounding, nothing more. */
const ON_SURFACE = 1e-3;

/**
 * Which step made each face of the finished part, as a feature id per face of `mesh` ("" when none did).
 * A face belongs to the last step whose solid has the face's surface on its own outside: each corner of the face's
 * biggest triangle lies exactly on that solid's surface (corners are on the exact surface, unlike the middle of a
 * triangle on a curve), and so does the triangle's middle, within the display's 0.05 mm accuracy.
 * Faces no shape or sketch explains were made by a hollow (its inside walls), a fillet or a chamfer: they belong to
 * the first of those after which the face exists.
 */
export function faceOwners(mesh: MeshData, pieces: Piece[]): string[] {
  const surfaces = pieces.map((p) => {
    const [lo, hi] = p.shape.boundingBox.bounds;
    return { id: p.id, modifier: !!p.modifier, lo, hi, faces: faceIndex(p.shape) };
  });
  const steps = surfaces.filter((s) => !s.modifier);
  const modifiers = surfaces.filter((s) => s.modifier);
  const owners: string[] = [];
  try {
    const n = mesh.faces.length / 2;
    for (let f = 0; f < n; f++) {
      const start = mesh.faces[2 * f]!;
      const count = mesh.faces[2 * f + 1]!;
      const corner = (i: number): [number, number, number] => {
        const v = mesh.indices[i]! * 3;
        return [mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!];
      };
      // The face's biggest triangle: its corners are furthest apart, so least likely to all touch another solid.
      let best = start;
      let bestArea = -1;
      for (let i = start; i < start + count; i += 3) {
        const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)];
        const area = triangleArea(a, b, c);
        if (area > bestArea) [best, bestArea] = [i, area];
      }
      const pts = [corner(best), corner(best + 1), corner(best + 2)];
      const mid = [0, 1, 2].map((k) => (pts[0]![k]! + pts[1]![k]! + pts[2]![k]!) / 3) as [number, number, number];
      const on = (s: (typeof surfaces)[number]) => {
        const inside = (q: number[]) => q.every((v, k) => v >= s.lo[k]! - 0.1 && v <= s.hi[k]! + 0.1);
        if (!inside(mid)) return false;
        if (!within(s.faces, mid, MESH.tolerance + ON_SURFACE)) return false;
        return pts.every((q) => within(s.faces, q, ON_SURFACE));
      };
      // The last shape or sketch whose own surface has the face; failing that, the first hollow, fillet or chamfer
      // after which the face exists (its inside walls, rounded edges or bevels).
      const owner = [...steps].reverse().find(on)?.id ?? modifiers.find(on)?.id ?? "";
      owners.push(owner);
    }
  } finally {
    surfaces.forEach((s) =>
      s.faces.forEach((x) => {
        x.query?.delete();
        x.projector?.delete();
        x.face.delete();
      }),
    );
  }
  return owners;
}

/**
 * A solid's faces, each with its bounding box, for asking how far a point is from the solid's surface. Only the faces
 * whose boxes reach the point are measured. Flat and simple round faces are measured exactly. Free-form faces (a
 * thread's tooth) are measured against their surface with a projector set up once per face, which is far quicker
 * than a full shape-to-shape distance each time; the exact distance is still used when the point doesn't project
 * inside the face's surface patch.
 */
interface IndexedFace {
  lo: number[];
  hi: number[];
  face: Face;
  query: DistanceQuery | null;
  projector: OcProjector | null | undefined;
}

type OcProjector = {
  Perform(p: unknown): void;
  NbPoints(): number;
  LowerDistance(): number;
  delete(): void;
};

const FREE_FORM = new Set(["BSPLINE_SURFACE", "BEZIER_SURFACE", "OFFSET_SURFACE", "OTHER_SURFACE"]);

function faceIndex(shape: Shape3D): IndexedFace[] {
  return shape.faces.map((face) => {
    const [lo, hi] = face.boundingBox.bounds;
    return { lo, hi, face, query: null, projector: FREE_FORM.has(face.geomType) ? undefined : null };
  });
}

function projectorFor(f: IndexedFace): OcProjector | null {
  if (f.projector !== undefined) return f.projector;
  const oc = getOC();
  const surface = oc.BRep_Tool.Surface(f.face.wrapped);
  const { uMin, uMax, vMin, vMax } = f.face.UVBounds;
  const projector = new oc.GeomAPI_ProjectPointOnSurf() as unknown as OcProjector & {
    Init(...args: unknown[]): void;
  };
  projector.Init(surface, uMin, uMax, vMin, vMax, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
  (surface as unknown as { delete(): void }).delete();
  f.projector = projector;
  return projector;
}

/** Whether a point is within `tolerance` of any of the faces. */
function within(faces: IndexedFace[], at: [number, number, number], tolerance: number): boolean {
  const pad = tolerance + 1e-6;
  let v: ReturnType<typeof makeVertex> | null = null;
  let p: { delete(): void } | null = null;
  try {
    for (const f of faces) {
      if (!at.every((c, k) => c >= f.lo[k]! - pad && c <= f.hi[k]! + pad)) continue;
      const projector = projectorFor(f);
      if (projector) {
        p ??= asPnt(at);
        projector.Perform(p);
        if (projector.NbPoints() > 0) {
          if (projector.LowerDistance() <= tolerance) return true;
          continue;
        }
      }
      v ??= makeVertex(at);
      f.query ??= new DistanceQuery(f.face);
      if (f.query.distanceTo(v) <= tolerance) return true;
    }
    return false;
  } finally {
    v?.delete();
    p?.delete();
  }
}

function triangleArea(a: number[], b: number[], c: number[]): number {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!) / 2;
}

export function measure(shape: Shape3D): Measurements {
  const bb = shape.boundingBox;
  const [min, max] = bb.bounds;
  return {
    volume: measureVolume(shape),
    size: [bb.width, bb.height, bb.depth],
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
    solids: [...iterTopo(shape.wrapped, "solid")].length,
  };
}

export function tessellate(shape: Shape3D): MeshData {
  const m = shape.mesh(MESH);
  const e = shape.meshEdges(MESH);
  return {
    positions: new Float32Array(m.vertices),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.triangles),
    edges: new Float32Array(e.lines),
    faces: new Uint32Array(m.faceGroups.flatMap((g) => [g.start, g.count])),
    owners: [],
  };
}

export async function exportStl(shape: Shape3D): Promise<ArrayBuffer> {
  return dropDegenerateTriangles(await shape.blobSTL({ binary: true, ...STL }).arrayBuffer());
}

/**
 * Removes triangles that have collapsed to a line (two corners at the same point once stored as STL numbers).
 * OCCT leaves one at each pole of a sphere and the tip of a cone. They have no area, so removing them changes
 * nothing in the shape, but they make the mesh look not-watertight to strict checkers and some slicers.
 */
export function dropDegenerateTriangles(stl: ArrayBuffer): ArrayBuffer {
  const view = new DataView(stl);
  const n = view.getUint32(80, true);
  const keep: number[] = [];
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const corner = (v: number) =>
      `${view.getFloat32(o + v * 12, true)},${view.getFloat32(o + v * 12 + 4, true)},${view.getFloat32(o + v * 12 + 8, true)}`;
    if (new Set([corner(0), corner(1), corner(2)]).size === 3) keep.push(t);
  }
  if (keep.length === n) return stl;
  const out = new Uint8Array(84 + keep.length * 50);
  const src = new Uint8Array(stl);
  out.set(src.subarray(0, 80));
  new DataView(out.buffer).setUint32(80, keep.length, true);
  keep.forEach((t, i) => out.set(src.subarray(84 + t * 50, 84 + (t + 1) * 50), 84 + i * 50));
  return out.buffer;
}

const kernelIssue = (message: string): Issue => ({
  severity: "error",
  field: null,
  message,
});
