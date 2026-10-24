import { afterEach, describe, expect, it } from "vitest";
import { getDisplayUnits, getLengthStyle, getPrecision, lengthText, setDisplayUnits } from "@studio3d/document";
import { lastFormat, parseUnits, setFormat, setUnits, toggleUnits } from "./unitsSetting";

afterEach(() => setDisplayUnits("mm"));

describe("the units setting", () => {
  it("reads a saved choice, old or new, and anything else as millimetres", () => {
    expect(parseUnits("in")).toEqual({ style: "in", precision: 3 });
    expect(parseUnits(JSON.stringify({ style: "ft-in", precision: 32 }))).toEqual({ style: "ft-in", precision: 32 });
    expect(parseUnits(JSON.stringify({ style: "cm", precision: 9 }))).toEqual({ style: "cm", precision: 2 });
    for (const raw of ["mm", null, "", "feet", "{}", JSON.stringify({ style: "yd" })])
      expect(parseUnits(raw)).toEqual({ style: "mm", precision: 2 });
  });

  it("switches what every size is shown in", () => {
    setUnits("in");
    expect(getDisplayUnits()).toBe("in");
    toggleUnits();
    expect(getDisplayUnits()).toBe("mm");
  });

  it("the metric/imperial switch goes back to the last style and precision of each", () => {
    setFormat({ style: "ft-in", precision: 32 });
    setFormat({ style: "cm", precision: 1 });
    expect(lastFormat(true)).toEqual({ style: "ft-in", precision: 32 });
    toggleUnits();
    expect([getLengthStyle(), getPrecision()]).toEqual(["ft-in", 32]);
    expect(lengthText(25.4 * 63.5)).toBe(`5' 3 1/2"`);
    toggleUnits();
    expect([getLengthStyle(), getPrecision()]).toEqual(["cm", 1]);
  });
});
