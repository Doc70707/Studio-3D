// How sizes are shown and typed (millimetres, centimetres, metres, inches as decimals or fractions, feet, or feet and
// inches) and to what precision, picked in Settings, the status bar or the View menu and kept on this computer. Every
// size the app shows or reads follows it at once; the part itself never changes (see units.ts in the document
// package).
import { useSyncExternalStore } from "react";
import {
  LENGTH_STYLES,
  getDisplayUnits,
  getLengthStyle,
  getPrecision,
  isImperial,
  setLengthFormat,
  type DisplayUnits,
  type LengthStyle,
} from "@studio3d/document";

const KEY = "studio3d.units";
const listeners = new Set<() => void>();

export interface LengthFormat {
  style: LengthStyle;
  precision: number;
}

/** Reads a saved choice: "mm" and "in" from before there were more, or {"style","precision"}. */
export function parseUnits(raw: string | null): LengthFormat {
  if (raw === "in" || raw === "mm") return { style: raw, precision: LENGTH_STYLES[raw].defaultPrecision };
  try {
    const v = JSON.parse(raw ?? "") as Partial<LengthFormat>;
    if (typeof v.style === "string" && v.style in LENGTH_STYLES) {
      const info = LENGTH_STYLES[v.style];
      const p = typeof v.precision === "number" && info.precisions.includes(v.precision) ? v.precision : undefined;
      return { style: v.style, precision: p ?? info.defaultPrecision };
    }
  } catch {
    // Not a saved choice: millimetres.
  }
  return { style: "mm", precision: LENGTH_STYLES.mm.defaultPrecision };
}

/** Reads the saved choice; called once before the first paint so sizes never flash in the wrong units. */
export function loadUnits(): void {
  try {
    const f = parseUnits(localStorage.getItem(KEY));
    setLengthFormat(f.style, f.precision);
    last[isImperial() ? "imperial" : "metric"] = f;
  } catch {
    setLengthFormat("mm");
  }
}

export const getLengthFormat = (): LengthFormat => ({ style: getLengthStyle(), precision: getPrecision() });

/** Shows sizes in a style, at a precision (the style's usual one when not given), and keeps the choice. */
export function setFormat(f: { style: LengthStyle; precision?: number }): void {
  if (f.style === getLengthStyle() && (f.precision === undefined || f.precision === getPrecision())) return;
  setLengthFormat(f.style, f.precision);
  try {
    localStorage.setItem(KEY, JSON.stringify(getLengthFormat()));
  } catch {
    // Storage can be refused; the choice then lasts until the app closes.
  }
  listeners.forEach((l) => l());
}

/** Shows sizes in a style at its usual precision. */
export const setUnits = (units: DisplayUnits | LengthStyle) => setFormat({ style: units });

// The last metric and imperial choices, so the quick switch goes back to feet and inches rather than plain inches.
const last: { metric: LengthFormat; imperial: LengthFormat } = {
  metric: { style: "mm", precision: LENGTH_STYLES.mm.defaultPrecision },
  imperial: { style: "in", precision: LENGTH_STYLES.in.defaultPrecision },
};
listeners.add(() => (last[isImperial() ? "imperial" : "metric"] = getLengthFormat()));

/** The metric or imperial choice the quick switch goes to: the one in use, or the last one used. */
export const lastFormat = (imperial: boolean): LengthFormat =>
  isImperial() === imperial ? getLengthFormat() : last[imperial ? "imperial" : "metric"];

/** Metric or imperial: the quick switch in the status bar and the View menu. */
export const setSystem = (imperial: boolean) => setFormat(lastFormat(imperial));
export const toggleUnits = () => setSystem(!isImperial());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const formatKey = () => `${getLengthStyle()}:${getPrecision()}`;

/** "ft-in:16": changes whenever the style or the precision does, to re-render what shows sizes. */
export const useFormatKey = () => useSyncExternalStore(subscribe, formatKey);

/** The unit sizes are shown in, re-rendering the component when the style or precision changes. */
export function useUnits(): DisplayUnits {
  useFormatKey();
  return getDisplayUnits();
}
