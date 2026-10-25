import { describe, expect, it } from "vitest";
import type { HoleFeature, ProjectDocument } from "@studio3d/document";
import { cosmeticThreadLines } from "./cosmeticThreads";

const hole = (over: Partial<HoleFeature>): HoleFeature => ({
  id: "h1",
  type: "hole",
  name: "Hole 1",
  x: 5,
  y: -4,
  diameter: 6,
  depth: 0,
  ...over,
});
const doc = (...features: HoleFeature[]): ProjectDocument => ({ units: "mm", features });
const bounds = { min: [-30, -20, 0], max: [30, 20, 30] };
/** The distinct points of the marks, grouped by height. */
const circles = (lines: number[]) => {
  const byHeight = new Map<number, number[][]>();
  for (let i = 0; i < lines.length; i += 3) {
    const z = Math.round(lines[i + 2]! * 1000) / 1000;
    byHeight.set(z, [...(byHeight.get(z) ?? []), [lines[i]!, lines[i + 1]!]]);
  }
  return byHeight;
};

describe("cosmetic thread marks", () => {
  it("a cosmetic M6 through the top: circles of the full 6 mm size at the top and the bottom", () => {
    const c = circles(cosmeticThreadLines(doc(hole({ thread: "M6", simplified: true })), bounds));
    expect([...c.keys()].sort((a, b) => a - b)).toEqual([0, 30]);
    for (const pts of c.values()) for (const [x, y] of pts) expect(Math.hypot(x! - 5, y! + 4)).toBeCloseTo(3, 9);
  });

  it("ends where a shorter thread ends; modelled threads and plain holes get no marks", () => {
    const c = circles(cosmeticThreadLines(doc(hole({ thread: "M6", simplified: true, threadDepth: 8 })), bounds));
    expect([...c.keys()].sort((a, b) => a - b)).toEqual([22, 30]);
    expect(cosmeticThreadLines(doc(hole({ thread: "M6" }), hole({ id: "h2" })), bounds)).toEqual([]);
  });
});
