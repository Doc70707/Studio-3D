import { describe, expect, it } from "vitest";
import { anyTyped, liveValues, startTyping, typedNumber, typedPoint, typeKey, type Typed } from "./dynamicInput";

const type = (t: Typed, keys: string[]) => keys.reduce((acc, k) => typeKey(acc, k) ?? acc, t);

describe("typing sizes while drawing", () => {
  it("digits, a decimal point and a minus go into the active box; Tab moves to the next and wraps", () => {
    let t = type(startTyping("rectangle"), ["4", "0", ".", "5", ".", "Tab", "2", "5"]);
    expect(t.values).toEqual(["40.5", "25"]);
    t = typeKey(t, "Tab")!;
    expect(t.active).toBe(0);
    t = typeKey(t, "Tab", true)!;
    expect(t.active).toBe(1);
    expect(type(startTyping("circle"), ["1", "-"]).values).toEqual(["-1"]);
  });

  it("Backspace deletes typed characters, and is left alone when there is nothing to delete", () => {
    const t = type(startTyping("circle"), ["1", "2"]);
    expect(typeKey(t, "Backspace")!.values).toEqual(["1"]);
    expect(typeKey(startTyping("circle"), "Backspace")).toBeNull();
    expect(typeKey(t, "r")).toBeNull(); // tool letters keep working
  });

  it("only complete numbers count", () => {
    expect(typedNumber("12.5")).toBe(12.5);
    expect(typedNumber(".5")).toBe(0.5);
    expect(typedNumber("-3")).toBe(-3);
    for (const s of ["", "-", ".", "1.2.3", undefined]) expect(typedNumber(s)).toBeNull();
    expect(anyTyped(startTyping("polygon"))).toBe(false);
    expect(anyTyped(type(startTyping("polygon"), ["3"]))).toBe(true);
  });

  it("a rectangle takes the typed width and height, drawn towards the pointer", () => {
    const t = type(startTyping("rectangle"), ["4", "0", "Tab", "2", "5"]);
    expect(typedPoint("rectangle", [10, 10], [50, 50], t)).toEqual([50, 35]);
    expect(typedPoint("rectangle", [10, 10], [0, 0], t)).toEqual([-30, -15]); // pointer down-left
    // Only the width typed: the height still follows the pointer.
    const w = type(startTyping("rectangle"), ["4", "0"]);
    expect(typedPoint("rectangle", [0, 0], [7, 12.5], w)).toEqual([40, 12.5]);
    // A negative size goes the other way whatever the pointer does.
    expect(typedPoint("rectangle", [0, 0], [5, 5], type(startTyping("rectangle"), ["-", "8"]))).toEqual([-8, 5]);
  });

  it("a circle takes the typed diameter, around the centre", () => {
    const t = type(startTyping("circle"), ["2", "0"]);
    expect(typedPoint("circle", [5, 5], [5, 50], t)).toEqual([5, 15]);
    expect(typedPoint("circle", [0, 0], null, t)).toEqual([10, 0]); // no pointer: to the right
    expect(typedPoint("circle", [0, 0], [3, 4], null)).toEqual([3, 4]);
  });

  it("an outline's next corner takes the typed length and angle", () => {
    const len = type(startTyping("polygon"), ["1", "0"]);
    expect(typedPoint("polygon", [0, 0], [0, 3], len)).toEqual([0, 10]); // along the pointer's direction
    const both = type(startTyping("polygon"), ["1", "0", "Tab", "9", "0"]);
    expect(typedPoint("polygon", [2, 2], [50, 0], both)).toEqual([2, 12]);
    const angleOnly = type(startTyping("polygon"), ["Tab", "1", "8", "0"]);
    expect(typedPoint("polygon", [0, 0], [3, 4], angleOnly)).toEqual([-5, 0]);
  });

  it("boxes show the pointer's sizes while nothing is typed", () => {
    expect(liveValues("rectangle", [0, 0], [-12, 7.255])).toEqual(["12", "7.26"]);
    expect(liveValues("circle", [0, 0], [3, 4])).toEqual(["10"]);
    expect(liveValues("polygon", [0, 0], [0, -2])).toEqual(["2", "270"]);
  });
});
