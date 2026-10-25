// How sizes are shown and typed: millimetres, centimetres, metres, decimal or fractional inches, feet, or feet and
// inches, each to a chosen precision. The document itself is always in millimetres (a part is the same part whichever
// way it is shown); this only changes what people read and type. Thread names keep their standard's own units
// (M6 × 1, 1/4-20 UNC), and printer files stay in millimetres, which is what printers expect.

/** The unit shown numbers are in. */
export type DisplayUnits = "mm" | "cm" | "m" | "in" | "ft";

/** How a length is written: a unit, and for inches and feet whether as fractions ("2 3/8 in", 5' 3 1/2"). */
export type LengthStyle = "mm" | "cm" | "m" | "in" | "in-frac" | "ft" | "ft-in";

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

const MM_PER: Record<DisplayUnits, number> = { mm: 1, cm: 10, m: 1000, in: MM_PER_INCH, ft: MM_PER_FOOT };

export interface LengthStyleInfo {
  label: string;
  /** The unit plain numbers are in: shown in boxes, and typed without a unit. */
  unit: DisplayUnits;
  imperial: boolean;
  /** Precision as fractions (the smallest step is 1/precision of an inch) rather than decimal places. */
  fraction: boolean;
  /** The precisions offered: decimal places, or the smallest fraction's denominator. */
  precisions: number[];
  defaultPrecision: number;
}

export const LENGTH_STYLES: Record<LengthStyle, LengthStyleInfo> = {
  mm: {
    label: "Millimetres",
    unit: "mm",
    imperial: false,
    fraction: false,
    precisions: [0, 1, 2, 3],
    defaultPrecision: 2,
  },
  cm: {
    label: "Centimetres",
    unit: "cm",
    imperial: false,
    fraction: false,
    precisions: [1, 2, 3, 4],
    defaultPrecision: 2,
  },
  m: { label: "Metres", unit: "m", imperial: false, fraction: false, precisions: [2, 3, 4, 5], defaultPrecision: 3 },
  in: { label: "Inches", unit: "in", imperial: true, fraction: false, precisions: [1, 2, 3, 4], defaultPrecision: 3 },
  "in-frac": {
    label: "Inch fractions",
    unit: "in",
    imperial: true,
    fraction: true,
    precisions: [8, 16, 32, 64],
    defaultPrecision: 32,
  },
  ft: { label: "Feet", unit: "ft", imperial: true, fraction: false, precisions: [2, 3, 4, 5], defaultPrecision: 3 },
  "ft-in": {
    label: "Feet and inches",
    // Plain numbers (in a box, or typed without a unit) are inches, as in AutoCAD's architectural units.
    unit: "in",
    imperial: true,
    fraction: true,
    precisions: [8, 16, 32, 64],
    defaultPrecision: 16,
  },
};

export const LENGTH_STYLE_ORDER: LengthStyle[] = ["mm", "cm", "m", "in", "in-frac", "ft", "ft-in"];

let style: LengthStyle = "mm";
let precision = LENGTH_STYLES.mm.defaultPrecision;

/** Sets how every size is shown and typed; a precision the style doesn't offer becomes its default. */
export function setLengthFormat(next: LengthStyle, nextPrecision?: number): void {
  style = next;
  const info = LENGTH_STYLES[next];
  precision =
    nextPrecision !== undefined && info.precisions.includes(nextPrecision) ? nextPrecision : info.defaultPrecision;
}

/** Sets the units every size is shown and typed in, at that unit's usual precision. */
export function setDisplayUnits(units: DisplayUnits | LengthStyle): void {
  setLengthFormat(units);
}

export const getLengthStyle = (): LengthStyle => style;
export const getPrecision = (): number => precision;
export const getDisplayUnits = (): DisplayUnits => LENGTH_STYLES[style].unit;
export const isImperial = (): boolean => LENGTH_STYLES[style].imperial;

/** A length in millimetres as the number shown (in the shown unit), not rounded. */
export const toDisplay = (mm: number, units: DisplayUnits = getDisplayUnits()) => mm / MM_PER[units];

