import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOX,
  FILE_FORMAT_VERSION,
  hasErrors,
  newDocument,
  parseProject,
  serializeProject,
  validateBox,
  type BoxFeature,
  newShape,
  shapeVolume,
  validateDocument,
  validateShape,
  type ShapeFeature,
} from "./index";

const app = { name: "Studio 3D", version: "test" };
const box = (over: Partial<BoxFeature> = {}): BoxFeature => ({
  id: "b1",
  ...DEFAULT_BOX,
  ...over,
});

describe("validateBox", () => {
  it("accepts the default box", () => {
    expect(validateBox(box())).toEqual([]);
  });

  it("accepts a solid block (wall 0)", () => {
    expect(validateBox(box({ wall: 0 }))).toEqual([]);
  });

  it.each([
    [{ width: 0 }, "width", "at least"],
    [{ depth: 5000 }, "depth", "at most"],
    [{ height: Number.NaN }, "height", "number"],
    [{ wall: -1 }, "wall", "negative"],
    [{ wall: 20 }, "wall", "fill the whole box"],
    [{ wall: 50 }, "wall", "fill the whole box"],
    [{ height: 2, wall: 2 }, "wall", "as thick as the box is tall"],
  ] as const)("rejects %o with a plain message on %s", (over, field, text) => {
    const issues = validateBox(box(over));
    expect(hasErrors(issues)).toBe(true);
    expect(issues[0]?.field).toBe(field);
    expect(issues[0]?.message).toContain(text);
  });

  it("warns, but allows, walls too thin to print well", () => {
    const issues = validateBox(box({ wall: 0.2 }));
    expect(hasErrors(issues)).toBe(false);
    expect(issues[0]?.severity).toBe("warning");
  });
});

