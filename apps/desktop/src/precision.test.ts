import { describe, expect, it } from "vitest";
import type { Point2 } from "@studio3d/document";
import {
  DEFAULT_SNAPS,
  SNAP_KINDS,
  boundaryEdges,
  constrain,
  crossing,
  editSide,
  findSnap,
  formatBearing,
  midBetween,
  parseDirection,
  along,
  parsePoint,
  regularPolygon,
  sideOf,
  snapScene,
  centroid,
  tangentPoints,
} from "./precision";

/** 10 screen pixels per mm, origin at the top-left, y up. */
const toScreen = ([u, v]: Point2): Point2 => [u * 10, -v * 10];

describe("typed points", () => {
  const last: Point2 = [10, 20];
  it("x,y is from the origin; @dx,dy from the last point; @length<angle goes that far at that angle", () => {
    expect(parsePoint("30,40", last)).toEqual([30, 40]);
    expect(parsePoint("-5.5, 2", last)).toEqual([-5.5, 2]);
    expect(parsePoint("@5,-20", last)).toEqual([15, 0]);
    expect(parsePoint("@50<0", last)).toEqual([60, 20]);
    expect(parsePoint("@10<90", last)).toEqual([10, 30]);
    expect(parsePoint("@20<-90", last)).toEqual([10, 0]);
    const p = parsePoint("@50<30", last)!;
    expect(Math.hypot(p[0] - 10, p[1] - 20)).toBeCloseTo(50, 5);
  });

  it("isn't a point until it's complete", () => {
    for (const t of ["", "30", "30,", "@", "@5", "@5,", "@5<", ",3", "1,2,3", "@1<2<3"])
      expect(parsePoint(t, last)).toBeNull();
  });
});

describe("ortho lock and angle steps", () => {
  const from: Point2 = [0, 0];
  it("ortho keeps a side straight across or straight up, whichever the pointer is nearer", () => {
    expect(constrain(from, [20, 3], { ortho: true, step: 0 }, 1)).toEqual({ point: [20, 0], angle: 0 });
    expect(constrain(from, [4, -31.4], { ortho: true, step: 0 }, 1)).toEqual({ point: [0, -31], angle: 270 });
    expect(constrain(from, [-12, 5], { ortho: true, step: 0 }, 0).point).toEqual([-12, 0]);
  });

  it("angle steps click onto the nearest step only when close", () => {
    const near = constrain(from, [30, 16.5], { ortho: false, step: 30 }, 0); // about 28.8°
    expect(near.angle).toBe(30);
    expect(sideOf([from, near.point], 0).angle).toBeCloseTo(30, 6);
    const far = constrain(from, [30, 9], { ortho: false, step: 30 }, 0); // about 16.7°
    expect(far).toEqual({ point: [30, 9], angle: null });
    expect(constrain(from, [30, 9], { ortho: false, step: 0 }, 1).angle).toBeNull();
  });

  it("rounds the length along the held direction to the grid, not the corner to the grid", () => {
    const r = constrain([0.3, 0.3], [10.2, 10.6], { ortho: false, step: 45 }, 1);
    expect(r.angle).toBe(45);
    expect(Math.hypot(r.point[0] - 0.3, r.point[1] - 0.3)).toBeCloseTo(14, 5); // 14.28 along the 45° line
  });
});

