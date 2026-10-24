import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE, PALETTE_MAX_WIDTH, PALETTE_MIN_WIDTH, clampWidth, parseWorkspace, sideOf } from "./workspace";

describe("workspace layout", () => {
  it("nothing stored, or something unreadable, gives the default layout", () => {
    expect(parseWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
    expect(parseWorkspace("not json")).toEqual(DEFAULT_WORKSPACE);
    expect(parseWorkspace("42")).toEqual(DEFAULT_WORKSPACE);
  });

  it("a stored layout comes back as it was", () => {
    const ws = {
      ...DEFAULT_WORKSPACE,
      browserSide: "right" as const,
      browser: { shown: false, collapsed: true, width: 333 },
      ribbonMinimized: true,
      style: "floating" as const,
    };
    expect(parseWorkspace(JSON.stringify(ws))).toEqual(ws);
  });

  it("damaged parts fall back one by one, and widths stay within reach", () => {
    const ws = parseWorkspace(
      JSON.stringify({ browserSide: "up", browser: { shown: "yes", width: 5000 }, properties: { width: 10 } }),
    );
    expect(ws.browserSide).toBe("left");
    expect(ws.browser).toEqual({ shown: true, collapsed: false, width: PALETTE_MAX_WIDTH });
    expect(ws.properties.width).toBe(PALETTE_MIN_WIDTH);
    expect(clampWidth(Number.NaN)).toBe(PALETTE_MIN_WIDTH);
  });

  it("Properties always takes the side the Browser isn't on", () => {
    expect(sideOf(DEFAULT_WORKSPACE, "browser")).toBe("left");
    expect(sideOf(DEFAULT_WORKSPACE, "properties")).toBe("right");
    const swapped = { ...DEFAULT_WORKSPACE, browserSide: "right" as const };
    expect(sideOf(swapped, "properties")).toBe("left");
  });
});
