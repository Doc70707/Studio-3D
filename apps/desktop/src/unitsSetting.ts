// Millimetres or inches, picked from the status bar or the View menu and kept on this computer. Every size the app
// shows or reads follows it at once; the part itself never changes (see units.ts in the document package).
import { useSyncExternalStore } from "react";
import { getDisplayUnits, setDisplayUnits, type DisplayUnits } from "@studio3d/document";

const KEY = "studio3d.units";
const listeners = new Set<() => void>();

export function parseUnits(raw: string | null): DisplayUnits {
  return raw === "in" ? "in" : "mm";
}

/** Reads the saved choice; called once before the first paint so sizes never flash in the wrong units. */
export function loadUnits(): void {
  try {
    setDisplayUnits(parseUnits(localStorage.getItem(KEY)));
  } catch {
    setDisplayUnits("mm");
  }
}

export function setUnits(units: DisplayUnits): void {
  if (units === getDisplayUnits()) return;
  setDisplayUnits(units);
  try {
    localStorage.setItem(KEY, units);
  } catch {
    // Storage can be refused; the choice then lasts until the app closes.
  }
  listeners.forEach((l) => l());
}

export const toggleUnits = () => setUnits(getDisplayUnits() === "mm" ? "in" : "mm");

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The units sizes are shown in, re-rendering the component when they change. */
export const useUnits = () => useSyncExternalStore(subscribe, getDisplayUnits);
