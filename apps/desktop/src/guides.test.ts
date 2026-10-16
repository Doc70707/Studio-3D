import { describe, expect, it } from "vitest";
import { newDocument, newHole, newShape, type ShapeFeature } from "@studio3d/document";
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
});
