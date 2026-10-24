import { describe, expect, it } from "vitest";
import { boxSideFace, boxSideOf } from "./holeFace";
import { newHole, newShape, newSketch, type BoxFeature, type ProjectDocument, type SketchFeature } from "./model";
import { PLATE_PLANE } from "./sketch";
import { copyStep, moveStep, scaleStep, turnProfiles, turnStep } from "./transform";

const doc: ProjectDocument = { units: "mm", features: [] };
const box = { ...newShape(doc, "box"), width: 40, depth: 20, height: 10 } as BoxFeature;
const patch = (c: ReturnType<typeof turnStep>) => {
  if ("reason" in c) throw new Error(c.reason);
  return c.patch;
};

describe("ROTATE", () => {
  it("adds to a box's turn, anticlockwise, kept between 0 and 360", () => {
    expect(patch(turnStep(box, 90))).toEqual({ rotation: 90 });
    expect(patch(turnStep({ ...box, rotation: 300 }, 90))).toEqual({ rotation: 30 });
    expect(patch(turnStep({ ...box, rotation: 90 }, -90))).toEqual({ rotation: 0 });
    expect(patch(turnStep(box, -45))).toEqual({ rotation: 315 });
  });

  it("says why for round shapes and holes, which look the same turned", () => {
    expect(turnStep(newShape(doc, "cylinder"), 45)).toEqual({
      reason: "Cylinder 1 is round, so it looks the same turned",
    });
    expect("reason" in turnStep(newHole(doc), 45)).toBe(true);
  });

  it("turns a sketch's outlines about their middle; a rectangle stays one at quarter turns", () => {
    const rect = { kind: "rectangle" as const, x: 0, y: 0, width: 40, height: 10 };
    expect(turnProfiles([rect], 90)).toEqual([{ kind: "rectangle", x: 15, y: -15, width: 10, height: 40 }]);
    const [slanted] = turnProfiles([rect], 45);
    if (slanted?.kind !== "polygon") throw new Error("expected an outline");
    // The middle stays put and the long side now runs at 45°.
    const [a, b] = slanted.points as [[number, number], [number, number]];
    expect(Math.atan2(b[1] - a[1], b[0] - a[0]) * (180 / Math.PI)).toBeCloseTo(45, 6);
    const mid = slanted.points.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0]);
    expect(mid[0]).toBeCloseTo(20, 6);
    expect(mid[1]).toBeCloseTo(5, 6);
  });

  it("won't turn a revolve or an empty sketch", () => {
    const sketch: SketchFeature = newSketch(doc, PLATE_PLANE, "plate", []);
    expect("reason" in turnStep(sketch, 90)).toBe(true);
    expect(
      "reason" in turnStep({ ...sketch, profiles: [{ kind: "circle", x: 5, y: 0, diameter: 2 }], revolve: 360 }, 9),
    ).toBe(true);
  });
});

describe("MOVE, SCALE and COPY", () => {
  it("moves shapes in x, y, z; holes from the top in x, y; sketches by their plane", () => {
    expect(patch(moveStep(box, [10, -5, 2]))).toEqual({ x: 10, y: -5, z: 2 });
    expect(patch(moveStep(newHole(doc), [3, 4, 9]))).toEqual({ x: 3, y: 4 });
    const sketch = newSketch(doc, PLATE_PLANE, "plate", [{ kind: "circle", x: 0, y: 0, diameter: 5 }]);
    expect(patch(moveStep(sketch, [1, 2, 3]))).toEqual({ plane: { ...PLATE_PLANE, origin: [1, 2, 3] } });
  });

  it("scales every size of a shape, a plain hole's diameter, and a sketch about its middle", () => {
    expect(patch(scaleStep(box, 2))).toEqual({ width: 80, depth: 40, height: 20, wall: box.wall * 2 });
    expect(patch(scaleStep(newHole(doc), 0.5))).toEqual({ diameter: 2.5 });
    expect("reason" in scaleStep({ ...newHole(doc), thread: "M5" }, 2)).toBe(true);
    expect("reason" in scaleStep(box, 0)).toBe(true);
    const sketch = newSketch(doc, PLATE_PLANE, "plate", [{ kind: "rectangle", x: 0, y: 0, width: 10, height: 10 }]);
    expect(patch(scaleStep(sketch, 2))).toEqual({
      profiles: [{ kind: "rectangle", x: -5, y: -5, width: 20, height: 20 }],
      depth: 10,
    });
  });

  it("copies a step with a new id and the next free name", () => {
    const d: ProjectDocument = { units: "mm", features: [{ ...box, name: "Box 1" }] };
    const copy = copyStep(d, d.features[0]!);
    expect(copy).toMatchObject({ type: "box", name: "Box 2", width: 40 });
    expect((copy as BoxFeature).id).not.toBe(box.id);
  });
});

describe("a turned box's sides", () => {
  it("turn with the box, so holes on them follow it", () => {
    const turned = { ...box, x: 10, rotation: 90 };
    const front = boxSideFace(turned, "front");
    // Turned a quarter anticlockwise, the box's front now faces +x, half its depth from the middle.
    expect(front.plane.normal).toEqual([1, 0, 0]);
    expect(front.plane.origin[0]).toBeCloseTo(20, 9);
    expect(front.width).toBe(40);
    expect(boxSideOf([1, 0, 0], 90)).toBe("front");
  });
});
