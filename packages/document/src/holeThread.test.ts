import { describe, expect, it } from "vitest";
import type { HoleFeature } from "./model";
import { checkThread, suggestThread, threadSettingsFor, withThread } from "./holeThread";

const hole = (over: Partial<HoleFeature> = {}): HoleFeature => ({
  id: "h1",
  type: "hole",
  name: "Hole 1",
  x: 0,
  y: 0,
  diameter: 6,
  depth: 0,
  ...over,
});

describe("threading an existing hole", () => {
  it("suggests the thread whose screw size or tap drill matches the hole", () => {
    expect(suggestThread(6)).toBe("M6"); // screw size
    expect(suggestThread(4.2)).toBe("M5"); // M5's tap drill
    expect(suggestThread(6.8)).toBe("M8"); // M8's tap drill
    expect(suggestThread(6.35, "UNC")).toBe("1/4-20 UNC");
    expect(threadSettingsFor(hole({ diameter: 8.5 })).thread).toBe("M10");
    expect(threadSettingsFor(hole({ diameter: 6.35 }), true).thread).toBe("1/4-20 UNC"); // inches shown: inch sizes
  });

  it("starts from the hole's own thread when it has one", () => {
    const s = threadSettingsFor(hole({ thread: "M8", fit: 0.15, threadDepth: 9, hand: "left", simplified: true }));
    expect(s).toEqual({
      thread: "M8",
      hand: "left",
      length: 9,
      depth: 0,
      fit: 0.15,
      cosmetic: true,
      drillPoint: false,
    });
  });

  it("applies as hole settings, replacing a clearance size or a head recess", () => {
    const h = hole({ clearance: { screw: "M6", series: "medium" }, head: { kind: "countersink", diameter: 12 } });
    const t = withThread(h, {
      thread: "M6",
      hand: "left",
      length: 8,
      depth: 12,
      fit: 0.3,
      cosmetic: false,
      drillPoint: false,
    });
    expect(t).toEqual({ ...hole({ depth: 12 }), thread: "M6", fit: 0.3, hand: "left", threadDepth: 8 });
    const plain = withThread(t, {
      thread: "M6",
      hand: "right",
      length: null,
      depth: 0,
      fit: 0.3,
      cosmetic: true,
      drillPoint: true,
    });
    expect(plain.hand).toBeUndefined();
    expect(plain.drillPoint).toBeUndefined(); // a through hole has no bottom for a point
    expect(withThread(t, { ...threadSettingsFor(t), drillPoint: true }).drillPoint).toBe(true);
    expect(plain.threadDepth).toBeUndefined();
    expect(plain.simplified).toBe(true);
  });

  it("checks the thread against the hole and offers a better size", () => {
    const settings = threadSettingsFor(hole());
    expect(checkThread(hole(), settings, 20)[0]).toEqual({
      severity: "ok",
      message: "Fits: the Ø6 mm hole is the size of an M6 × 1 screw.",
    });
    const wide = checkThread(hole({ diameter: 10 }), settings, 20)[0]!;
    expect(wide.severity).toBe("warning");
    expect(wide.message).toContain("wider than the M6 × 1 thread's grooves (Ø6.3 mm)");
    expect(wide.better).toBe("M10");
    const small = checkThread(hole({ diameter: 3 }), settings, 20)[0]!;
    expect(small.message).toContain("smaller than the M6 × 1 tap drill (5 mm)");
    expect(small.better).toBe("M3");
  });

  it("a thread longer than the hole, or shorter than two turns, is refused", () => {
    const s = { ...threadSettingsFor(hole()), depth: 10 };
    expect(checkThread(hole(), { ...s, length: 12 }, 20).find((c) => c.severity === "error")?.message).toBe(
      "The thread can't be longer than the hole: use 10 mm or less.",
    );
    expect(checkThread(hole(), { ...s, length: 1.5 }, 20).find((c) => c.severity === "error")?.message).toBe(
      "M6 × 1 needs at least two turns: make it at least 2 mm long.",
    );
    expect(checkThread(hole(), { ...s, length: 8 }, 20).some((c) => c.severity === "error")).toBe(false);
  });
});
