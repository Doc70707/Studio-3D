import { describe, expect, it } from "vitest";
import {
  PLATE_PLANE,
  SPIN_PLANE,
  isRevolve,
  newRevolve,
  profileMoment,
  axesFor,
  faceLabel,
  faceOutline,
  hasErrors,
  newDocument,
  nestingDepths,
  newSketch,
  offsetProfile,
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

describe("offsets", () => {
  it("grows and shrinks a rectangle evenly on every side", () => {
    expect(offsetProfile(rect, 2)).toEqual({ kind: "rectangle", x: -2, y: -2, width: 14, height: 9 });
    expect(offsetProfile(rect, -2)).toEqual({ kind: "rectangle", x: 2, y: 2, width: 6, height: 1 });
    expect(offsetProfile(rect, -3)).toBeNull(); // a 5 mm tall rectangle can't shrink by 3 mm on each side
  });

  it("changes a circle's diameter by twice the offset", () => {
    expect(offsetProfile({ kind: "circle", x: 1, y: 2, diameter: 10 }, 1.5)).toMatchObject({
      diameter: 13,
      x: 1,
      y: 2,
    });
    expect(offsetProfile({ kind: "circle", x: 0, y: 0, diameter: 10 }, -5)).toBeNull();
  });

  it("moves every side of an outline out by the same distance, keeping sharp corners", () => {
    const L: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 30],
        [0, 30],
      ],
    };
    const grown = offsetProfile(L, 1)!;
    expect(grown).toEqual({
      kind: "polygon",
      points: [
        [-1, -1],
        [41, -1],
        [41, 6],
        [6, 6],
        [6, 31],
        [-1, 31],
      ],
    });
    // Drawn the other way round, outwards is still outwards.
    const reversed: Profile = { kind: "polygon", points: [...(L as { points: [number, number][] }).points].reverse() };
    expect(Math.abs(polygonArea((offsetProfile(reversed, 1) as { points: [number, number][] }).points))).toBeCloseTo(
      Math.abs(polygonArea((grown as { points: [number, number][] }).points)),
      9,
    );
  });

  it("refuses an inward offset that would make an arm of the outline vanish", () => {
    const L: Profile = {
      kind: "polygon",
      points: [
        [0, 0],
        [40, 0],
        [40, 5],
        [5, 5],
        [5, 30],
        [0, 30],
      ],
    };
    expect(offsetProfile(L, -1)).not.toBeNull();
    expect(offsetProfile(L, -3)).toBeNull(); // the arms are only 5 mm wide
  });
});

describe("holes in sketches", () => {
  it("an outline drawn inside another is a hole, and an island inside that adds again", () => {
    const outer: Profile = { kind: "rectangle", x: 0, y: 0, width: 40, height: 40 };
    const hole: Profile = { kind: "rectangle", x: 5, y: 5, width: 30, height: 30 };
    const island: Profile = { kind: "circle", x: 20, y: 20, diameter: 10 };
    const apart: Profile = { kind: "circle", x: 60, y: 20, diameter: 10 };
    expect(nestingDepths([outer, hole, island, apart])).toEqual([0, 1, 2, 0]);
  });

  it("outlines that only overlap are joined, not holes", () => {
    const a: Profile = { kind: "rectangle", x: 0, y: 0, width: 20, height: 20 };
    const b: Profile = { kind: "rectangle", x: 10, y: 10, width: 20, height: 20 };
    expect(nestingDepths([a, b])).toEqual([0, 0]);
  });
});

describe("revolves", () => {
  const spin = (profiles: Profile[], over: Partial<SketchFeature> = {}): SketchFeature => ({
    ...newRevolve(newDocument()),
    profiles,
    ...over,
  });

  it("start on the upright plane, facing the front with up in the drawing up in the world, spun all the way", () => {
    const s = newRevolve(newDocument());
    expect([s.name, s.surface, s.revolve, s.plane]).toEqual(["Revolve 1", "upright plane", 360, SPIN_PLANE]);
    expect(toWorld(s.plane, [10, 20])).toEqual([10, 0, 20]);
    expect(isRevolve(s)).toBe(true);
    expect(isRevolve(sketch([rect]))).toBe(false);
  });

  it("an outline's distance from the spin line is its area times its centre's x, whichever way it is drawn", () => {
    expect(profileMoment({ kind: "rectangle", x: 5, y: 0, width: 10, height: 2 })).toBe(200);
    expect(profileMoment({ kind: "circle", x: 20, y: 0, diameter: 2 })).toBeCloseTo(20 * Math.PI, 12);
    const tri: Profile = { kind: "polygon", points: [[0, 0], [6, 0], [0, 3]] };
    const back: Profile = { kind: "polygon", points: [[0, 3], [6, 0], [0, 0]] };
    expect(profileMoment(tri)).toBeCloseTo(9 * 2, 12); // area 9, centre at x = 2
    expect(profileMoment(back)).toBeCloseTo(18, 12);
  });

  it("outlines must stay on one side of the spin line, and the angle from 1° to 360°", () => {
    expect(hasErrors(validateSketch(spin([{ kind: "rectangle", x: 0, y: 0, width: 5, height: 5 }])))).toBe(false);
    const crossing = validateSketch(spin([{ kind: "circle", x: 2, y: 5, diameter: 6 }]));
    expect(crossing.map((i) => [i.field, i.message])).toEqual([
      ["profiles.0.x", "Circle 1 crosses the spin line. Keep it on the right of the line (touching is fine)."],
    ]);
    for (const revolve of [0, 361, Number.NaN])
      expect(validateSketch(spin([rect], { revolve })).map((i) => i.field)).toEqual(["revolve"]);
    // The depth isn't used by a revolve, so it isn't checked.
    expect(hasErrors(validateSketch(spin([rect], { depth: -4 })))).toBe(false);
  });

  it("save and open with the angle; a damaged angle is reported", () => {
    const doc = { units: "mm" as const, features: [spin([rect], { revolve: 90 })] };
    const r = parseProject(serializeProject(doc, app));
    expect(r.ok && r.document).toEqual(doc);
    const file = JSON.parse(serializeProject(doc, app));
    file.document.features[0].revolve = "lots";
    const bad = parseProject(JSON.stringify(file));
    expect(bad.ok ? "" : bad.error).toContain("unreadable spin angle");
  });
});
