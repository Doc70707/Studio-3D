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

export const startHistory = (doc: ProjectDocument): History => ({ past: [], present: doc, future: [], lastKey: null, lastAt: 0 });

/**
 * Keys starting with this mark the parts of one action made of several changes (everything the helper does for one
 * request): they merge into one undo step however long apart they come, as long as nothing else happens between.
 */
export const GROUP_KEY = "group:";

/**
 * Records a change. Changes with the same key arriving within MERGE_WINDOW_MS of each other
 * merge into one step; pass key = null for a change that should always be its own step.
 */
export function record(h: History, next: ProjectDocument, key: string | null, now: number): History {
  if (next === h.present) return h;
  const merge =
    key !== null && key === h.lastKey && (key.startsWith(GROUP_KEY) || now - h.lastAt < MERGE_WINDOW_MS);
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_STEPS);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

/**
 * Takes back the last step as if it never happened, when it is the one made under `key`: for a change that turned
 * out not to work (a helper's change the part couldn't be built with). Unlike undo, it can't be redone.
 */
export function withdraw(h: History, key: string): History {
  const prev = h.past[h.past.length - 1];
  if (!prev || h.lastKey !== key) return h;
  return { past: h.past.slice(0, -1), present: prev, future: h.future, lastKey: null, lastAt: 0 };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}