/** A number typed in the shown unit, as millimetres. */
export const fromDisplay = (v: number, units: DisplayUnits = getDisplayUnits()) => v * MM_PER[units];

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d + 0; // "+ 0" turns -0 into 0

/** Decimal places for a unit: the chosen precision when it is the shown unit in decimals, else the unit's usual. */
function decimals(units: DisplayUnits): number {
  const info = LENGTH_STYLES[style];
  if (info.unit === units && !info.fraction) return precision;
  const usual = LENGTH_STYLES[units as LengthStyle];
  // Fractions in the shown unit: decimals fine enough for the smallest fraction (1/64 in needs 4).
  if (info.unit === units) return Math.max(usual.defaultPrecision, Math.ceil(Math.log10(precision)) + 1);
  return usual.defaultPrecision;
}

/** A length as a number in the shown unit, rounded for reading: 12.35, or 0.486 for inches. */
export function lengthNumber(mm: number, units: DisplayUnits = getDisplayUnits()): number {
  return round(toDisplay(mm, units), decimals(units));
}

/** Inches as a whole number and a fraction to the nearest 1/den, reduced: "2 3/8", "3/8", "2", "-1 1/2". */
export function inchFraction(inches: number, den: number): string {
  const sign = inches < 0 ? "-" : "";
  let steps = Math.round(Math.abs(inches) * den);
  if (steps === 0) return "0";
  const whole = Math.floor(steps / den);
  steps -= whole * den;
  let d = den;
  while (steps > 0 && steps % 2 === 0) {
    steps /= 2;
    d /= 2;
  }
  const part = steps ? `${steps}/${d}` : "";
  return sign + [whole ? String(whole) : "", part].filter(Boolean).join(" ");
}

/** Feet and inches, as an architect writes them: 5' 3 1/2", or 3 1/2" under a foot. */
function feetInches(mm: number, den: number): string {
  const sign = mm < 0 ? "-" : "";
  const totalSteps = Math.round((Math.abs(mm) / MM_PER_INCH) * den);
  const feet = Math.floor(totalSteps / (12 * den));
  const rest = (totalSteps - feet * 12 * den) / den;
  // Under an inch after the feet, the whole inches are written as 0, as on a drawing: 4' 0 5/8".
  const inches = (feet && rest > 0 && rest < 1 ? "0 " : "") + inchFraction(rest, den);
  if (totalSteps === 0) return `0"`;
  return sign + (feet ? `${feet}' ${inches}"` : `${inches}"`);
}

/** The figure of a length in the shown style, without its unit: "12.35", "2 3/8", or 5' 3 1/2" (which has its own). */
export function lengthFigure(mm: number): string {
  if (style === "in-frac") return inchFraction(mm / MM_PER_INCH, precision);
  if (style === "ft-in") return feetInches(mm, precision);
  return String(lengthNumber(mm));
}

/** Like lengthFigure, but decimals always to the chosen precision ("12.30", "0.00"), so a readout doesn't jump. */
export function lengthFixed(mm: number): string {
  if (LENGTH_STYLES[style].fraction) return lengthFigure(mm);
  const v = toDisplay(mm);
  return (Math.abs(v) < 0.5 * 10 ** -precision ? 0 : v).toFixed(precision);
}

/** The unit written after a figure: "mm", "in"; nothing for feet and inches, whose marks are in the figure. */
export const unitSuffix = (): string => (style === "ft-in" ? "" : getDisplayUnits());

/** A length for reading: "12.35 mm", "0.486 in", "2 3/8 in", 5' 3 1/2". */
export function lengthText(mm: number, units?: DisplayUnits): string {
  if (units !== undefined && units !== getDisplayUnits()) return `${lengthNumber(mm, units)} ${units}`;
  const suffix = unitSuffix();
  return suffix ? `${lengthFigure(mm)} ${suffix}` : lengthFigure(mm);
}

