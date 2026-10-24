import { describe, expect, it } from "vitest";
import { duration } from "./PrintPanel";

describe("print time in words", () => {
  it("minutes, hours and minutes, or under a minute", () => {
    expect(duration(20)).toBe("under a minute");
    expect(duration(38 * 60 + 10)).toBe("38 min");
    expect(duration(65 * 60)).toBe("1 h 05 min");
    expect(duration(3 * 3600 + 59.6 * 60)).toBe("4 h 00 min");
  });
});
