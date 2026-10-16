// Finding the faces of a displayed mesh, so a face can be clicked and sketched on.
import { faceOutline, type FaceOutline, type SketchPlane, type Vec3, dot, toSketch } from "@studio3d/document";
import type { MeshData } from "./protocol";

type FaceMesh = Pick<MeshData, "positions" | "indices" | "faces">;

export const faceCount = (mesh: FaceMesh) => mesh.faces.length / 2;

/** Which face a triangle (as numbered by a ray hit) belongs to, or -1. */
export function faceOfTriangle(mesh: FaceMesh, triangle: number): number {
  const index = triangle * 3;
  for (let f = 0; f < faceCount(mesh); f++) {
    const start = mesh.faces[2 * f]!;
    if (index >= start && index < start + mesh.faces[2 * f + 1]!) return f;
  }
  return -1;
}

/** The corners of a face's triangles, three per triangle. */
export function facePoints(mesh: FaceMesh, face: number): Vec3[] {
  const start = mesh.faces[2 * face]!;
  const count = mesh.faces[2 * face + 1]!;
  const out: Vec3[] = [];
  for (let i = start; i < start + count; i++) {
    const v = mesh.indices[i]! * 3;
    out.push([mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!]);
  }
  return out;
}

/** A face as a sketch surface, or null when it is curved. */
export const outlineOfFace = (mesh: FaceMesh, face: number): FaceOutline | null => faceOutline(facePoints(mesh, face));

/**
 * Everything of the part that lies flat in a sketch's surface, drawn in sketch coordinates.
 * Used to show the face under a sketch again when it is edited later, after the part has changed.
 */
export function trianglesInPlane(mesh: FaceMesh, plane: SketchPlane): [number, number][] {
  const out: [number, number][] = [];
  const w = dot(plane.origin, plane.normal);
  for (let f = 0; f < faceCount(mesh); f++) {
    const pts = facePoints(mesh, f);
    const outline = faceOutline(pts);
    if (!outline || dot(outline.plane.normal, plane.normal) < 0.9999) continue;
    if (pts.some((q) => Math.abs(dot(q, plane.normal) - w) > 1e-3)) continue;
    for (const q of pts) out.push(toSketch(plane, q));
  }
  return out;
}

/** The faces a design step made (by its feature id). Empty when the mesh doesn't say who made what. */
export function facesOf(mesh: Pick<MeshData, "owners">, id: string): number[] {
  const out: number[] = [];
  mesh.owners.forEach((o, f) => o === id && out.push(f));
  return out;
}

/** The corners of some faces' triangles, three per triangle, as one flat list for drawing. */
export function pointsOfFaces(mesh: FaceMesh, faces: number[]): Float32Array {
  return new Float32Array(faces.flatMap((f) => facePoints(mesh, f).flat()));
}
