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
  newHollow,
  type HollowFeature,
  newEdgeStep,
  type EdgeFeature,
  newHole,
  holeDiameter,
  shapeSize,
  threadProfile,
  threadVolume,
  type CylinderFeature,
  type HoleFeature,
  type ThreadSize,
  moveFeature,
  movableAxes,
  newSketch,
  boxSideFace,
  boxSideOf,
  canFollow,
  holeCentre,
  measuredFrom,
  type HoleFace,
  THREADS,
  THREAD_SIZES,
  threadLabel,
  tapDrill,
  SCREW_SIZES,
  CLEARANCE,
  COUNTERBORE,
  COUNTERSINK,
  boreDiameter,
  headDepth,
  type ProjectDocument,
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

  it("opens a design whose shapes were all removed, and one with only a hole left, so nothing saved is refused", () => {
    // Removing every shape is allowed; what's left is explained by the checks, not refused as damaged.
    const empty = parseProject(withFeatures([]));
    expect(empty.ok && empty.document.features).toEqual([]);
    expect(empty.ok && validateDocument(empty.document)).toEqual([]);
    const onlyHole = parseProject(withFeatures([hole]));
    expect(onlyHole.ok).toBe(true);
    if (onlyHole.ok) expect(validateDocument(onlyHole.document)[0]?.message).toMatch(/needs a shape to start from/);
  });

  it.each([
    [
      "a shape that neither adds nor cuts",
      () => {
        const b = JSON.parse(serializeProject(newDocument(), app)).document.features[0];
        return [{ ...b, mode: "melt" }];
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

describe("format version 2: many shapes", () => {
  it("upgrades a version 1 file: the box is placed at the plate centre and holes move with it", () => {
    const v1 = {
      format: "studio3d-project",
      formatVersion: 1,
      app,
      document: {
        units: "mm",
        features: [
          { id: "b", type: "box", name: "Box", width: 60, depth: 40, height: 30, wall: 2 },
          { id: "h", type: "hole", name: "Hole 1", x: 30, y: 20, diameter: 5, depth: 0 },
        ],
      },
    };
    const r = parseProject(JSON.stringify(v1));
    if (!r.ok) throw new Error(r.error);
    expect(r.document.features[0]).toMatchObject({ type: "box", mode: "add", x: 0, y: 0, z: 0, width: 60 });
    expect(r.document.features[1]).toMatchObject({ type: "hole", x: 0, y: 0 });
    expect(JSON.parse(serializeProject(r.document, app)).formatVersion).toBe(FILE_FORMAT_VERSION);
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
  const cylinder = (over: object = {}) => ({ ...newShape(newDocument(), "cylinder"), ...over }) as ShapeFeature;
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
    const tube = { ...newShape(newDocument(), "tube"), innerDiameter: 25 } as ShapeFeature;
    expect(validateShape(tube)[0]!.message).toContain("must be smaller than the outside");
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
    expect(shapeVolume(s("cylinder", { diameter: 10, height: 4 }))).toBeCloseTo(pi * 25 * 4, 9);
    expect(shapeVolume(s("tube", { outerDiameter: 10, innerDiameter: 6, height: 2 }))).toBeCloseTo(
      pi * (25 - 9) * 2,
      9,
    );
    expect(shapeVolume(s("cone", { bottomDiameter: 6, topDiameter: 0, height: 9 }))).toBeCloseTo((pi * 9 * 9) / 3, 9);
    expect(shapeVolume(s("sphere", { diameter: 6 }))).toBeCloseTo((4 / 3) * pi * 27, 9);
  });
});

describe("hollow", () => {
  const withHollow = (over: Partial<HollowFeature> = {}) => {
    const doc = newDocument();
    return { ...doc, features: [...doc.features, { ...newHollow(doc), ...over }] };
  };

  it("starts with 2 mm walls open at the top, and is checked", () => {
    expect(withHollow().features[1]).toMatchObject({ type: "hollow", name: "Hollow 1", wall: 2, open: "top" });
    expect(validateDocument(withHollow())).toEqual([]);
    expect(validateDocument(withHollow({ wall: 0.2 }))[0]!.message).toContain("at least 0.4 mm");
    expect(validateDocument(withHollow({ wall: NaN }))[0]!.field).toBe("wall");
  });

  it("is saved and opened again unchanged", () => {
    const doc = withHollow({ wall: 1.6, open: "none" });
    const r = parseProject(serializeProject(doc, app));
    expect(r.ok && r.document).toEqual(doc);
  });

  it("a file with a hollow that doesn't say which side is open is refused as damaged", () => {
    const text = serializeProject(withHollow(), app).replace('"open": "top"', '"open": "sideways"');
    const r = parseProject(text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("which side is open");
  });
});

describe("fillets and chamfers", () => {
  const withEdges = (type: EdgeFeature["type"], over: Partial<EdgeFeature> = {}) => {
    const doc = newDocument();
    return { ...doc, features: [...doc.features, { ...newEdgeStep(doc, type), ...over }] };
  };

  it("start sensibly for printing, and are checked", () => {
    expect(withEdges("fillet").features[1]).toMatchObject({ name: "Fillet 1", size: 1, edges: "all" });
    expect(withEdges("chamfer").features[1]).toMatchObject({ name: "Chamfer 1", size: 0.6, edges: "bottom" });
    expect(validateDocument(withEdges("fillet"))).toEqual([]);
    expect(validateDocument(withEdges("fillet", { size: 0 }))[0]!.message).toContain("radius needs to be at least");
    expect(validateDocument(withEdges("chamfer", { size: NaN }))[0]!.field).toBe("size");
    expect(movableAxes(withEdges("fillet").features[1]!)).toEqual([]);
  });

  it("are saved and opened again unchanged; unknown edge choices are refused as damaged", () => {
    const doc = withEdges("chamfer", { size: 0.8, edges: "vertical" });
    const r = parseProject(serializeProject(doc, app));
    expect(r.ok && r.document).toEqual(doc);
    const bad = parseProject(serializeProject(doc, app).replace('"edges": "vertical"', '"edges": "some"'));
    expect(!bad.ok && bad.error).toContain("which edges");
  });
});

describe("threads", () => {
  const cylinder = (over: Partial<CylinderFeature> = {}) =>
    ({ ...newShape(newDocument(), "cylinder"), thread: "M8", fit: 0.3, diameter: 8, ...over }) as CylinderFeature;

  it("an ISO profile: tooth 5/8 of the triangle height, crest p/8 wide, root 3/4 p wide", () => {
    const t = threadProfile("M8", 0, true);
    expect(t.major).toBe(4);
    expect(t.major - t.minor).toBeCloseTo((5 / 8) * (Math.sqrt(3) / 2) * 1.25, 12);
    expect([t.crestWidth, t.rootWidth]).toEqual([1.25 / 8, (3 / 4) * 1.25]);
  });

  it("the fit makes a bolt smaller and a hole bigger by the same amount across", () => {
    expect(2 * threadProfile("M5", 0.4, true).major).toBeCloseTo(4.6, 12);
    expect(2 * threadProfile("M5", 0.4, false).major).toBeCloseTo(5.4, 12);
  });

  it("a threaded cylinder's volume and size come from the thread", () => {
    const c = cylinder({ height: 10 });
    expect(shapeVolume(c)).toBeCloseTo(threadVolume(threadProfile("M8", 0.3, true), 10), 9);
    expect(shapeSize(c)).toEqual([7.7, 7.7, 10]);
    expect(shapeSize({ ...c, mode: "cut" })[0]).toBeCloseTo(8.3, 12);
  });

  it("checks the thread settings in plain words", () => {
    expect(validateShape(cylinder())).toEqual([]);
    expect(validateShape(cylinder({ fit: -0.1 }))[0]!.message).toContain("can't be negative");
    expect(validateShape(cylinder({ fit: 2 }))[0]!.message).toContain("at most 1 mm");
    expect(validateShape(cylinder({ height: 2 }))[0]!.message).toContain("at least two turns");
    expect(validateShape(cylinder({ thread: "M7" as ThreadSize }))[0]!.field).toBe("thread");
  });

  it("a threaded hole cuts out to the thread's grooves, and is saved and opened unchanged", () => {
    const doc = newDocument();
    const hole: HoleFeature = { ...newHole(doc), thread: "M6", fit: 0.3, diameter: 6 };
    expect(holeDiameter(hole)).toBeCloseTo(6.3, 12);
    expect(holeDiameter({ ...hole, thread: undefined })).toBe(6);
    const withThreads = { ...doc, features: [...doc.features, cylinder(), hole] };
    const r = parseProject(serializeProject(withThreads, app));
    expect(r.ok && r.document).toEqual(withThreads);
    const bad = parseProject(serializeProject(withThreads, app).replace('"M6"', '"M7"'));
    expect(!bad.ok && bad.error).toContain("thread");
  });
});

describe("moving a step", () => {
  const doc = { units: "mm" as const, features: [] };
  it("a shape moves along all three axes, without rounding noise", () => {
    const s = { ...newShape(doc, "box"), x: 0.1, y: -3, z: 0 };
    const moved = moveFeature(s, [0.2, 10, 5]);
    expect([moved.x, moved.y, moved.z]).toEqual([0.3, 7, 5]);
    expect(movableAxes(s)).toEqual(["x", "y", "z"]);
  });
  it("a hole only slides across the top; a sketch's surface moves with it; a hollow doesn't move", () => {
    const h = moveFeature(newHole(doc, { x: 1, y: 2 }), [3, 4, 99]);
    expect([h.x, h.y]).toEqual([4, 6]);
    expect(movableAxes(h)).toEqual(["x", "y"]);
    const sk = newSketch(doc, { origin: [-30, -20, 30], xDir: [1, 0, 0], normal: [0, 0, 1] }, "top face", []);
    expect(moveFeature(sk, [5, 0, -1]).plane).toEqual({ origin: [-25, -20, 29], xDir: [1, 0, 0], normal: [0, 0, 1] });
    const hol = newHollow(doc);
    expect(moveFeature(hol, [1, 1, 1])).toBe(hol);
    expect(movableAxes(hol)).toEqual([]);
  });
});

describe("holes on a face", () => {
  const b: BoxFeature = { ...DEFAULT_BOX, id: "b", name: "Box", mode: "add", x: 0, y: 0, z: 0, wall: 0 };
  const face = (over: Partial<HoleFace> = {}): HoleFace => ({
    ...boxSideFace(b, "front"),
    on: { shape: "b", side: "front" },
    across: "left",
    up: "bottom",
    ...over,
  });

  it("switching which edge a hole is measured from keeps it in the same place", () => {
    const f = face();
    const at = holeCentre(f, 12, 7);
    for (const across of ["left", "right", "centre"] as const)
      for (const up of ["bottom", "top", "centre"] as const) {
        const { x, y } = measuredFrom(f, at, across, up);
        expect(holeCentre({ ...f, across, up }, x, y)).toEqual(at);
      }
    expect(measuredFrom(f, at, "right", "top")).toEqual({ x: 48, y: 23 });
    expect(measuredFrom(f, at, "centre", "centre")).toEqual({ x: -18, y: -8 });
  });

  it("which side of a box a face is, from the way it points", () => {
    expect(boxSideOf([0, -1, 0])).toBe("front");
    expect(boxSideOf([0, 0, 1])).toBe("top");
    expect(boxSideOf([0.6, 0.8, 0])).toBeNull();
    expect(canFollow({ ...b, wall: 2 }, "top")).toBe(false); // an open container's top is its rim
    expect(canFollow({ ...b, wall: 2 }, "front")).toBe(true);
    expect(canFollow({ ...b, mode: "cut" }, "front")).toBe(false);
  });

  it("the document check names the edge a hole runs off, using the box's current size", () => {
    const h: HoleFeature = { ...newHole({ units: "mm", features: [b] }), x: 58, y: 10, diameter: 6, face: face() };
    const issues = validateDocument({ units: "mm", features: [b, h] });
    expect(issues).toEqual([
      expect.objectContaining({ field: "x", message: expect.stringContaining("right edge of the front face") }),
    ]);
    // Widen the box and the same hole fits.
    expect(validateDocument({ units: "mm", features: [{ ...b, width: 80 }, h] })).toEqual([]);
  });

  it("a hole's face with a bad shape is a damaged file", () => {
    const h = { ...newHole({ units: "mm", features: [b] }), face: { ...face(), across: "sideways" } };
    const text = serializeProject({ units: "mm", features: [b, h as HoleFeature] }, { name: "t", version: "t" });
    const r = parseProject(text);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("doesn't say which edges it is measured from");
  });
});

describe("thread sizes and screw holes", () => {
  const h = (over: Partial<HoleFeature> = {}): HoleFeature => ({ ...newHole(newDocument()), id: "h", ...over });

  it("inch threads come from their size in inches and threads per inch", () => {
    expect(THREADS["1/4-20 UNC"]).toMatchObject({ diameter: 6.35, pitch: 1.27, standard: "UNC" });
    expect(THREADS["#10-32 UNF"].diameter).toBeCloseTo(4.826, 9);
    expect(THREADS["#10-32 UNF"].pitch).toBeCloseTo(0.79375, 9);
    expect(threadLabel("M5")).toBe("M5 × 0.8");
    expect(threadLabel("M10x1.25")).toBe("M10 × 1.25 fine");
    expect(threadLabel("3/8-16 UNC")).toBe("3/8-16 UNC");
  });

  it("tap drills: the sourced size where there is one, else major diameter minus pitch", () => {
    expect(tapDrill("M8")).toBe(6.8);
    expect(tapDrill("M12x1.5")).toBe(10.5);
    expect(tapDrill("1/4-20 UNC")).toBeCloseTo(0.201 * 25.4, 9);
    expect(
      THREAD_SIZES.every((s) => tapDrill(s) < THREADS[s].diameter && tapDrill(s) > THREADS[s].diameter * 0.7),
    ).toBe(true);
  });

  it("clearance and head sizes are larger than the screw, smallest to largest", () => {
    for (const s of SCREW_SIZES) {
      const c = CLEARANCE[s];
      expect(THREADS[s].diameter).toBeLessThan(c.fine);
      expect(c.fine).toBeLessThan(c.medium);
      expect(c.medium).toBeLessThan(c.coarse);
      expect(COUNTERBORE[s].diameter).toBeGreaterThan(c.coarse);
      expect(COUNTERSINK[s]).toBeGreaterThan(c.coarse);
    }
  });

  it("the size a hole cuts follows its kind", () => {
    expect(boreDiameter(h({ clearance: { screw: "M4", series: "coarse" } }))).toBe(4.8);
    expect(boreDiameter(h({ thread: "M6", simplified: true }))).toBe(5);
    const cb = h({
      clearance: { screw: "M5", series: "medium" },
      head: { kind: "counterbore", diameter: 9.5, depth: 5 },
    });
    expect(holeDiameter(cb)).toBe(9.5);
    expect(headDepth(h({ diameter: 6, head: { kind: "countersink", diameter: 12 } }))).toBe(3);
    expect(holeDiameter(h({ thread: "M6", head: { kind: "countersink", diameter: 12 } }))).toBeLessThan(7); // no head
  });

  it("explains bad thread depths and heads, and never changes them", () => {
    const msg = (over: Partial<HoleFeature>) =>
      validateDocument({ units: "mm", features: [box(), h(over)] })[0]?.message;
    expect(msg({ thread: "M6", depth: 10, threadDepth: 12 })).toBe(
      "The thread can't go deeper than the hole: use 10 mm or less.",
    );
    expect(msg({ thread: "M6", threadDepth: 1 })).toBe(
      "The M6 × 1 thread needs at least two turns: make it at least 2 mm deep.",
    );
    expect(msg({ thread: "M6", clearance: { screw: "M6", series: "fine" } })).toContain(
      "both threaded and a clearance",
    );
    expect(msg({ diameter: 6, head: { kind: "counterbore", diameter: 5, depth: 3 } })).toBe(
      "The counterbore needs to be wider than the hole (6 mm).",
    );
    expect(msg({ diameter: 6, head: { kind: "counterbore", diameter: 10, depth: 0 } })).toBe(
      "Counterbore depth needs to be more than 0 mm.",
    );
    expect(msg({ diameter: 6, depth: 2, head: { kind: "countersink", diameter: 12 } })).toContain(
      "as deep as the hole",
    );
  });

  it("saves and opens every hole kind; damaged ones are reported", () => {
    const doc: ProjectDocument = {
      units: "mm",
      features: [
        box(),
        h({ id: "a", thread: "1/4-20 UNC", fit: 0.3, depth: 10, threadDepth: 6, simplified: false }),
        h({
          id: "b",
          clearance: { screw: "M5", series: "medium" },
          head: { kind: "counterbore", diameter: 9.5, depth: 5 },
        }),
        h({ id: "c", clearance: { screw: "M6", series: "fine" }, head: { kind: "countersink", diameter: 13.44 } }),
      ],
    };
    const back = parseProject(serializeProject(doc, app));
    expect(back.ok && back.document).toEqual(doc);
    const broken = JSON.parse(serializeProject(doc, app));
    broken.document.features[2].clearance.screw = "M7";
    const r = parseProject(JSON.stringify(broken));
    expect(!r.ok && r.error).toContain("clearance hole size this version doesn't know");
  });
});
