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
} from "./index";

const app = { name: "Studio 3D", version: "test" };
const box = (over: Partial<BoxFeature> = {}): BoxFeature => ({ id: "b1", ...DEFAULT_BOX, ...over });

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
    expect(JSON.parse(serializeProject(newDocument(), app)).formatVersion).toBe(FILE_FORMAT_VERSION);
  });

  it("explains damaged files instead of crashing", () => {
    for (const text of ["", "{not json", "[]", '{"format":"something-else"}', '{"format":"studio3d-project"}']) {
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
  const hole = { id: "h1", type: "hole", name: "Hole 1", x: 30, y: 20, diameter: 5, depth: 0 };
  const withFeatures = (features: unknown[]) => {
    const file = JSON.parse(serializeProject(newDocument(), app));
    file.document.features = features;
    return JSON.stringify(file);
  };

  it("reads a box followed by holes", () => {
    const b = JSON.parse(serializeProject(newDocument(), app)).document.features[0];
    const r = parseProject(withFeatures([b, hole, { ...hole, id: "h2", depth: 4 }]));
    expect(r.ok && r.document.features.map((f) => f.type)).toEqual(["box", "hole", "hole"]);
  });

  it.each([
    ["a hole before the box", () => [hole]],
    ["no shapes at all", () => []],
    [
      "two boxes",
      () => {
        const b = JSON.parse(serializeProject(newDocument(), app)).document.features[0];
        return [b, { ...b, id: "b2" }];
      },
    ],
  ])("rejects %s as damaged", (_, features) => {
    const r = parseProject(withFeatures(features()));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("damaged");
  });

  it("rejects a hole with a missing number", () => {
    const b = JSON.parse(serializeProject(newDocument(), app)).document.features[0];
    const r = parseProject(withFeatures([b, { ...hole, diameter: "big" }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("diameter");
  });
});
