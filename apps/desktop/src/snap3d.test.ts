import { describe, expect, it } from "vitest";
import type { EdgeInfo, FaceInfo } from "@studio3d/geometry";
import { describeEdge, edgeAt, findSnap3, footOnEdge, quadrants, SNAPS_3D, type Vec3 } from "./snap3d";

// Looking straight down at 10 pixels per mm.
const toScreen = (p: Vec3): [number, number] => [p[0] * 10, -p[1] * 10];
const line = (start: Vec3, end: Vec3): EdgeInfo => ({
  kind: "line",
  start,
  end,
  middle: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
  closed: false,
  points: [start, end],
});
const circle = (centre: Vec3, radius: number): EdgeInfo => {
  const points: Vec3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * 2 * Math.PI;
    points.push([centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t), centre[2]]);
  }
  return {
    kind: "circle",
    start: points[0]!,
    end: points[0]!,
    middle: points[24]!,
    closed: true,
    points,
    centre,
    radius,
    axis: [0, 0, 1],
  };
};
// The top of a 40 x 20 block, 10 high, with a 6 mm hole at (30, 10).
const model = {
  edges: [
    line([0, 0, 10], [40, 0, 10]),
    line([40, 0, 10], [40, 20, 10]),
    line([40, 20, 10], [0, 20, 10]),
    line([0, 20, 10], [0, 0, 10]),
    circle([30, 10, 10], 3),
  ],
  faces: [{ kind: "plane", centre: [18, 10, 10] } as FaceInfo],
};
const at = (x: number, y: number, kinds = SNAPS_3D, extra = {}) =>
  findSnap3(model, { pointer: toScreen([x, y, 10]), toScreen, radius: 10, kinds, ...extra });

describe("3D snaps on the kernel's edges", () => {
  it("ends, middles, a hole's centre and the face's centre", () => {
    expect(at(39.6, 0.3)).toEqual({ kind: "end", point: [40, 0, 10] });
    expect(at(20.4, 19.8)).toEqual({ kind: "middle", point: [20, 20, 10] });
    expect(at(30.3, 9.8)).toEqual({ kind: "centre", point: [30, 10, 10] });
    expect(at(18.2, 9.7)).toEqual({ kind: "geometric", point: [18, 10, 10] });
  });

  it("a circle's quadrants, and only the snaps turned on", () => {
    const q = at(33.1, 10.2)!;
    expect(q.kind).toBe("quadrant");
    q.point.forEach((v, i) => expect(v).toBeCloseTo([33, 10, 10][i]!, 9));
    expect(quadrants(model.edges[4]!)).toHaveLength(4);
    expect(at(39.6, 0.3, ["middle"])).toBeNull();
  });

  it("square to an edge from the first point, and anywhere on an edge when nothing else is near", () => {
    expect(footOnEdge([12, 30, 10], model.edges[0]!)).toEqual([12, 0, 10]);
    expect(at(12.2, 0.3, ["perpendicular"], { from: [12, 30, 10] })).toEqual({
      kind: "perpendicular",
      point: [12, 0, 10],
    });
    const n = at(7.3, 0.4, ["nearest"])!;
    expect(n.kind).toBe("nearest");
    n.point.forEach((v, i) => expect(v).toBeCloseTo([7.3, 0, 10][i]!, 6));
  });

  it("the plate's 10 mm grid when the pointer is off the part", () => {
    expect(at(60, 60, SNAPS_3D, { plate: [63.4, 57.2, 0] })).toEqual({ kind: "grid", point: [60, 60, 0] });
    expect(at(60, 60, ["end"], { plate: [63.4, 57.2, 0] })).toBeNull();
  });

  it("the grid snap follows the squares drawn at this zoom", () => {
    expect(at(60, 60, SNAPS_3D, { plate: [63.4, 57.2, 0], gridStep: 1 })).toEqual({ kind: "grid", point: [63, 57, 0] });
    expect(at(60, 60, SNAPS_3D, { plate: [63.4, 57.2, 0], gridStep: 100 })).toEqual({
      kind: "grid",
      point: [100, 100, 0],
    });
    // Quarter inches: 6.35 mm squares, with no floating-point dust.
    expect(at(60, 60, SNAPS_3D, { plate: [6.2, -12.8, 0], gridStep: 6.35 })).toEqual({
      kind: "grid",
      point: [6.35, -12.7, 0],
    });
  });

  it("names the edge under the pointer", () => {
    const i = edgeAt(model, { pointer: toScreen([33, 10.5, 10]), toScreen, radius: 8 })!;
    expect(describeEdge(model.edges[i]!)).toBe("Circle, Ø6 mm");
    expect(describeEdge(model.edges[edgeAt(model, { pointer: toScreen([5, 0.2, 10]), toScreen, radius: 8 })!]!)).toBe(
      "Edge, 40 mm long",
    );
  });

  it("of a top corner and the bottom corner under it, the one nearer the eye wins", () => {
    const upright = { edges: [line([0, 0, 0], [0, 0, 10])], faces: [] };
    // Looking down: higher is nearer.
    const looking = (p: Vec3): [number, number, number] => [p[0] * 10, -p[1] * 10, -p[2]];
    expect(findSnap3(upright, { pointer: [1, 1], toScreen: looking, radius: 10, kinds: ["end"] })).toEqual({
      kind: "end",
      point: [0, 0, 10],
    });
  });
});
