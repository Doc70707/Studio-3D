// The only module that talks to the geometry kernel (OCCT through replicad).
// Everything else uses the plain data it returns, so the kernel can be swapped later.
import {
  setOC,
  draw,
  drawCircle,
  drawRectangle,
  makeBaseBox,
  makeCylinder,
  makeCompound,
  makeSphere,
  makeVertex,
  measureArea,
  DistanceQuery,
  measureVolume,
  Plane,
  type Drawing,
  type Shape3D,
} from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import {
  hasErrors,
  holeEdgeIssues,
  threadOf,
  threadVolume,
  shapeSize,
  shapeVolume,
  validateDocument,
  validateShape,
  add3,
  nestingDepths,
  profileArea,
  scale,
  type BoxFeature,
  type Profile,
  type SketchFeature,
  type HoleFeature,
  type HollowFeature,
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

/** The most material a hole can remove: a full cylinder of its diameter and depth. */
export function maxHoleVolume(h: HoleFeature, partHeight: number): number {
  const depth = h.depth === 0 ? partHeight : h.depth;
  const thread = threadOf(h);
  if (thread) return threadVolume(thread, depth) * (1 + tolerance(h));
  return Math.PI * (h.diameter / 2) ** 2 * depth;
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
  const cut = s.mode === "cut";
  const extra = cut ? 1 : 0;
  const length = (cut && s.depth === 0 ? partSize + 2 : s.depth) + extra;
  const origin = add3(s.plane.origin, scale(s.plane.normal, extra));
  const depths = nestingDepths(s.profiles);
  // Outlines on their own add; one drawn inside another is a hole in it; an island in a hole adds again.
  const order = s.profiles.map((p, i) => ({ p, depth: depths[i]! })).sort((a, b) => a.depth - b.depth);
  let tool: Shape3D | null = null;
  let most = 0;
  let biggest = 0;
  let holes = 0;
  try {
    for (const { p, depth } of order) {
      const solid = drawProfile(p)
        .sketchOnPlane(new Plane(origin, s.plane.xDir, s.plane.normal))
        .extrude(cut ? -length : length) as Shape3D;
      const want = profileArea(p) * length;
      if (Math.abs(measureVolume(solid) - want) > 1e-6 * want) {
        solid.delete();
        throw new ShapeCheckFailed(`${s.name} came out wrong, so your last good version was kept.`, s.id);
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
    throw new ShapeCheckFailed(`${s.name} came out wrong, so your last good version was kept.`, s.id);
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

/**
 * Drills one hole straight down from the top of the part and checks the result.
 * The cut must remove some material but never more than the hole's own cylinder.
 */
function drill(part: Part, h: HoleFeature, issues: Issue[], keep?: Piece[]): Part {
  const bb = part.shape.boundingBox;
  const [min, max] = bb.bounds;
  const height = max[2] - min[2];
  const edge = holeEdgeIssues(h, min, max, height);
  if (hasErrors(edge)) throw new ShapeCheckFailed(edge[0]!.message, h.id, edge[0]!.field);
  issues.push(...edge);

  const extra = 1; // the tool pokes 1 mm past the faces it cuts, so no paper-thin skin is left behind
  const bottom = h.depth === 0 ? min[2] - extra : max[2] - h.depth;
  const thread = threadOf(h);
  // A threaded tool is made in 5 mm steps of length (any extra pokes out of the top, cutting nothing), so a thread
  // already built is reused while the part's height or the hole's depth changes a little.
  const tool = thread
    ? makeThread(thread, Math.ceil((max[2] + extra - bottom) / 5) * 5).translate([h.x, h.y, bottom])
    : makeCylinder(h.diameter / 2, max[2] + extra - bottom, [h.x, h.y, bottom], [0, 0, 1]);
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
      if (f.type === "hole") next = drill(part!, f, issues, keep);
      else if (f.type === "hollow") next = hollow(part!, f);
      else if (f.type === "sketch") {
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
 * Faces no step's solid explains are the inside walls a hollow made, so they belong to the hollow.
 */
export function faceOwners(mesh: MeshData, pieces: Piece[], doc: ProjectDocument): string[] {
  const hollowId = doc.features.find((f) => f.type === "hollow")?.id ?? "";
  const surfaces = pieces.map((p) => {
    const faces = p.shape.faces;
    const shell = makeCompound(faces);
    faces.forEach((f) => f.delete());
    const [lo, hi] = p.shape.boundingBox.bounds;
    return { id: p.id, shell, lo, hi, query: new DistanceQuery(shell) };
  });
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
      let owner = hollowId;
      for (let p = surfaces.length - 1; p >= 0; p--) {
        const s = surfaces[p]!;
        const inside = (q: number[]) => q.every((v, k) => v >= s.lo[k]! - 0.1 && v <= s.hi[k]! + 0.1);
        if (!inside(mid)) continue;
        if (distanceTo(s.query, mid) > MESH.tolerance + ON_SURFACE) continue;
        if (pts.every((q) => distanceTo(s.query, q) <= ON_SURFACE)) {
          owner = s.id;
          break;
        }
      }
      owners.push(owner);
    }
  } finally {
    surfaces.forEach((s) => {
      s.query.delete();
      s.shell.delete();
    });
  }
  return owners;
}

function distanceTo(query: DistanceQuery, at: [number, number, number]): number {
  const v = makeVertex(at);
  try {
    return query.distanceTo(v);
  } finally {
    v.delete();
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
