import { describe, expect, it } from "vitest";
import type { Point2 } from "@studio3d/document";
import { boundaryEdges, constrain, crossing, editSide, findSnap, parsePoint, sideOf, snapScene } from "./precision";

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
