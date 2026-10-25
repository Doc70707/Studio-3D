import { afterEach, describe, expect, it } from "vitest";
import {
  fromDisplay,
  getDisplayUnits,
  getPrecision,
  inchFraction,
  isImperial,
  lengthEditText,
  lengthFixed,
  setLengthFormat,
  unitSuffix,
  type LengthStyle,
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
    for (const bad of ["", "abc", "1/0", "1 5", "12 yd", "1..2", "--1", "5' 3 5"]) expect(parseLength(bad)).toBeNull();
  });
});

describe("centimetres, metres, inch fractions, feet, and feet and inches", () => {
  it("writes sizes in each style, the part staying the same size", () => {
    const cases: [LengthStyle, string][] = [
      ["mm", "1234.57 mm"],
      ["cm", "123.46 cm"],
      ["m", "1.235 m"],
      ["in", "48.605 in"],
      ["in-frac", "48 19/32 in"],
      ["ft", "4.05 ft"],
      ["ft-in", `4' 0 5/8"`],
    ];
    for (const [s, text] of cases) {
      setLengthFormat(s);
      expect(lengthText(1234.5678)).toBe(text);
    }
    setLengthFormat("ft-in");
    expect(lengthText(25.4 * 63.5)).toBe(`5' 3 1/2"`);
    expect(lengthText(25.4 * 3.25)).toBe(`3 1/4"`);
    expect(lengthText(0)).toBe(`0"`);
    expect(unitSuffix()).toBe("");
  });

  it("rounds to the precision picked", () => {
    setLengthFormat("mm", 0);
    expect(lengthText(12.3456)).toBe("12 mm");
    setLengthFormat("mm", 3);
    expect(lengthText(12.3456)).toBe("12.346 mm");
    setLengthFormat("in-frac", 8);
    expect(lengthText(25.4 * 0.3)).toBe("1/4 in");
    setLengthFormat("in-frac", 64);
    expect(lengthText(25.4 * 0.3)).toBe("19/64 in");
    setLengthFormat("cm", 7); // not offered: the style's own default
    expect(getPrecision()).toBe(2);
    expect(inchFraction(-1.5, 16)).toBe("-1 1/2");
    expect(inchFraction(2, 16)).toBe("2");
  });

  it("keeps the exact length in a box being edited", () => {
    setLengthFormat("in-frac", 8);
    expect(lengthEditText(25.4 * 0.3)).toBe("0.3"); // not a 64th: decimals, not the rounded 1/4
    expect(lengthEditText(25.4 * 2.375)).toBe("2 3/8");
    setLengthFormat("ft-in");
    expect(lengthEditText(25.4 * 63.5)).toBe(`5' 3 1/2"`);
    expect(lengthEditText(25.4 * 63.3)).toBe(`63.3"`);
    setLengthFormat("m");
    expect(lengthEditText(1234.5678)).toBe("1.234568");
  });

  it("reads feet, feet and inches, centimetres and metres, and bare numbers in the shown style", () => {
    expect(parseLength("2 ft")).toBeCloseTo(609.6, 9);
    expect(parseLength(`5'3 1/2"`)).toBeCloseTo(25.4 * 63.5, 9);
    expect(parseLength(`5' 3"`)).toBeCloseTo(25.4 * 63, 9);
    expect(parseLength(`5'-3"`)).toBeCloseTo(25.4 * 63, 9);
    expect(parseLength("2 ft 3 in")).toBeCloseTo(25.4 * 27, 9);
    expect(parseLength("5'")).toBeCloseTo(1524, 9);
    expect(parseLength("-1'6\"")).toBeCloseTo(-457.2, 9);
    expect(parseLength("1.2 m")).toBeCloseTo(1200, 9);
    setLengthFormat("cm");
    expect(parseLength("2.5")).toBe(25);
    setLengthFormat("ft-in");
    expect(parseLength("18")).toBeCloseTo(457.2, 9); // a bare number is inches, as in AutoCAD
    setLengthFormat("ft");
    expect(parseLength("1.5")).toBeCloseTo(457.2, 9);
    expect(getDisplayUnits()).toBe("ft");
    expect(isImperial()).toBe(true);
  });

  it("a readout keeps its decimals, so it doesn't jump as the pointer moves", () => {
    expect(lengthFixed(12.3)).toBe("12.30");
    expect(lengthFixed(-0.001)).toBe("0.00");
    setLengthFormat("m");
    expect(lengthFixed(1500)).toBe("1.500");
    setLengthFormat("in-frac", 16);
    expect(lengthFixed(25.4 * 2.375)).toBe("2 3/8");
  });
});
