import { describe, expect, it } from "vitest";
import { boxSideFace, newDocument, newHole, newShape, type BoxFeature, type ShapeFeature } from "@studio3d/document";
import { featureDimensions } from "./guides";

const part = { min: [-30, -20, 0] as const, max: [30, 20, 30] as const };

describe("measurements for the selected shape or hole", () => {
  it("a hole shows its diameter and its distance from the left and front edges", () => {
    const h = { ...newHole(newDocument()), x: -5, y: 0, diameter: 6 };
    expect(featureDimensions(h, part).map((d) => d.text)).toEqual(["Ø6 mm", "25 mm", "20 mm"]);
  });

  it("a shape shows its size and where it sits on the part", () => {
    const c = { ...newShape(newDocument(), "cylinder"), x: 10, y: 0, z: 30, diameter: 10, height: 8 } as ShapeFeature;
    expect(featureDimensions(c, part).map((d) => d.text)).toEqual([
      "10 mm",
      "10 mm",
      "8 mm",
      "35 mm",
      "15 mm",
      "30 mm",
    ]);
  });

  it("the shape that is the whole part adds nothing (the overall size already shows it)", () => {
    const box = { ...newShape(newDocument(), "box"), width: 60, depth: 40, height: 30 } as ShapeFeature;
    expect(featureDimensions(box, part)).toEqual([]);
  });

  it("every guide is drawn in the selection colour", () => {
    const h = newHole(newDocument());
    expect(featureDimensions(h, part).every((d) => d.kind === "feature")).toBe(true);
  });

  it("a hole on a face shows its distances from the edges it's measured from, on that face", () => {
    const doc = newDocument();
    const box = doc.features[0] as BoxFeature; // 60 x 40 x 30
    const face = { ...boxSideFace(box, "front"), on: { shape: box.id, side: "front" as const } };
    const h = {
      ...newHole(doc),
      x: 12,
      y: 8,
      diameter: 6,
      face: { ...face, across: "right" as const, up: "bottom" as const },
    };
    const dims = featureDimensions(h, part, { ...doc, features: [box, h] });
    expect(dims.map((d) => d.text)).toEqual(["Ø6 mm", "12 mm", "8 mm"]);
    // All on the front face (y = -20), the right-edge distance ending at the hole's centre (18, -20, 8).
    for (const d of dims) expect([d.from[1], d.to[1]]).toEqual([-20, -20]);
    expect(dims[1]!.from).toEqual([30, -20, 8]);
    expect(dims[1]!.to).toEqual([18, -20, 8]);
    // Measured from the middle: nothing to show when it's right in the middle.
    const mid = { ...h, x: 0, y: 0, face: { ...face, across: "centre" as const, up: "centre" as const } };
    expect(featureDimensions(mid, part, { ...doc, features: [box, mid] }).map((d) => d.text)).toEqual(["Ø6 mm"]);
  });
});
