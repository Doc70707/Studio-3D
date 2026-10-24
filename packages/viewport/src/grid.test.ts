import { describe, expect, it } from "vitest";
import { INCH_GRID, MIN_CELL_PIXELS, MM_GRID, gridLevels, snapStep } from "./grid";

describe("the adaptive grid", () => {
  it("shows 1 mm squares close up, 10 mm further out and 100 mm far away, never closer than a few pixels", () => {
    expect(gridLevels(0.05, MM_GRID)).toMatchObject({ fine: 1, coarse: 10 });
    expect(gridLevels(0.5, MM_GRID)).toMatchObject({ fine: 1, coarse: 10 });
    expect(gridLevels(2, MM_GRID)).toMatchObject({ fine: 10, coarse: 100 });
    expect(gridLevels(20, MM_GRID)).toMatchObject({ fine: 100, coarse: 1000 });
    for (const mmPerPixel of [0.01, 0.3, 1, 7, 40, 300]) {
      const { fine, coarse, t } = gridLevels(mmPerPixel, MM_GRID);
      // The fading squares are under MIN_CELL_PIXELS across; the next size up, drawn in full, is at least that.
      expect(coarse / mmPerPixel).toBeGreaterThanOrEqual(MIN_CELL_PIXELS * (1 - 1e-9));
      if (fine > MM_GRID.unit) expect(fine / mmPerPixel).toBeLessThanOrEqual(MIN_CELL_PIXELS * (1 + 1e-9));
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });

  it("cross-fades smoothly: zooming out a little changes the fade a little, never a jump in what is drawn", () => {
    // How strongly each square size is drawn and how much as a major line, as the shader works it out: the finest
    // fades out, the middle size turns from major to minor, the largest is major.
    const drawn = (mmPerPixel: number) => {
      const { fine, coarse, t } = gridLevels(mmPerPixel, MM_GRID);
      return new Map<number, [number, number]>([
        [fine, [1 - t, 0]],
        [coarse, [1, 1 - t]],
        [coarse * MM_GRID.factor, [1, 1]],
      ]);
    };
    let before = drawn(0.1);
    for (let mmPerPixel = 0.1; mmPerPixel < 1000; mmPerPixel *= 1.01) {
      const now = drawn(mmPerPixel);
      for (const [size, [w, major]] of now) {
        const was = before.get(size);
        // A size appearing for the first time lies on lines already drawn as major ones, so nothing changes on screen.
        if (!was) {
          expect(
            [...before].some(([s, [, m]]) => m === 1 && (size / s) % 1 === 0),
            `${size} mm`,
          ).toBe(true);
          continue;
        }
        expect(Math.abs(w - was[0]!), `${size} mm at ${mmPerPixel.toFixed(3)} mm/px`).toBeLessThan(0.05);
        expect(Math.abs(major - was[1]!), `${size} mm at ${mmPerPixel.toFixed(3)} mm/px`).toBeLessThan(0.05);
      }
      // A size that disappears had already faded out.
      for (const [size, [w]] of before) if (!now.has(size)) expect(w).toBeLessThan(0.05);
      before = now;
    }
  });

  it("inches go 1/16, 1/4, 1 and 4 inches; the snap uses the squares that are clearly drawn", () => {
    expect(gridLevels(0.02, INCH_GRID).fine).toBeCloseTo(25.4 / 16, 9);
    expect(gridLevels(1, INCH_GRID).fine).toBeCloseTo(6.35, 9);
    expect(gridLevels(4, INCH_GRID).fine).toBeCloseTo(25.4, 9);
    expect(snapStep(0.2, MM_GRID)).toBe(1);
    expect(snapStep(1.2, MM_GRID)).toBe(10);
  });
});
