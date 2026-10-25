import { describe, expect, it } from "vitest";
import { DEFAULT_SNAPS } from "./precision";
import { parseSnaps } from "./snapSettings";

describe("saved snap settings", () => {
  it("start with the defaults, and keep what was saved", () => {
    expect(parseSnaps(null)).toEqual({ on: true, kinds: [...DEFAULT_SNAPS] });
    expect(parseSnaps(JSON.stringify({ on: false, kinds: ["end", "grid"], v: 2 }))).toEqual({
      on: false,
      kinds: ["end", "grid"],
    });
  });

  it("settings saved before the newer snaps existed get them switched on, keeping the old choices", () => {
    const old = parseSnaps(JSON.stringify({ on: true, kinds: ["end", "middle"] }));
    expect(new Set(old.kinds)).toEqual(new Set(["end", "middle", "geometric", "tangent", "grid", "node"]));
    expect(old.kinds).not.toContain("centre");
  });

  it("broken settings fall back to the defaults", () => {
    expect(parseSnaps("{not json")).toEqual({ on: true, kinds: [...DEFAULT_SNAPS] });
  });
});
