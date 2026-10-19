// Messages between the interface and the geometry worker. Plain data only.
import type { Issue, ProjectDocument } from "@studio3d/document";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Pairs of points for the shape's edges (line segments). */
  edges: Float32Array;
  /** The faces of the shape: [first index, index count] pairs into `indices`, one pair per face. */
  faces: Uint32Array;
  /** Which design step made each face (its feature id), or "" when no step did. Empty when not worked out. */
  owners: string[];
  /** Each edge of the shape as the kernel knows it (not cut into segments), for snapping to ends, middles, centres. */
  edgeInfo: EdgeInfo[];
  /** What each face is (in the order of `faces`): flat, a cylinder (with its axis) or another surface. */
  faceInfo: FaceInfo[];
}

type Point3 = [number, number, number];

export interface EdgeInfo {
  /** "circle" covers whole circles and arcs. */
  kind: "line" | "circle" | "other";
  start: Point3;
  end: Point3;
  /** Halfway along the edge itself (on an arc, on the arc). */
  middle: Point3;
  /** True for a whole circle or any edge that ends where it starts. */
  closed: boolean;
  /** Points along the edge, start to end, close enough together to find the nearest point on it. */
  points: Point3[];
  /** Circles only. */
  centre?: Point3;
  radius?: number;
  /** Circles only: the direction square to the circle's plane. */
  axis?: Point3;
}

export interface FaceInfo {
  kind: "plane" | "cylinder" | "other";
  /** The face's centre of area (its geometric centre). */
  centre: Point3;
  /** Cylinders only: a point on the axis, its direction, and the radius. */
  axis?: { point: Point3; direction: Point3 };
  radius?: number;
  /** Cylinders only: true when the material is outside the cylinder, as in a hole. */
  inside?: boolean;
}

export interface Measurements {
  /** mm³ */
  volume: number;
  /** Overall size [x, y, z] in mm. */
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Separate solid pieces; more than one means parts that don't touch. */
  solids: number;
}

export type Request = { id: number; kind: "rebuild"; document: ProjectDocument } | { id: number; kind: "exportStl" };

export type Response =
  | { id: number; kind: "ready" }
  | { id: number; kind: "rebuilt"; ok: true; mesh: MeshData; measurements: Measurements; issues: Issue[] }
  | { id: number; kind: "rebuilt"; ok: false; issues: Issue[] }
  | { id: number; kind: "stl"; ok: true; data: ArrayBuffer }
  | { id: number; kind: "stl"; ok: false; error: string }
  | { id: number; kind: "fatal"; error: string };
