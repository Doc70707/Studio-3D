import { setUnits, useUnits } from "./unitsSetting";

/** Millimetres or inches, one click: in the status bar, and in the sketch's bottom bar while drawing. */
export function UnitsSwitch() {
  const units = useUnits();
  return (
    <div className="segmented-small units-switch" role="group" aria-label="Units" title="Show and type sizes in">
      <button type="button" aria-pressed={units === "mm"} onClick={() => setUnits("mm")}>
        mm
      </button>
      <button type="button" aria-pressed={units === "in"} onClick={() => setUnits("in")}>
        in
      </button>
    </div>
  );
}
