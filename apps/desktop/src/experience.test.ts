import { describe, expect, it } from "vitest";
import { parseExperience, ribbonFor, shownIn } from "./experience";
import type { RibbonTab } from "./Ribbon";

const item = (label: string, name?: string) => ({ icon: "box" as const, label, name, onClick: () => {} });
const TABS: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      { label: "Shapes", items: [item("Box", "Add box"), item("Tube", "Add tube")] },
      { label: "Sketch", items: [item("On a face", "Sketch on a face"), item("Revolve")] },
      { label: "Modify", items: [item("Hollow", "Hollow out"), item("Fillet"), item("Pattern"), item("Mirror")] },
    ],
  },
  { id: "view", label: "View", groups: [{ label: "Scene", items: [item("Grid")] }] },
];
const names = (tabs: RibbonTab[]) => tabs.map((t) => [t.id, t.groups.map((g) => g.items.map((i) => i.label))]);

describe("experience modes", () => {
  it("Advanced shows the ribbon as it is", () => {
    expect(ribbonFor("advanced", TABS)).toBe(TABS);
  });

  it("Easy leaves the rarer tools to the menus", () => {
    expect(names(ribbonFor("easy", TABS))).toEqual([
      ["home", [["Box", "Tube"], ["On a face"], ["Hollow", "Fillet"]]],
      ["view", [["Grid"]]],
    ]);
  });

  it("Kids keeps a few shapes and Hollow, drops empty groups and the View tab", () => {
    expect(names(ribbonFor("kids", TABS))).toEqual([["home", [["Box"], ["Hollow"]]]]);
    expect(shownIn("kids")).toEqual({ menus: false, commandLine: false, helper: false });
    expect(shownIn("easy")).toEqual({ menus: true, commandLine: true, helper: true });
  });

  it("reads only the three modes back", () => {
    expect(parseExperience("kids")).toBe("kids");
    expect(parseExperience("Advanced")).toBeNull();
    expect(parseExperience(null)).toBeNull();
  });
});
