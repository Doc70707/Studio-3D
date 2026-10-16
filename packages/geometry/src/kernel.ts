// The only module that talks to the geometry kernel (OCCT through replicad).
// Everything else uses the plain data it returns, so the kernel can be swapped later.
import { setOC, makeBaseBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import {
  boxOf,
  hasErrors,
  holesOf,
  validateBox,
  validateDocument,
  type BoxFeature,
  type HoleFeature,
  type Issue,
  type ProjectDocument,
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
export function expectedBoxVolume(b: BoxFeature): number {
  const outer = b.width * b.depth * b.height;
  if (b.wall === 0) return outer;
  return outer - (b.width - 2 * b.wall) * (b.depth - 2 * b.wall) * (b.height - b.wall);
}

export function buildBox(b: BoxFeature): BuildResult {
  const issues = validateBox(b);
  if (hasErrors(issues)) return { ok: false, issues };

  let shape: Shape3D | undefined;
  try {
    // Centred on the plate in X/Y, sitting on Z = 0.
    shape = makeBaseBox(b.width, b.depth, b.height);
    if (b.wall > 0) {
      const solid = shape;
      shape = solid.shell(b.wall, (f) => f.inPlane("XY", b.height));
      solid.delete();
    }
    const measurements = measure(shape);
    const expected = expectedBoxVolume(b);
    const sizeOk =
      near(measurements.size[0], b.width) && near(measurements.size[1], b.depth) && near(measurements.size[2], b.height);
    if (!sizeOk || Math.abs(measurements.volume - expected) > 1e-6 * expected) {
      shape.delete();
      return { ok: false, issues: [kernelIssue("The shape came out wrong, so your last good version was kept.")] };
    }
    return { ok: true, shape, measurements, issues };
  } catch {
    shape?.delete();
    return {
      ok: false,
      issues: [kernelIssue("The geometry engine couldn't build this shape, so your last good version was kept.")],
    };
  }
}

/** The most material a hole can remove: a full cylinder of its diameter and depth. */
export function maxHoleVolume(h: HoleFeature, box: BoxFeature): number {
  const depth = h.depth === 0 ? box.height : h.depth;
  return Math.PI * (h.diameter / 2) ** 2 * depth;
}

/**
 * Cuts one hole and checks the result. The cut must remove some material but never more than the
 * hole's own cylinder, and must leave the outside size unchanged. Otherwise the kernel did something
 * unexpected and the caller keeps the last good model.
 */
function cutHole(
  shape: Shape3D,
  h: HoleFeature,
  box: BoxFeature,
  before: number,
): { shape: Shape3D; volume: number; issues: Issue[] } {
  const extra = 1; // the tool pokes 1 mm past the faces it cuts, so no paper-thin skin is left behind
  const bottom = h.depth === 0 ? -extra : box.height - h.depth;
  const tool = makeCylinder(
    h.diameter / 2,
    box.height + extra - bottom,
    [h.x - box.width / 2, h.y - box.depth / 2, bottom],
    [0, 0, 1],
  );
  let result: Shape3D;
  try {
    result = shape.cut(tool);
  } finally {
    tool.delete();
  }
  const volume = measureVolume(result);
  const removed = before - volume;
  const max = maxHoleVolume(h, box);
  const size = result.boundingBox;
  const sizeOk = near(size.width, box.width) && near(size.height, box.depth) && near(size.depth, box.height);
  if (!(volume > 0) || removed > max * (1 + 1e-6) + 1e-6 || removed < -1e-6 * before || !sizeOk) {
    result.delete();
    throw new ShapeCheckFailed(`${h.name} came out wrong, so your last good version was kept.`, h.id);
  }
  const issues: Issue[] =
    removed <= 1e-9 * before
      ? [
          {
            severity: "warning",
            featureId: h.id,
            field: null,
            message: `${h.name} doesn't cut anything. It's in the empty space inside the box. Make it deeper or move it onto a wall.`,
          },
        ]
      : [];
  return { shape: result, volume, issues };
}

class ShapeCheckFailed extends Error {
  constructor(
    message: string,
    readonly featureId?: string,
  ) {
    super(message);
  }
}

/** Builds the whole design: the box, then each hole in order. */
export function buildDocument(doc: ProjectDocument): BuildResult {
  if (!doc.features.length) return { ok: false, issues: [kernelIssue("There's nothing to build yet.")] };
  const issues = validateDocument(doc);
  if (hasErrors(issues)) return { ok: false, issues };
  const box = boxOf(doc);
  const base = buildBox(box);
  if (!base.ok) return { ok: false, issues: base.issues.map((i) => ({ ...i, featureId: i.featureId ?? box.id })) };

  let shape = base.shape;
  let volume = base.measurements.volume;
  for (const h of holesOf(doc)) {
    try {
      const r = cutHole(shape, h, box, volume);
      shape.delete();
      shape = r.shape;
      volume = r.volume;
      issues.push(...r.issues);
    } catch (e) {
      shape.delete();
      const message =
        e instanceof ShapeCheckFailed
          ? e.message
          : `The geometry engine couldn't cut ${h.name}, so your last good version was kept.`;
      return { ok: false, issues: [{ severity: "error", featureId: h.id, field: null, message }] };
    }
  }
  return { ok: true, shape, measurements: measure(shape), issues };
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
  };
}

export async function exportStl(shape: Shape3D): Promise<ArrayBuffer> {
  return shape.blobSTL({ binary: true, ...STL }).arrayBuffer();
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
const kernelIssue = (message: string): Issue => ({ severity: "error", field: null, message });
