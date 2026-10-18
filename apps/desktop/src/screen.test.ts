import { describe, expect, it } from "vitest";
import { escapeLeaves, focusPanelAfterSelection } from "./screen";

describe("screen modes", () => {
  it("opens the focus-canvas panel for a selection and closes it again when let go", () => {
    expect(focusPanelAfterSelection("closed", true)).toBe("auto");
    expect(focusPanelAfterSelection("auto", false)).toBe("closed");
  });

  it("leaves a panel the user opened or closed themselves as it is", () => {
    expect(focusPanelAfterSelection("open", true)).toBe("open");
    expect(focusPanelAfterSelection("open", false)).toBe("open");
    expect(focusPanelAfterSelection("auto", true)).toBe("auto");
    expect(focusPanelAfterSelection("closed", false)).toBe("closed");
  });

  it("has Escape leave full screen first, then focus canvas", () => {
    expect(escapeLeaves({ fullScreen: true, focus: true })).toBe("full-screen");
    expect(escapeLeaves({ fullScreen: false, focus: true })).toBe("focus");
    expect(escapeLeaves({ fullScreen: false, focus: false })).toBeNull();
  });
});
