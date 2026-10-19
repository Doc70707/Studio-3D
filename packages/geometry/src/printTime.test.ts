import { describe, expect, it } from "vitest";
import { movesTime, type TimedMove } from "./gcodeCheck";

const x = (length: number, speed: number): TimedMove => ({ length, speed, direction: [1, 0, 0] });
const y = (length: number, speed: number): TimedMove => ({ length, speed, direction: [0, 1, 0] });

describe("how long the moves take", () => {
  it("one move speeds up, runs at its speed and slows down", () => {
    // 100 mm at 100 mm/s, 1000 mm/s²: 5 mm to speed up, 5 to slow down (0.1 s each), 90 mm at full speed (0.9 s).
    expect(movesTime([x(100, 100)], 1000)).toBeCloseTo(1.1, 9);
  });

  it("a move too short to reach its speed peaks part way", () => {
    // 2 mm at 1000 mm/s²: 1 mm up and 1 mm down, peaking at √2000 mm/s.
    expect(movesTime([x(2, 100)], 1000)).toBeCloseTo((2 * Math.sqrt(2000)) / 1000, 9);
  });

  it("going straight on keeps the speed; a square corner stops", () => {
    expect(movesTime([x(50, 100), x(50, 100)], 1000)).toBeCloseTo(1.1, 9);
    expect(movesTime([x(50, 100), y(50, 100)], 1000)).toBeCloseTo(2 * 0.6, 9);
  });

  it("a slower move after a fast one slows to its speed before it starts", () => {
    // 100 mm/s for 100 mm, then 50 mm/s for 100 mm, straight on.
    const first = 0.1 + (100 - 5 - 3.75) / 100 + 0.05; // up 5 mm, down to 50 over 3.75 mm
    const second = (100 - 1.25) / 50 + 0.05; // runs at 50, then stops over 1.25 mm
    expect(movesTime([x(100, 100), x(100, 50)], 1000)).toBeCloseTo(first + second, 9);
  });
});
