import { LENGTH_STYLES, isImperial } from "@studio3d/document";
import { lastFormat, setSystem, useFormatKey } from "./unitsSetting";

/**
 * Metric or imperial, one click: in the status bar, and in the sketch's bottom bar while drawing. Each side names the
 * unit it goes to (mm, cm or m; in or ft), the last one used; Settings › Units picks among them and their precision.
 */
export function UnitsSwitch() {
  useFormatKey();
  const imperial = isImperial();
  const name = (i: boolean) => {
    const s = lastFormat(i).style;
    return s === "ft-in" ? "ft-in" : LENGTH_STYLES[s].unit;
  };
  return (
    <div className="segmented-small units-switch" role="group" aria-label="Units" title="Show and type sizes in">
      <button type="button" aria-pressed={!imperial} onClick={() => setSystem(false)}>
        {name(false)}
      </button>
      <button type="button" aria-pressed={imperial} onClick={() => setSystem(true)}>
        {name(true)}
      </button>
    </div>
  );
}
