import { afterEach, describe, expect, it } from "vitest";
import {
  fromDisplay,
  getDisplayUnits,
  lengthNumber,
  lengthText,
  parseLength,
  setDisplayUnits,
  toDisplay,
  volumeText,
} from "./units";

afterEach(() => setDisplayUnits("mm"));

describe("millimetres or inches", () => {
  it("shows sizes in the units picked, the document staying in millimetres", () => {
    expect(getDisplayUnits()).toBe("mm");
    expect(lengthText(12.3456)).toBe("12.35 mm");
    setDisplayUnits("in");
    expect(lengthText(25.4)).toBe("1 in");
    expect(lengthText(12.3456)).toBe("0.486 in");
    expect(lengthNumber(6.35)).toBe(0.25);
    expect(toDisplay(50.8)).toBe(2);
    expect(fromDisplay(0.5)).toBeCloseTo(12.7, 12);
    expect(lengthText(-0.0001)).toBe("0 in"); // never "-0"
  });

  it("shows volumes in cm³ or in³", () => {
    expect(volumeText(15550)).toBe("15.55 cm³");
    expect(volumeText(25.4 ** 3, "in")).toBe("1.000 in³");
  });

  it("reads what is typed in the shown units, or in the units typed with it", () => {
    expect(parseLength("12.5")).toBe(12.5);
    expect(parseLength("12,5")).toBe(12.5);
    expect(parseLength("1 in")).toBeCloseTo(25.4, 12);
    expect(parseLength('1/4"')).toBeCloseTo(6.35, 12);
    expect(parseLength("1.5 cm")).toBe(15);
    expect(parseLength("-3")).toBe(-3);
    setDisplayUnits("in");
    expect(parseLength("2")).toBeCloseTo(50.8, 12);
    expect(parseLength("1 1/2")).toBeCloseTo(38.1, 12);
    expect(parseLength("3/8")).toBeCloseTo(9.525, 12);
    expect(parseLength("6 mm")).toBe(6);
    expect(parseLength(".5")).toBeCloseTo(12.7, 12);
  });

  it("refuses what isn't a size", () => {
    for (const bad of ["", "abc", "1/0", "1 5", "12 ft", "1..2", "--1"]) expect(parseLength(bad)).toBeNull();
  });
});
