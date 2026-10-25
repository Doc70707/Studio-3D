import { describe, expect, it } from "vitest";
import {
  newDocument,
  parseRecovery,
  serializeProject,
  serializeRecovery,
  RECOVERY_FORMAT,
  type ProjectDocument,
  type RecoverySnapshot,
} from "./index";

const app = { name: "Studio 3D", version: "test" };

function snapshot(doc: ProjectDocument, over: Partial<RecoverySnapshot> = {}): RecoverySnapshot {
  return { savedAt: "2026-10-16T21:30:00.000Z", file: null, project: serializeProject(doc, app), ...over };
}

describe("crash recovery copy", () => {
  it("brings back exactly the design that was being worked on", () => {
    const doc = newDocument();
    const r = parseRecovery(serializeRecovery(snapshot(doc)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.document).toEqual(doc);
    expect(r.snapshot.savedAt).toBe("2026-10-16T21:30:00.000Z");
    expect(r.snapshot.file).toBeNull();
  });

  it("remembers which saved file the work belongs to, so saving goes back there", () => {
    const file = { name: "bracket.s3d", path: "C:\\Users\\shane\\bracket.s3d" };
    const r = parseRecovery(serializeRecovery(snapshot(newDocument(), { file })));
    expect(r.ok && r.snapshot.file).toEqual(file);
    const browser = parseRecovery(serializeRecovery(snapshot(newDocument(), { file: { name: "bracket.s3d" } })));
    expect(browser.ok && browser.snapshot.file).toEqual({ name: "bracket.s3d" });
  });

  it("keeps data from a newer version that the project carried", () => {
    const doc = newDocument();
    const id = doc.features[0]!.id;
    const project = serializeProject(doc, app, { file: {}, document: {}, features: { [id]: { fillet: 2 } } });
    const r = parseRecovery(serializeRecovery(snapshot(doc, { project })));
    expect(r.ok && r.parsed.preserved.features[id]).toEqual({ fillet: 2 });
  });

  it("explains damaged copies instead of crashing", () => {
    const damaged = [
      "",
      "{not json",
      "[]",
      JSON.stringify({ format: "something-else" }),
      JSON.stringify({ format: RECOVERY_FORMAT, formatVersion: 1, savedAt: "yesterday", file: null, project: "" }),
      JSON.stringify({ format: RECOVERY_FORMAT, formatVersion: 1, savedAt: "2026-10-16T21:30:00Z", file: null }),
      JSON.stringify({
        format: RECOVERY_FORMAT,
        formatVersion: 1,
        savedAt: "2026-10-16T21:30:00Z",
        file: { name: 3 },
        project: "{}",
      }),
    ];
    for (const text of damaged) {
      const r = parseRecovery(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/backup of your unsaved work/);
    }
  });

  it("refuses a design inside the copy that isn't a valid project, and says why", () => {
    const r = parseRecovery(serializeRecovery(snapshot(newDocument(), { project: '{"format":"studio3d-proj' })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/can't be restored.*damaged/);
  });

  it("refuses a copy from a newer version rather than guessing", () => {
    const text = JSON.stringify({ ...JSON.parse(serializeRecovery(snapshot(newDocument()))), formatVersion: 9 });
    const r = parseRecovery(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version/);
  });
});
