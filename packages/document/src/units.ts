// Millimetres or inches, for showing and typing sizes. The document itself is always in millimetres (a part is
// the same part whichever way it is shown); this only changes what people read and type. Thread names keep their
// standard's own units (M6 × 1, 1/4-20 UNC), and printer files stay in millimetres, which is what printers expect.

export type DisplayUnits = "mm" | "in";

export const MM_PER_INCH = 25.4;

let current: DisplayUnits = "mm";

/** Sets the units every size is shown and typed in. */
export function setDisplayUnits(units: DisplayUnits): void {
  current = units;
}

export function getDisplayUnits(): DisplayUnits {
  return current;
}

/** A length in millimetres as the number shown (millimetres or inches), not rounded. */
export const toDisplay = (mm: number, units = current) => (units === "in" ? mm / MM_PER_INCH : mm);

/** A number typed in the shown units, as millimetres. */
export const fromDisplay = (v: number, units = current) => (units === "in" ? v * MM_PER_INCH : v);

/** How many decimals a shown size keeps: hundredths of a millimetre, thousandths of an inch. */
const DECIMALS: Record<DisplayUnits, number> = { mm: 2, in: 3 };

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d + 0; // "+ 0" turns -0 into 0

/** A length as a number in the shown units, rounded for reading: 12.35, or 0.486 for inches. */
export function lengthNumber(mm: number, units = current): number {
  return round(toDisplay(mm, units), DECIMALS[units]);
}

/** A length for reading: "12.35 mm", or "0.486 in". */
export function lengthText(mm: number, units = current): string {
  return `${lengthNumber(mm, units)} ${units}`;
}

/** A volume for reading: "15.55 cm³", or "0.949 in³". */
export function volumeText(mm3: number, units = current): string {
  return units === "in" ? `${round(mm3 / MM_PER_INCH ** 3, 3).toFixed(3)} in³` : `${(mm3 / 1000).toFixed(2)} cm³`;
}

/**
 * Reads a typed size as millimetres, or null when it isn't one. A bare number is in the shown units; a number can
 * also carry its own unit ("6 mm", "1.5 cm", "0.25 in", 1/4", "1 1/2 in"), so either can be typed whichever is
 * shown. Inches can be written as fractions, as on a tape measure.
 */
export function parseLength(text: string, units = current): number | null {
  const t = text.trim().replace(/,/g, ".").toLowerCase();
  const m = /^(-?)\s*(?:(\d+)\s+)?(\d*\.?\d+|\d+\.)(?:\s*\/\s*(\d*\.?\d+))?\s*(mm|cm|in|inch|inches|"|'')?$/.exec(t);
  if (!m) return null;
  const [, sign, whole, num, den, unit] = m;
  let v = Number(num);
  if (den !== undefined) {
    if (Number(den) === 0) return null;
    v /= Number(den);
  } else if (whole !== undefined) return null; // "1 5" is not a size
  if (whole !== undefined) v += Number(whole);
  if (sign) v = -v;
  if (!Number.isFinite(v)) return null;
  const u = unit === undefined ? units : unit === "mm" ? "mm" : unit === "cm" ? "cm" : "in";
  return u === "cm" ? v * 10 : fromDisplay(v, u);
}
