import { describe, expect, it } from "vitest";
import {
  PLATE_PLANE,
  axesFor,
  faceLabel,
  faceOutline,
  hasErrors,
  newDocument,
  newSketch,
  parseProject,
  polygonArea,
  selfIntersects,
  serializeProject,
  toSketch,
  toWorld,
  validateDocument,
  validateSketch,
  type Profile,
  type SketchFeature,
  type Vec3,
} from "./index";

const app = { name: "Studio 3D", version: "test" };
const sketch = (profiles: Profile[], over: Partial<SketchFeature> = {}): SketchFeature => ({
  ...newSketch(newDocument(), PLATE_PLANE, "plate", profiles),
  ...over,
});
const rect: Profile = { kind: "rectangle", x: 0, y: 0, width: 10, height: 5 };

describe("sketch surfaces", () => {
  it("drawing on a side face keeps 'up' pointing up", () => {
    const front = axesFor([0, -1, 0]);
    expect(front.xDir).toEqual([1, 0, 0]);
    const right = axesFor([1, 0, 0]);
    expect(right.xDir.map((n) => n + 0)).toEqual([0, 1, 0]);
  });

  it("names faces by the way they point", () => {
    expect(faceLabel([0, 0, 1])).toBe("top face");
    expect(faceLabel([0, -1, 0])).toBe("front face");
    expect(faceLabel([1, 1, 0])).toBe("angled face");
  });

  it("turns a flat face into a surface whose (0, 0) is its bottom-left corner", () => {
    // The right face of a 60 x 40 x 30 block, as two triangles.
    const a: Vec3 = [30, -20, 0],
      b: Vec3 = [30, 20, 0],
      c: Vec3 = [30, 20, 30],
      d: Vec3 = [30, -20, 30];
    const o = faceOutline([a, b, c, a, c, d])!;
    expect(o.label).toBe("right face");
    expect([o.width, o.height]).toEqual([40, 30]);
    expect(o.plane.origin).toEqual([30, -20, 0]);
    expect(toWorld(o.plane, [40, 30])).toEqual([30, 20, 30]);
    expect(toSketch(o.plane, [30, 0, 15])).toEqual([20, 15]);
  });

  it("refuses a curved face", () => {
    expect(
      faceOutline([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toBeNull();
  });
});

describe("outlines", () => {
  it("measures area either way round", () => {
    expect(
      polygonArea([
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ]),
    ).toBe(50);
    expect(
      polygonArea([
        [0, 0],
        [0, 5],
        [10, 5],
        [10, 0],
      ]),
    ).toBe(-50);
  });

  it("spots outlines that cross over themselves", () => {
    expect(
      selfIntersects([
        [0, 0],
        [10, 10],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(true);
    expect(
      selfIntersects([
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 30],
        [0, 30],
      ]),
    ).toBe(false);
    // A corner touching another edge counts as crossing.
    expect(
      selfIntersects([
        [0, 0],
        [10, 0],
        [5, 0],
        [5, 5],
      ]),
    ).toBe(true);
  });
});

describe("validateSketch", () => {
  it("accepts a simple sketch", () => {
    expect(validateSketch(sketch([rect]))).toEqual([]);
  });

  it.each([
    ["an empty sketch", [], {}, "is empty"],
    ["a tiny rectangle", [{ ...rect, width: 0.1 }], {}, "at least"],
    ["a circle with no size", [{ kind: "circle", x: 0, y: 0, diameter: 0 }], {}, "at least"],
    [
      "two corners only",
      [
        {
          kind: "polygon",
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      ],
      {},
      "at least 3 corners",
    ],
    [
      "a crossing outline",
      [
        {
          kind: "polygon",
          points: [
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10],
          ],
        },
      ],
      {},
      "crosses over itself",
    ],
    [
      "repeated corners",
      [
        {
          kind: "polygon",
          points: [
            [0, 0],
            [10, 0],
            [10, 0],
            [0, 10],
          ],
        },
      ],
      {},
      "same place",
    ],
    ["a zero height", [rect], { depth: 0 }, "Height must be"],
    ["a negative cut", [rect], { mode: "cut", depth: -1 }, "negative"],
    ["a broken surface", [rect], { plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [1, 0, 0] } }, "damaged"],
  ] as [string, Profile[], Partial<SketchFeature>, string][])("explains %s", (_, profiles, over, text) => {
    const issues = validateSketch(sketch(profiles, over));
    expect(hasErrors(issues)).toBe(true);
    expect(issues.map((i) => i.message).join(" ")).toContain(text);
  });

  it("a cut of depth 0 means all the way through", () => {
    expect(validateSketch(sketch([rect], { mode: "cut", depth: 0 }))).toEqual([]);
  });

  it("a part can start from a sketch drawn on the plate", () => {
    expect(validateDocument({ units: "mm", features: [sketch([rect])] })).toEqual([]);
    expect(
      hasErrors(
        validateDocument({
          units: "mm",
          features: [sketch([rect], { mode: "cut" })],
        }),
      ),
    ).toBe(true);
  });
});

describe("sketches in project files", () => {
  it("save and reopen exactly", () => {
    const doc = newDocument();
    doc.features.push(
      sketch(
        [
          rect,
          { kind: "circle", x: 3, y: 4, diameter: 2 },
          {
            kind: "polygon",
            points: [
              [0, 0],
              [4, 0],
              [0, 3],
            ],
          },
        ],
        {
          mode: "cut",
          depth: 0,
          surface: "top face",
          plane: { origin: [-30, -20, 30], xDir: [1, 0, 0], normal: [0, 0, 1] },
        },
      ),
    );
    const r = parseProject(serializeProject(doc, app));
    if (!r.ok) throw new Error(r.error);
    expect(r.document).toEqual(doc);
    expect(r.warnings).toEqual([]);
  });

  it.each([
    ["an unreadable surface", (f: Record<string, unknown>) => (f.plane = { origin: [0, 0] })],
    ["an unknown outline", (f: Record<string, unknown>) => (f.profiles = [{ kind: "spline" }])],
    [
      "a corner that isn't a number",
      (f: Record<string, unknown>) => (f.profiles = [{ kind: "polygon", points: [[0, "a"]] }]),
    ],
  ])("rejects %s as damaged", (_, damage) => {
    const doc = newDocument();
    doc.features.push(sketch([rect]));
    const file = JSON.parse(serializeProject(doc, app));
    damage(file.document.features[1]);
    const r = parseProject(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("damaged");
  });
});
