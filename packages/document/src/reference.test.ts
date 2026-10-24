import { describe, expect, it } from "vitest";
import {
  PLATE_PLANE,
  calibratedScale,
  newReference,
  parseProject,
  referenceCorners,
  referenceOnPlane,
  referencePlane,
  referenceSize,
  serializeProject,
  validateReference,
  type ProjectDocument,
  type ReferenceImage,
  type SketchPlane,
} from "./index";

const SRC = "data:image/png;base64,iVBORw0KGgo=";
const picture = (over: Partial<ReferenceImage> = {}): ReferenceImage => ({
  ...newReference(SRC, [200, 100], "bracket"),
  id: "r1",
  ...over,
});
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("reference pictures", () => {
  it("calibrating: two points 160 pixels apart that are really 80 mm make a pixel 0.5 mm", () => {
    expect(calibratedScale([20, 50], [180, 50], 80)).toBe(0.5);
    expect(calibratedScale([0, 0], [30, 40], 10)).toBe(0.2); // 50 pixels on a slant
    expect(calibratedScale([5, 5], [5, 5], 10)).toBeNull();
    expect(calibratedScale([0, 0], [100, 0], 0)).toBeNull();
    expect(calibratedScale([0, 0], [100, 0], Number.NaN)).toBeNull();
  });

  it("starts 200 mm across, standing on the plate when it faces the front", () => {
    expect(referenceSize(picture())).toEqual([200, 100]);
    expect(picture().y).toBe(0);
    const front = newReference(SRC, [200, 100], "front", "front");
    expect(front.y).toBe(50);
    near(referenceCorners(front)[0], [-100, 0, 0]);
  });

  it("its corners are at its real size, place and turn", () => {
    const r = picture({ scale: 0.5, x: 10, y: -5, offset: 2 }); // 100 x 50 mm
    near(referenceCorners(r).flat(), [-40, -30, 2, 60, -30, 2, 60, 20, 2, -40, 20, 2]);
    const turned = referenceCorners(picture({ scale: 0.5, rotation: 90 }));
    near(turned[0], [25, -50, 0]); // bottom-left swings round to the bottom-right
    const right = referenceCorners(picture({ scale: 0.5, plane: "right", offset: -30 }));
    near(right[0], [-30, -50, -25]);
    near(right[2], [-30, 50, 25]);
    expect(referencePlane({ plane: "front", offset: 4 }).origin).toEqual([0, -4, 0]);
  });

  it("shows under a drawing facing the same way, at its place in the drawing's own coordinates", () => {
    const r = picture({ scale: 0.5, x: 10, y: 20, rotation: 30 });
    const onPlate = referenceOnPlane(r, PLATE_PLANE)!;
    near(onPlate.centre, [10, 20]);
    expect(onPlate.size).toEqual([100, 50]);
    expect(onPlate.rotation).toBeCloseTo(30, 9);
    // A face 15 mm up whose drawing starts at (-30, -20): the picture is seen from above all the same.
    const top: SketchPlane = { origin: [-30, -20, 15], xDir: [1, 0, 0], normal: [0, 0, 1] };
    near(referenceOnPlane(r, top)!.centre, [40, 40]);
    const front: SketchPlane = { origin: [0, -20, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
    expect(referenceOnPlane(r, front)).toBeNull();
    expect(referenceOnPlane(picture({ plane: "front" }), front)).not.toBeNull();
  });

  it("explains settings it can't use, and never changes them", () => {
    expect(validateReference(picture())).toEqual([]);
    expect(validateReference(picture({ scale: 0 }))[0]!.message).toBe("The scale needs to be more than 0.");
    expect(validateReference(picture({ opacity: 0.05 }))[0]!.field).toBe("opacity");
    expect(validateReference(picture({ x: Number.NaN }))[0]!.message).toBe("Across needs to be a number.");
  });

  it("is saved with the project, and a damaged one is reported", () => {
    const doc: ProjectDocument = { units: "mm", features: [], references: [picture({ scale: 0.25, onTop: true })] };
    const text = serializeProject(doc, { name: "Studio 3D", version: "test" });
    const back = parseProject(text);
    expect(back.ok && back.document).toEqual(doc);
    const none = parseProject(serializeProject({ units: "mm", features: [] }, { name: "Studio 3D", version: "test" }));
    expect(none.ok && none.document.references).toBeUndefined();
    const broken = JSON.parse(text);
    broken.document.references[0].src = "https://example.com/x.png";
    const r = parseProject(JSON.stringify(broken));
    expect(!r.ok && r.error).toBe(
      "This project file is damaged: reference image 1 doesn't hold a picture this version can show.",
    );
  });
});