describe("object snaps", () => {
  const square: Point2[] = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ];
  const scene = snapScene(
    [
      { kind: "polygon", points: square },
      { kind: "circle", x: 40, y: 10, diameter: 6 },
    ],
    [],
    [],
  );

  it("snaps to ends, middles and circle centres near the pointer", () => {
    expect(findSnap(scene, [19.6, 0.3], null, 10, toScreen)).toEqual({ kind: "end", point: [20, 0] });
    expect(findSnap(scene, [10.4, 0.2], null, 10, toScreen)).toEqual({ kind: "middle", point: [10, 0] });
    expect(findSnap(scene, [40.5, 9.5], null, 10, toScreen)).toEqual({ kind: "centre", point: [40, 10] });
    expect(findSnap(scene, [30, 30], null, 10, toScreen)).toBeNull();
  });

  it("snaps to a circle's quadrants: its top, bottom, left and right", () => {
    expect(findSnap(scene, [42.8, 10.2], null, 10, toScreen)).toEqual({ kind: "quadrant", point: [43, 10] });
    expect(findSnap(scene, [40.1, 7.2], null, 10, toScreen)).toEqual({ kind: "quadrant", point: [40, 7] });
  });

  it("only uses the snaps that are turned on", () => {
    expect(findSnap(scene, [19.6, 0.3], null, 10, toScreen, ["middle"])).toBeNull();
    expect(findSnap(scene, [10.4, 0.2], null, 10, toScreen, ["end"])).toBeNull();
    expect(findSnap(scene, [42.8, 10.2], null, 10, toScreen, ["centre"])).toBeNull();
  });

  it("'on the line' lands on a side or circle only when nothing else is near", () => {
    const all = SNAP_KINDS;
    expect(findSnap(scene, [6.3, 0.4], null, 10, toScreen, all)).toEqual({ kind: "nearest", point: [6.3, 0] });
    // Near the side's middle, the middle wins.
    expect(findSnap(scene, [10.3, 0.4], null, 10, toScreen, all)).toEqual({ kind: "middle", point: [10, 0] });
    const onCircle = findSnap(scene, [42.2, 12.2], null, 10, toScreen, all)!;
    expect(onCircle.kind).toBe("nearest");
    expect(Math.hypot(onCircle.point[0] - 40, onCircle.point[1] - 10)).toBeCloseTo(3, 5);
    // Off by default, as in AutoCAD.
    expect(DEFAULT_SNAPS).not.toContain("nearest");
    expect(findSnap(scene, [6.3, 0.4], null, 10, toScreen)).toBeNull();
  });

  it("finds the point halfway between two others", () => {
    expect(midBetween([0, 0], [20, 10])).toEqual([10, 5]);
    expect(midBetween([1.1, 2.2], [3.3, 4.4])).toEqual([2.2, 3.3]);
  });

  it("snaps square to a side from the last corner", () => {
    expect(findSnap(scene, [6.3, 19.7], [6, 50], 10, toScreen)).toEqual({ kind: "perpendicular", point: [6, 20] });
  });

  it("snaps to where two sides cross", () => {
    const cross = snapScene(
      [
        {
          kind: "polygon",
          points: [
            [0, 0],
            [10, 10],
            [10, 0],
          ],
        },
        {
          kind: "polygon",
          points: [
            [0, 10],
            [10, 0.5],
            [0, 0.5],
          ],
        },
      ],
      [],
      [],
    );
    const s = findSnap(cross, [5.2, 5], null, 10, toScreen)!;
    expect(s.kind).toBe("intersection");
    expect(
      crossing(
        [
          [0, 0],
          [10, 10],
        ],
        [
          [0, 10],
          [10, 0.5],
        ],
      ),
    ).toEqual(s.point.map((v) => expect.closeTo(v, 6)));
  });

  it("an end beats a middle at the same spot, and the sides being drawn count too", () => {
    const drawing: Point2[] = [
      [100, 0],
      [110, 0],
    ];
    const s = snapScene([], [], drawing);
    expect(findSnap(s, [105.2, 0], null, 10, toScreen)).toEqual({ kind: "middle", point: [105, 0] });
    expect(findSnap(s, [100.3, 0.2], null, 10, toScreen)).toEqual({ kind: "end", point: [100, 0] });
  });

  it("a face's outline is its triangles' outside edges, not the diagonals inside", () => {
    const tri: Point2[] = [
      [0, 0],
      [30, 0],
      [30, 10],
      [0, 0],
      [30, 10],
      [0, 10],
    ];
    const edges = boundaryEdges(tri);
    expect(edges).toHaveLength(4);
    const face = snapScene([], edges, []);
    // The diagonal's middle (15, 5) isn't a snap; the bottom edge's middle is.
    expect(findSnap(face, [15, 5], null, 10, toScreen)).toBeNull();
    expect(findSnap(face, [15, 0.4], null, 10, toScreen)).toEqual({ kind: "middle", point: [15, 0] });
  });
});

