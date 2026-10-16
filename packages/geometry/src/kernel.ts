// The only module that talks to the geometry kernel (OCCT through replicad).
// Everything else uses the plain data it returns, so the kernel can be swapped later.
import {
  setOC,
  draw,
  drawCircle,
  drawRectangle,
  makeBaseBox,
  makeCylinder,
  makeSphere,
  measureVolume,
  Plane,
  type Drawing,
  type Shape3D,
} from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import {
  hasErrors,
  holeEdgeIssues,
  shapeSize,
  shapeVolume,
  validateDocument,
  validateShape,
  add3,
  profileArea,
  scale,
  type BoxFeature,
  type Profile,
  type SketchFeature,
  type HoleFeature,
  type Issue,
  type ProjectDocument,
  type ShapeFeature,
} from "@studio3d/document";
import type { Measurements, MeshData } from "./protocol";

export function useKernel(oc: OpenCascadeInstance): void {
  setOC(oc);
}

/** Display quality. 0.05 mm chord error is finer than any printer resolves. */
const MESH = { tolerance: 0.05, angularTolerance: 0.2 } as const;
const STL = { tolerance: 0.01, angularTolerance: 0.1 } as const;

export type BuildResult =
  | { ok: true; shape: Shape3D; measurements: Measurements; issues: Issue[] }
  | { ok: false; issues: Issue[] };

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
    case "cylinder":
      return makeCylinder(s.diameter / 2, s.height, [s.x, s.y, s.z], [0, 0, 1]);
    case "tube": {
      const outer = makeCylinder(
        s.outerDiameter / 2,
        s.height,
        [s.x, s.y, s.z],
        [0, 0, 1],
      );
      const inner = makeCylinder(
        s.innerDiameter / 2,
        s.height + 2,
        [s.x, s.y, s.z - 1],
        [0, 0, 1],
      );
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
      return profile
        .sketchOnPlane("XZ")
        .revolve([0, 0, 1])
        .translate([s.x, s.y, s.z]) as Shape3D;
    }
    case "sphere":
      return makeSphere(s.diameter / 2).translate([
        s.x,
        s.y,
        s.z + s.diameter / 2,
      ]);
  }
}

