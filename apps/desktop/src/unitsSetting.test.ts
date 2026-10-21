import { afterEach, describe, expect, it } from "vitest";
import { getDisplayUnits, setDisplayUnits } from "@studio3d/document";
import { parseUnits, setUnits, toggleUnits } from "./unitsSetting";

afterEach(() => setDisplayUnits("mm"));

describe("the units setting", () => {
  it("reads a saved choice, and anything else as millimetres", () => {
    expect(parseUnits("in")).toBe("in");
    for (const raw of ["mm", null, "", "feet"]) expect(parseUnits(raw)).toBe("mm");
  });

  it("switches what every size is shown in", () => {
    setUnits("in");
    expect(getDisplayUnits()).toBe("in");
    toggleUnits();
    expect(getDisplayUnits()).toBe("mm");
  });
});