describe("more snaps: shape centre, tangent, point and grid", () => {
  const L: Point2[] = [
    [0, 0],
    [30, 0],
    [30, 10],
    [10, 10],
    [10, 30],
    [0, 30],
  ];
  const scene = snapScene(
    [
      { kind: "polygon", points: L },
      { kind: "rectangle", x: 50, y: 0, width: 20, height: 10 },
      { kind: "circle", x: 100, y: 0, diameter: 10 },
    ],
    [],
    [],
  );

  it("a closed shape's centre of area, worked out by hand for an L", () => {
    // 30x10 (centre 15,5) + 10x20 (centre 5,20): area 300 + 200 -> (11, 11).
    expect(centroid(L)).toEqual([11, 11].map((v) => expect.closeTo(v, 9)));
    expect(findSnap(scene, [11.3, 10.8], null, 10, toScreen)).toEqual({ kind: "geometric", point: [11, 11] });
    expect(findSnap(scene, [60.2, 5.3], null, 10, toScreen)).toEqual({ kind: "geometric", point: [60, 5] });
  });

  it("tangent points from the last corner just touch the circle, square to its radius", () => {
    const from: Point2 = [100, 20];
    const ts = tangentPoints(from, [100, 0], 5);
    expect(ts).toHaveLength(2);
    for (const t of ts) {
      expect(Math.hypot(t[0] - 100, t[1])).toBeCloseTo(5, 9);
      // The radius to the touching point is square to the line from the corner.
      expect((t[0] - 100) * (from[0] - t[0]) + t[1] * (from[1] - t[1])).toBeCloseTo(0, 9);
    }
    const right = ts.find((t) => t[0] > 100)!;
    const s = findSnap(scene, [right[0] + 0.2, right[1] - 0.2], from, 10, toScreen, ["tangent"])!;
    expect(s.kind).toBe("tangent");
    expect(s.point).toEqual(right.map((v) => expect.closeTo(v, 5)));
    // No last corner, or a corner inside the circle: no tangent.
    expect(findSnap(scene, right, null, 10, toScreen, ["tangent"])).toBeNull();
    expect(tangentPoints([101, 1], [100, 0], 5)).toEqual([]);
  });

  it("the origin is a point to snap to", () => {
    expect(findSnap(snapScene([], [], []), [0.3, -0.2], null, 10, toScreen)).toEqual({ kind: "node", point: [0, 0] });
  });

  it("with nothing near, the grid snap goes to the nearest grid point; turned off, nothing does", () => {
    expect(findSnap(scene, [42.4, 47.6], null, 10, toScreen, DEFAULT_SNAPS, 5)).toEqual({
      kind: "grid",
      point: [40, 50],
    });
    expect(findSnap(scene, [42.4, 47.6], null, 10, toScreen, ["end"], 5)).toBeNull();
    // Something near still wins over the grid.
    expect(findSnap(scene, [29.6, 0.3], null, 10, toScreen, DEFAULT_SNAPS, 5)!.kind).toBe("end");
  });
});

describe("editing one side of an outline", () => {
  // An L: 40 across, 10 up, 30 back, 20 up, 10 back, then down to the start.
  const L: Point2[] = [
    [0, 0],
    [40, 0],
    [40, 10],
    [10, 10],
    [10, 30],
    [0, 30],
  ];

  it("a longer side pushes the corners after it along, keeping their sides", () => {
    const out = editSide(L, 0, { length: 50 });
    expect(out).toEqual([
      [0, 0],
      [50, 0],
      [50, 10],
      [20, 10],
      [20, 30],
      [10, 30],
    ]);
    for (const i of [1, 2, 3]) expect(sideOf(out, i)).toEqual(sideOf(L, i));
  });

  it("turning a side turns the rest with it; the closing side takes up the change", () => {
    const out = editSide(L, 3, { angle: 100 });
    expect(out.slice(0, 4)).toEqual(L.slice(0, 4));
    expect(sideOf(out, 3).angle).toBeCloseTo(100, 4); // corners keep 6 decimals of a mm
    expect(sideOf(out, 3).length).toBeCloseTo(20, 6);
    expect(sideOf(out, 4)).toEqual(sideOf(L, 4));
  });

  it("doesn't drift: many edits there and back come back to the same corners", () => {
    let pts = L;
    for (let n = 0; n < 200; n++) {
      pts = editSide(pts, 1, { length: 10 + (n % 7) * 3.3333, angle: 90 + (n % 5) * 7.77 });
    }
    pts = editSide(pts, 1, { length: 10, angle: 90 });
    pts.forEach((p, i) => p.forEach((v, j) => expect(v).toBeCloseTo(L[i]![j]!, 5)));
  });

  it("the closing side can't be set directly", () => {
    expect(() => editSide(L, 5, { length: 3 })).toThrow();
  });
});

