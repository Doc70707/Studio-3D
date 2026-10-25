// Which object snaps are on, shared by the sketch and the 3D view and kept on this computer (like AutoCAD's OSNAP
// settings). F3 turns snapping off and on everywhere.
import { useSyncExternalStore } from "react";
import { DEFAULT_SNAPS, NEWER_SNAPS, SNAP_KINDS, type SnapKind } from "./precision";

export interface SnapSettings {
  on: boolean;
  kinds: SnapKind[];
}

const KEY = "studio3d.snaps";
/** Saved settings from before Point, Grid, Tangent and Shape centre existed don't list them; they start on. */
const VERSION = 2;

export function parseSnaps(raw: string | null): SnapSettings {
  try {
    const r = JSON.parse(raw ?? "null") as { on?: unknown; kinds?: unknown; v?: unknown } | null;
    if (!Array.isArray(r?.kinds)) return { on: typeof r?.on === "boolean" ? r.on : true, kinds: [...DEFAULT_SNAPS] };
    const saved = r.kinds as unknown[];
    const kinds = SNAP_KINDS.filter((k) => saved.includes(k) || (r.v !== VERSION && NEWER_SNAPS.includes(k)));
    return { on: typeof r.on === "boolean" ? r.on : true, kinds };
  } catch {
    return { on: true, kinds: [...DEFAULT_SNAPS] };
  }
}

function read(): SnapSettings {
  try {
    return parseSnaps(localStorage.getItem(KEY));
  } catch {
    return { on: true, kinds: [...DEFAULT_SNAPS] };
  }
}

let current: SnapSettings | null = null;
const listeners = new Set<() => void>();

export function getSnaps(): SnapSettings {
  return (current ??= read());
}

export function setSnaps(v: SnapSettings) {
  current = { on: v.on, kinds: SNAP_KINDS.filter((k) => v.kinds.includes(k)) };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, v: VERSION }));
  } catch {
    // Storage can be refused; the settings then last until the app closes.
  }
  listeners.forEach((l) => l());
}

/** Turns one snap on or off, keeping the others. */
export const toggleSnap = (kind: SnapKind) => {
  const s = getSnaps();
  setSnaps({ ...s, kinds: s.kinds.includes(kind) ? s.kinds.filter((k) => k !== kind) : [...s.kinds, kind] });
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSnaps(): [SnapSettings, (v: SnapSettings) => void] {
  return [useSyncExternalStore(subscribe, getSnaps), setSnaps];
}