const near = (a: number, b: number, scale = 1) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b), scale);

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
  const ok =
    Math.abs(volume - expected) <= 1e-6 * expected &&
    size.every((v, i) => near(v, want[i]!));
  if (!ok) {
    shape.delete();
    throw new ShapeCheckFailed(
      `${s.name} came out wrong, so your last good version was kept.`,
      s.id,
    );
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
function combine(part: Part, s: ShapeFeature, issues: Issue[]): Part {
  const tool = makeShape(s);
  const v = shapeVolume(s);
  return applyTool(part, { shape: tool, least: v, most: v }, s, issues);
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
): Part {
  let result: Shape3D;
  try {
    result =
      s.mode === "add"
        ? part.shape.fuse(tool.shape)
        : part.shape.cut(tool.shape);
  } finally {
    tool.shape.delete();
  }
  const volume = measureVolume(result);
  const pieces = result.solids.length;
  const eps = 1e-6 * (part.volume + tool.most);
  const warn = (message: string) =>
    issues.push({ severity: "warning", featureId: s.id, field: null, message });

  if (s.mode === "add") {
    const ok =
      volume >= Math.max(part.volume, tool.least) - eps &&
      volume <= part.volume + tool.most + eps &&
      pieces >= 1;
    if (!ok) {
      result.delete();
      throw new ShapeCheckFailed(
        `${s.name} came out wrong when added, so your last good version was kept.`,
        s.id,
      );
    }
    if (pieces > part.pieces)
      warn(
        `${s.name} doesn't touch the rest of the part, so it will print as a separate piece.`,
      );
  } else {
    const removed = part.volume - volume;
    if (pieces === 0 || volume <= eps) {
      result.delete();
      throw new ShapeCheckFailed(
        `${s.name} would cut away the whole part. Make it smaller or move it.`,
        s.id,
      );
    }
    if (removed < -eps || removed > tool.most + eps) {
      result.delete();
      throw new ShapeCheckFailed(
        `${s.name} came out wrong when cut, so your last good version was kept.`,
        s.id,
      );
    }
    if (removed <= eps)
      warn(`${s.name} doesn't cut anything. Move it so it overlaps the part.`);
    else if (pieces > part.pieces)
      warn(`${s.name} splits the part into ${pieces} separate pieces.`);
  }
  return { shape: result, volume, pieces };
}

/** One outline as a flat drawing in sketch coordinates. */
function drawProfile(p: Profile): Drawing {
  switch (p.kind) {
    case "rectangle":
      return drawRectangle(p.width, p.height).translate(
        p.x + p.width / 2,
        p.y + p.height / 2,
      );
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
  let tool: Shape3D | null = null;
  let least = 0;
  let most = 0;
  try {
    for (const p of s.profiles) {
      const solid = drawProfile(p)
        .sketchOnPlane(new Plane(origin, s.plane.xDir, s.plane.normal))
        .extrude(cut ? -length : length) as Shape3D;
      const want = profileArea(p) * length;
      if (Math.abs(measureVolume(solid) - want) > 1e-6 * want) {
        solid.delete();
        throw new ShapeCheckFailed(
          `${s.name} came out wrong, so your last good version was kept.`,
          s.id,
        );
      }
      least = Math.max(least, want);
      most += want;
      if (!tool) tool = solid;
      else {
        const joined: Shape3D = tool.fuse(solid);
        tool.delete();
        solid.delete();
        tool = joined;
      }
    }
  } catch (e) {
    tool?.delete();
    throw e;
  }
  if (!tool)
    throw new ShapeCheckFailed(
      `${s.name} is empty. Draw at least one shape in it.`,
      s.id,
    );
  const v = measureVolume(tool);
  if (v < least * (1 - 1e-6) || v > most * (1 + 1e-6)) {
    tool.delete();
    throw new ShapeCheckFailed(
      `${s.name} came out wrong, so your last good version was kept.`,
      s.id,
    );
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
function drill(part: Part, h: HoleFeature, issues: Issue[]): Part {
  const bb = part.shape.boundingBox;
  const [min, max] = bb.bounds;
  const height = max[2] - min[2];
  const edge = holeEdgeIssues(h, min, max, height);
  if (hasErrors(edge))
    throw new ShapeCheckFailed(edge[0]!.message, h.id, edge[0]!.field);
  issues.push(...edge);

  const extra = 1; // the tool pokes 1 mm past the faces it cuts, so no paper-thin skin is left behind
  const bottom = h.depth === 0 ? min[2] - extra : max[2] - h.depth;
  const tool = makeCylinder(
    h.diameter / 2,
    max[2] + extra - bottom,
    [h.x, h.y, bottom],
    [0, 0, 1],
  );
  let result: Shape3D;
  try {
    result = part.shape.cut(tool);
  } finally {
    tool.delete();
  }
  const volume = measureVolume(result);
  const removed = part.volume - volume;
  const most = maxHoleVolume(h, height);
  if (
    !(volume > 0) ||
    removed > most * (1 + 1e-6) + 1e-6 ||
    removed < -1e-6 * part.volume
  ) {
    result.delete();
    throw new ShapeCheckFailed(
      `${h.name} came out wrong, so your last good version was kept.`,
      h.id,
    );
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

/** Builds the whole design: each step in order, checking every result. */
export function buildDocument(doc: ProjectDocument): BuildResult {
  if (!doc.features.length)
    return {
      ok: false,
      issues: [kernelIssue("There's nothing to build yet.")],
    };
  const issues = validateDocument(doc);
  if (hasErrors(issues)) return { ok: false, issues };

  let part: Part | null = null;
  for (const f of doc.features) {
    try {
      let next: Part;
      if (f.type === "hole") next = drill(part!, f, issues);
      else if (f.type === "sketch") {
        const tool = makeSketchTool(f, partSpan(part));
        next = part
          ? applyTool(part, tool, f, issues)
          : {
              shape: tool.shape,
              volume: measureVolume(tool.shape),
              pieces: tool.shape.solids.length,
            };
      } else if (!part) {
        const shape = makeShape(f);
        next = {
          shape,
          volume: measureVolume(shape),
          pieces: shape.solids.length,
        };
      } else next = combine(part, f, issues);
      part?.shape.delete();
      part = next;
    } catch (e) {
      part?.shape.delete();
      return { ok: false, issues: [failure(e, f.id, f.name)] };
    }
  }
  return {
    ok: true,
    shape: part!.shape,
    measurements: measure(part!.shape),
    issues,
  };
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
  };
}

export async function exportStl(shape: Shape3D): Promise<ArrayBuffer> {
  return dropDegenerateTriangles(
    await shape.blobSTL({ binary: true, ...STL }).arrayBuffer(),
  );
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
  keep.forEach((t, i) =>
    out.set(src.subarray(84 + t * 50, 84 + (t + 1) * 50), 84 + i * 50),
  );
  return out.buffer;
}

const kernelIssue = (message: string): Issue => ({
  severity: "error",
  field: null,
  message,
});
