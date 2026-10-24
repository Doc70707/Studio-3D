import { describe, expect, it } from "vitest";
import { boxSideFace, newShape, type BoxFeature, type ProjectDocument } from "@studio3d/document";
import { faceForHoles, holeSteps } from "./faceHoles";

const box = { ...newShape({ units: "mm", features: [] }, "box"), id: "b", wall: 0 } as BoxFeature;
const doc: ProjectDocument = { units: "mm", features: [box] };
const top = boxSideFace(box, "top");

describe("holes placed while sketching on a face", () => {
  it("on the whole top of a box, the holes follow the box", () => {
    const face = faceForHoles(doc, { ...top, label: "top face" }, "b");
    expect(face.on).toEqual({ shape: "b", side: "top" });
    expect([face.across, face.up]).toEqual(["left", "bottom"]);
  });

  it("on a face that isn't a whole side of the box, they stay where the face was", () => {
    const shifted = {
      ...top.plane,
      origin: [top.plane.origin[0] + 5, ...top.plane.origin.slice(1)] as typeof top.plane.origin,
    };
    const face = faceForHoles(doc, { ...top, plane: shifted, label: "top face" }, "b");
    expect(face.on).toBeUndefined();
    expect(face.plane).toEqual(shifted);
  });

  it("become through holes measured from the face's left and bottom edges, named on from what's there", () => {
    const face = faceForHoles(doc, { ...top, label: "top face" }, "b");
    const withHole: ProjectDocument = {
      ...doc,
      features: [...doc.features, { id: "h", type: "hole", name: "Hole 1", x: 0, y: 0, diameter: 5, depth: 0 }],
    };
    const steps = holeSteps(withHole, face, [
      { id: "a", u: 10, v: 12.5, diameter: 6 },
      { id: "c", u: 3, v: 4, diameter: 3.4 },
    ]);
    expect(steps.map((h) => [h.id, h.name, h.x, h.y, h.diameter, h.depth])).toEqual([
      ["a", "Hole 2", 10, 12.5, 6, 0],
      ["c", "Hole 3", 3, 4, 3.4, 0],
    ]);
    expect(steps[0]!.face).toBe(face);
  });
});
