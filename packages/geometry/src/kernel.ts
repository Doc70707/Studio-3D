// The only module that talks to the geometry kernel (OCCT through replicad).
// Everything else uses the plain data it returns, so the kernel can be swapped later.
import { setOC, makeBaseBox, measureVolume, type Shape3D } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import { hasErrors, validateBox, type BoxFeature, type Issue, type ProjectDocument } from "@studio3d/document";
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
    return { ok: false, issues: [kernelIssue("The geometry engine couldn't build this shape, so your last good version was kept.")] };
  }
}

/** Builds every feature. Today a document holds a single box. */
export function buildDocument(doc: ProjectDocument): BuildResult {
  const box = doc.features[0];
  if (!box) return { ok: false, issues: [kernelIssue("There's nothing to build yet.")] };
  return buildBox(box);
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
