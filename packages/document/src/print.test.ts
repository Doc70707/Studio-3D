import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRINTER,
  PRINTERS,
  parseProject,
  printChecks,
  printerById,
  serializeProject,
  type MeshFacts,
  type ProjectDocument,
} from "./index";

const APP = { name: "Studio 3D", version: "test" };
const a1mini = printerById("bambu-a1-mini");
const part = (over: Partial<MeshFacts> = {}): MeshFacts => ({
  min: [-30, -20, 0],
  max: [30, 20, 30],
  watertight: true,
  consistentWinding: true,
  bodies: 1,
  ...over,
});
const status = (m: MeshFacts) => Object.fromEntries(printChecks(m, a1mini).map((c) => [c.id, c.status]));

describe("Print Studio", () => {
  it("every printer has a positive build volume and the maker's page it came from", () => {
    expect(new Set(PRINTERS.map((p) => p.id)).size).toBe(PRINTERS.length);
    for (const p of PRINTERS) {
      expect(p.volume.every((v) => v > 0)).toBe(true);
      expect(p.source).toMatch(/^https:\/\/[^/]*(bambulab|prusa3d|creality|elegoo)\.com\//);
    }
    expect(printerById(undefined).id).toBe(DEFAULT_PRINTER);
    expect(printerById("no-such-printer").id).toBe(DEFAULT_PRINTER);
    expect(a1mini.volume).toEqual([180, 180, 180]);
  });

  it("a closed, single, flat part that fits passes every check", () => {
    expect(status(part())).toEqual({ closed: "ok", pieces: "ok", fits: "ok", plate: "ok" });
    expect(printChecks(part(), a1mini).find((c) => c.id === "fits")!.text).toBe(
      "Fits the A1 mini: 60 mm × 40 mm × 30 mm in 180 mm × 180 mm × 180 mm.",
    );
  });

  it("names each direction that is too big, with the most the printer takes", () => {
    const big = printChecks(part({ min: [-100, -20, 0], max: [100, 20, 190] }), a1mini).find((c) => c.id === "fits")!;
    expect(big.status).toBe("error");
    expect(big.text).toBe(
      "Too big for the A1 mini: 200 mm wide, the most is 180 mm; 190 mm tall, the most is 180 mm. " +
        "Make it smaller, split it, or pick a bigger printer.",
    );
    // Exactly the build volume still fits.
    expect(status(part({ min: [-90, -90, 0], max: [90, 90, 180] })).fits).toBe("ok");
  });

  it("flags gaps, separate pieces and parts that float above or sink into the plate", () => {
    expect(status(part({ watertight: false })).closed).toBe("error");
    expect(status(part({ consistentWinding: false })).closed).toBe("error");
    expect(printChecks(part({ bodies: 3 }), a1mini).find((c) => c.id === "pieces")).toMatchObject({
      status: "warning",
      text: expect.stringContaining("3 separate pieces"),
    });
    const up = printChecks(part({ min: [-30, -20, 5], max: [30, 20, 35] }), a1mini).find((c) => c.id === "plate")!;
    expect(up).toMatchObject({ status: "warning", text: expect.stringContaining("5 mm above the plate") });
    const down = printChecks(part({ min: [-30, -20, -2], max: [30, 20, 28] }), a1mini).find((c) => c.id === "plate")!;
    expect(down).toMatchObject({ status: "warning", text: expect.stringContaining("2 mm of the part is below") });
    expect(status(part({ min: [-30, -20, 0.004], max: [30, 20, 30] })).plate).toBe("ok"); // float rounding
  });

  it("the printer is saved with the project, beside the design", () => {
    const doc: ProjectDocument = { units: "mm", features: [], print: { printer: "prusa-mk4s" } };
    const back = parseProject(serializeProject(doc, APP));
    expect(back.ok && back.document.print).toEqual({ printer: "prusa-mk4s" });
    // No print setup is written until one is chosen.
    expect(serializeProject({ units: "mm", features: [] }, APP)).not.toContain('"print"');
    // Settings from a newer version are kept, not dropped.
    const newer = JSON.parse(serializeProject(doc, APP));
    newer.document.print.layerHeight = 0.2;
    const kept = parseProject(JSON.stringify(newer));
    expect(kept.ok && kept.document.print).toEqual({ printer: "prusa-mk4s", layerHeight: 0.2 });
    newer.document.print = { printer: "bambu-a1", layerHeight: -1 };
    const badHeight = parseProject(JSON.stringify(newer));
    expect(badHeight.ok ? "" : badHeight.error).toContain("layer height");
    newer.document.print = { printer: 7 };
    const broken = parseProject(JSON.stringify(newer));
    expect(broken.ok ? "" : broken.error).toBe(
      "This project file is damaged: its print setup doesn't say which printer.",
    );
  });
});