describe("project file", () => {
  it("round-trips a document exactly", () => {
    const doc = newDocument();
    const parsed = parseProject(serializeProject(doc, app));
    expect(parsed.ok && parsed.document).toEqual(doc);
  });

  it("records the format version", () => {
    expect(JSON.parse(serializeProject(newDocument(), app)).formatVersion).toBe(
      FILE_FORMAT_VERSION,
    );
  });

  it("explains damaged files instead of crashing", () => {
    for (const text of [
      "",
      "{not json",
      "[]",
      '{"format":"something-else"}',
      '{"format":"studio3d-project"}',
    ]) {
      const r = parseProject(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });

  it("rejects a damaged shape and names the problem", () => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.document.features[0].width = "wide";
    const r = parseProject(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("width");
  });

  it("refuses files from a newer version rather than guessing", () => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.formatVersion = FILE_FORMAT_VERSION + 1;
    const r = parseProject(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("newer version");
  });

  it("refuses shape types it doesn't know instead of dropping them", () => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.document.features.push({ id: "x", type: "gear", teeth: 12 });
    const r = parseProject(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it("keeps unknown extra data through open and save", () => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.futureSetting = { a: 1 };
    file.document.features[0].chamfer = 1.5;
    const r = parseProject(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.length).toBe(2);
    const again = JSON.parse(serializeProject(r.document, app, r.preserved));
    expect(again.futureSetting).toEqual({ a: 1 });
    expect(again.document.features[0].chamfer).toBe(1.5);
  });

  it("rejects duplicate shape IDs", () => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.document.features.push({ ...file.document.features[0] });
    expect(parseProject(JSON.stringify(file)).ok).toBe(false);
  });
});

describe("holes in project files", () => {
  const hole = {
    id: "h1",
    type: "hole",
    name: "Hole 1",
    x: 30,
    y: 20,
    diameter: 5,
    depth: 0,
  };
  const withFeatures = (features: unknown[]) => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.document.features = features;
    return JSON.stringify(file);
  };

  it("reads a box followed by holes", () => {
    const b = JSON.parse(serializeProject(newDocument(), app)).document
      .features[0];
    const r = parseProject(
      withFeatures([b, hole, { ...hole, id: "h2", depth: 4 }]),
    );
    expect(r.ok && r.document.features.map((f) => f.type)).toEqual([
      "box",
      "hole",
      "hole",
    ]);
  });

  it.each([
    ["a hole before the box", () => [hole]],
    ["no shapes at all", () => []],
    [
      "a shape that neither adds nor cuts",
      () => {
        const b = JSON.parse(serializeProject(newDocument(), app)).document
          .features[0];
        return [{ ...b, mode: "melt" }];
      },
    ],
  ])("rejects %s as damaged", (_, features) => {
    const r = parseProject(withFeatures(features()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("damaged");
  });

  it("rejects a hole with a missing number", () => {
    const b = JSON.parse(serializeProject(newDocument(), app)).document
      .features[0];
    const r = parseProject(withFeatures([b, { ...hole, diameter: "big" }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("diameter");
  });
});

describe("format version 2: many shapes", () => {
  it("upgrades a version 1 file: the box is placed at the plate centre and holes move with it", () => {
    const v1 = {
      format: "studio3d-project",
      formatVersion: 1,
      app,
      document: {
        units: "mm",
        features: [
          {
            id: "b",
            type: "box",
            name: "Box",
            width: 60,
            depth: 40,
            height: 30,
            wall: 2,
          },
          {
            id: "h",
            type: "hole",
            name: "Hole 1",
            x: 30,
            y: 20,
            diameter: 5,
            depth: 0,
          },
        ],
      },
    };
    const r = parseProject(JSON.stringify(v1));
    if (!r.ok) throw new Error(r.error);
    expect(r.document.features[0]).toMatchObject({
      type: "box",
      mode: "add",
      x: 0,
      y: 0,
      z: 0,
      width: 60,
    });
    expect(r.document.features[1]).toMatchObject({ type: "hole", x: 0, y: 0 });
    expect(JSON.parse(serializeProject(r.document, app)).formatVersion).toBe(
      FILE_FORMAT_VERSION,
    );
  });

  it("saves and reopens every kind of shape exactly", () => {
    const doc = newDocument();
    for (const type of ["cylinder", "tube", "cone", "sphere", "box"] as const) {
      const s = newShape(doc, type, { x: 5, y: -7.5, z: 2 });
      doc.features.push(type === "tube" ? { ...s, mode: "cut" } : s);
    }
    const r = parseProject(serializeProject(doc, app));
    if (!r.ok) throw new Error(r.error);
    expect(r.document).toEqual(doc);
    expect(r.warnings).toEqual([]);
  });

  it("names new shapes so they are easy to tell apart", () => {
    const doc = newDocument();
    doc.features.push(newShape(doc, "cylinder"));
    expect(newShape(doc, "cylinder").name).toBe("Cylinder 2");
    expect(newShape(doc, "box").name).toBe("Box 1");
  });
});

describe("validateShape", () => {
  const cylinder = (over: object = {}) =>
    ({ ...newShape(newDocument(), "cylinder"), ...over }) as ShapeFeature;
  it("accepts every default shape", () => {
    for (const type of ["box", "cylinder", "tube", "cone", "sphere"] as const)
      expect(validateShape(newShape(newDocument(), type))).toEqual([]);
  });
  it.each([
    [{ diameter: 0 }, "diameter", "at least"],
    [{ height: 2000 }, "height", "at most"],
    [{ z: -1 }, "z", "can't be negative"],
    [{ x: Number.NaN }, "x", "number"],
  ])("explains %o", (over, field, text) => {
    const issues = validateShape(cylinder(over));
    expect(issues[0]).toMatchObject({ severity: "error", field });
    expect(issues[0]!.message).toContain(text);
  });
  it("a tube's inside must be smaller than its outside", () => {
    const tube = {
      ...newShape(newDocument(), "tube"),
      innerDiameter: 25,
    } as ShapeFeature;
    expect(validateShape(tube)[0]!.message).toContain(
      "must be smaller than the outside",
    );
  });
  it("the first shape has to add material", () => {
    const doc = newDocument();
    doc.features[0] = { ...(doc.features[0] as ShapeFeature), mode: "cut" };
    expect(hasErrors(validateDocument(doc))).toBe(true);
  });
  it("exact volumes match the textbook formulas", () => {
    const pi = Math.PI;
    const s = (type: "cylinder" | "tube" | "cone" | "sphere", over: object) =>
      ({ ...newShape(newDocument(), type), ...over }) as ShapeFeature;
    expect(shapeVolume(s("cylinder", { diameter: 10, height: 4 }))).toBeCloseTo(
      pi * 25 * 4,
      9,
    );
    expect(
      shapeVolume(
        s("tube", { outerDiameter: 10, innerDiameter: 6, height: 2 }),
      ),
    ).toBeCloseTo(pi * (25 - 9) * 2, 9);
    expect(
      shapeVolume(s("cone", { bottomDiameter: 6, topDiameter: 0, height: 9 })),
    ).toBeCloseTo((pi * 9 * 9) / 3, 9);
    expect(shapeVolume(s("sphere", { diameter: 6 }))).toBeCloseTo(
      (4 / 3) * pi * 27,
      9,
    );
  });
});
