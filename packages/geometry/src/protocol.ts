// Messages between the interface and the geometry worker. Plain data only.
import type { Issue, ProjectDocument } from "@studio3d/document";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Pairs of points for the shape's edges (line segments). */
  edges: Float32Array;
}

export interface Measurements {
  /** mm³ */
  volume: number;
  /** Overall size [x, y, z] in mm. */
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

export type Request =
  | { id: number; kind: "rebuild"; document: ProjectDocument }
  | { id: number; kind: "exportStl" };

export type Response =
  | { id: number; kind: "ready" }
  | { id: number; kind: "rebuilt"; ok: true; mesh: MeshData; measurements: Measurements; issues: Issue[] }
  | { id: number; kind: "rebuilt"; ok: false; issues: Issue[] }
  | { id: number; kind: "stl"; ok: true; data: ArrayBuffer }
  | { id: number; kind: "stl"; ok: false; error: string }
  | { id: number; kind: "fatal"; error: string };