describe("directions as bearings or angles", () => {
  it("reads surveyor's bearings, with or without degree marks, minutes and seconds", () => {
    expect(parseDirection("N45E")).toBe(45);
    expect(parseDirection("N 45° E")).toBe(45);
    expect(parseDirection("n30w")).toBe(120);
    expect(parseDirection("S 60 E")).toBe(330);
    expect(parseDirection("S10W")).toBe(260);
    expect(parseDirection("N 30 30 E")).toBe(59.5);
    expect(parseDirection(`N 12°15'36" E`)).toBeCloseTo(77.74, 9);
    expect(parseDirection("N0E")).toBe(90);
    expect(parseDirection("S90W")).toBe(180);
  });

  it("reads plain angles, anticlockwise from straight right", () => {
    expect(parseDirection("30")).toBe(30);
    expect(parseDirection("-90")).toBe(270);
    expect(parseDirection("450")).toBe(90);
  });

  it("refuses anything that isn't a direction", () => {
    for (const bad of ["", "N", "N95E", "E45N", "N45", "N 30 75 E", "abc"]) expect(parseDirection(bad), bad).toBeNull();
  });

  it("writes an angle back as a bearing", () => {
    expect(formatBearing(45)).toBe("N 45° E");
    expect(formatBearing(120)).toBe("N 30° W");
    expect(formatBearing(330)).toBe("S 60° E");
    expect(formatBearing(59.5)).toBe("N 30° 30' E");
    expect(formatBearing(90)).toBe("N");
    expect(formatBearing(0)).toBe("E");
    expect(formatBearing(180)).toBe("W");
    for (const a of [12.25, 200.5, 301.125]) expect(parseDirection(formatBearing(a))).toBeCloseTo(a, 9);
  });

  it("finds the end of a side from its length and direction", () => {
    expect(along([0, 0], 10, 90)).toEqual([0, 10]);
    expect(along([5, 5], 10, parseDirection("N 45 E")!)).toEqual(
      [5 + 10 / Math.SQRT2, 5 + 10 / Math.SQRT2].map((v) => Math.round(v * 1e6) / 1e6),
    );
  });
});

describe("regular polygons", () => {
  it("a hexagon 5.5 mm across its flats, like an M3 nut, with a flat facing the pointer", () => {
    const hex = regularPolygon([10, 0], 5.5, 6, 0);
    expect(hex).toHaveLength(6);
    // The two upright flats are 5.5 apart; the corners sit 5.5 / cos 30° apart.
    const xs = hex.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5.5, 5);
    const corner = Math.hypot(hex[0]![0] - 10, hex[0]![1]);
    expect(2 * corner).toBeCloseTo(5.5 / Math.cos(Math.PI / 6), 5);
    // Every side is the same length.
    const sides = hex.map((p, i) =>
      Math.hypot(...([0, 1].map((k) => hex[(i + 1) % 6]![k]! - p[k]!) as [number, number])),
    );
    for (const s of sides) expect(s).toBeCloseTo(sides[0]!, 5);
  });

  it("turns so a flat's middle points the given way", () => {
    const square = regularPolygon([0, 0], 10, 4, 90);
    // A square facing up has its top side flat at y = 5.
    expect(square.filter((p) => Math.abs(p[1] - 5) < 1e-6)).toHaveLength(2);
  });
});
