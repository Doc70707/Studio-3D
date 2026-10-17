import { describe, expect, it } from "vitest";
import { allows, interactionMode } from "./interaction";

describe("one interaction mode at a time", () => {
  it("sketching wins over picking a face, which wins over a move in progress", () => {
    expect(interactionMode({ sketching: true, picking: true, moving: true })).toBe("sketch");
    expect(interactionMode({ sketching: false, picking: true, moving: true })).toBe("pick-face");
    expect(interactionMode({ sketching: false, picking: false, moving: true })).toBe("move");
    expect(interactionMode({ sketching: false, picking: false, moving: false })).toBe("model");
  });

  it("only the model mode selects pieces, nudges them or takes file shortcuts", () => {
    for (const a of ["select", "hover", "edit-keys", "view-keys", "file-keys"] as const)
      expect(allows("model", a)).toBe(true);
    expect(allows("model", "pick-face")).toBe(false);
    // Picking a face: a click picks the face, never a piece; views can still change to reach the face.
    expect(allows("pick-face", "pick-face")).toBe(true);
    expect(allows("pick-face", "select")).toBe(false);
    expect(allows("pick-face", "edit-keys")).toBe(false);
    expect(allows("pick-face", "view-keys")).toBe(true);
    expect(allows("pick-face", "file-keys")).toBe(true);
    // The sketch screen and a move drag own every gesture while they last.
    for (const a of ["select", "hover", "pick-face", "edit-keys", "view-keys", "file-keys"] as const) {
      expect(allows("sketch", a)).toBe(false);
      expect(allows("move", a)).toBe(false);
    }
  });
});
