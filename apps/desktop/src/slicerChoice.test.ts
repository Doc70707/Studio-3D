import { describe, expect, it } from "vitest";
import { defaultSlicer, slicerList } from "./slicerChoice";

const bambu = { name: "Bambu Studio", path: "C:\\Program Files\\Bambu Studio\\bambu-studio.exe" };
const orca = { name: "OrcaSlicer", path: "C:\\Program Files\\OrcaSlicer\\orca-slicer.exe" };
const prusa = { name: "PrusaSlicer", path: "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe" };
const cura = { name: "UltiMaker-Cura", path: "D:\\Cura\\UltiMaker-Cura.exe" };

describe("slicer choice", () => {
  it("lists Bambu Studio first, then Orca and Prusa, then one the user located", () => {
    expect(slicerList([prusa, orca, bambu], cura)).toEqual([bambu, orca, prusa, cura]);
    expect(slicerList([], cura)).toEqual([cura]);
    expect(slicerList([], null)).toEqual([]);
  });

  it("a located copy of a slicer that was also found is listed once", () => {
    const sameBambu = { ...bambu, path: bambu.path.toUpperCase() }; // Windows paths ignore case
    expect(slicerList([bambu, orca], sameBambu)).toEqual([bambu, orca]);
  });

  it("starts on the slicer used last, if it's still there", () => {
    const list = slicerList([bambu, orca], cura);
    expect(defaultSlicer(list, orca.path)).toBe(orca);
    expect(defaultSlicer(list, "C:\\gone.exe")).toBe(bambu);
    expect(defaultSlicer(list, null)).toBe(bambu);
    expect(defaultSlicer([], null)).toBeNull();
  });
});
