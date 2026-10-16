// Undo / redo. A pure data structure: the app keeps one of these and replaces it on every change.
import type { ProjectDocument } from "./model";

export interface History {
  past: ProjectDocument[];
  present: ProjectDocument;
  future: ProjectDocument[];
  /** What the last change was (e.g. "box.width"), so typing 1, 2, 0 in one field is a single undo step. */
  lastKey: string | null;
  lastAt: number;
}

/** How long a pause in typing in the same field starts a new undo step. */
export const MERGE_WINDOW_MS = 1000;
/** Oldest steps are dropped beyond this, so memory stays bounded. */
export const MAX_STEPS = 200;

export const startHistory = (doc: ProjectDocument): History => ({
  past: [],
  present: doc,
  future: [],
  lastKey: null,
  lastAt: 0,
});

/**
 * Records a change. Changes with the same key arriving within MERGE_WINDOW_MS of each other
 * merge into one step; pass key = null for a change that should always be its own step.
 */
export function record(
  h: History,
  next: ProjectDocument,
  key: string | null,
  now: number,
): History {
  if (next === h.present) return h;
  const merge =
    key !== null && key === h.lastKey && now - h.lastAt < MERGE_WINDOW_MS;
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_STEPS);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return {
    past: [...h.past, h.present],
    present: next,
    future: rest,
    lastKey: null,
    lastAt: 0,
  };
}