/**
 * A length as text to edit in a box: exact, not rounded for reading. Fractions are used when the length is exactly
 * one (to the 1/64 inch); otherwise decimals to a millionth, so nothing is lost by opening a box and leaving it.
 */
export function lengthEditText(mm: number): string {
  const info = LENGTH_STYLES[style];
  if (style === "mm") return String(mm);
  const exactFraction = (inches: number) => Math.abs(inches * 64 - Math.round(inches * 64)) < 1e-6;
  if (style === "in-frac" && exactFraction(mm / MM_PER_INCH)) return inchFraction(mm / MM_PER_INCH, 64);
  if (style === "ft-in") {
    const inches = mm / MM_PER_INCH;
    if (exactFraction(inches)) return feetInches(mm, 64);
    return `${Math.round(inches * 1e6) / 1e6}"`;
  }
  return String(Math.round(toDisplay(mm, info.unit) * 1e6) / 1e6 + 0);
}

/** A volume for reading: "15.55 cm³", or "0.949 in³". */
export function volumeText(mm3: number, units: DisplayUnits = getDisplayUnits()): string {
  return units === "in" || units === "ft"
    ? `${round(mm3 / MM_PER_INCH ** 3, 3).toFixed(3)} in³`
    : `${(mm3 / 1000).toFixed(2)} cm³`;
}

const NUMBER = String.raw`(?:(\d+)\s+)?(\d*\.?\d+|\d+\.)(?:\s*\/\s*(\d*\.?\d+))?`;
const UNIT = String.raw`(mm|cm|m|inches|inch|in|"|''|feet|foot|ft|')`;
const PLAIN = new RegExp(String.raw`^${NUMBER}\s*${UNIT}?$`);
const FEET_INCHES = new RegExp(
  String.raw`^(\d*\.?\d+)\s*(?:'|ft|feet|foot)\s*-?\s*${NUMBER}\s*(?:"|''|in|inch|inches)?$`,
);

/** "1 1/2", "3/8", "2.5" as a number, or null ("1 5", "1/0"). */
function amount(whole: string | undefined, num: string, den: string | undefined): number | null {
  let v = Number(num);
  if (den !== undefined) {
    if (Number(den) === 0) return null;
    v /= Number(den);
  } else if (whole !== undefined) return null; // "1 5" is not a size
  if (whole !== undefined) v += Number(whole);
  return Number.isFinite(v) ? v : null;
}

const UNIT_OF: Record<string, DisplayUnits> = {
  mm: "mm",
  cm: "cm",
  m: "m",
  in: "in",
  inch: "in",
  inches: "in",
  '"': "in",
  "''": "in",
  ft: "ft",
  feet: "ft",
  foot: "ft",
  "'": "ft",
};

/**
 * Reads a typed size as millimetres, or null when it isn't one. A bare number is in the shown units (inches when
 * feet and inches are shown, as in AutoCAD); a number can also carry its own unit ("6 mm", "1.5 cm", "0.25 in", 1/4",
 * "2 ft", 5'3 1/2"), so any can be typed whichever is shown. Inches can be written as fractions, as on a tape measure.
 */
export function parseLength(text: string, units: DisplayUnits | LengthStyle = style): number | null {
  let t = text.trim().replace(/,/g, ".").toLowerCase();
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1).trim();
  if (t.startsWith("-")) return null;
  const sign = negative ? -1 : 1;
  const fi = FEET_INCHES.exec(t);
  if (fi) {
    const [, feet, whole, num, den] = fi;
    const inches = amount(whole, num!, den);
    return inches === null ? null : sign * (Number(feet) * MM_PER_FOOT + inches * MM_PER_INCH);
  }
  const m = PLAIN.exec(t);
  if (!m) return null;
  const [, whole, num, den, unit] = m;
  const v = amount(whole, num!, den);
  if (v === null) return null;
  const bare: DisplayUnits =
    units in LENGTH_STYLES ? LENGTH_STYLES[units as LengthStyle].unit : (units as DisplayUnits);
  return sign * v * MM_PER[unit === undefined ? bare : UNIT_OF[unit]!];
}
