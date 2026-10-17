// What the mouse and keyboard do depends on one mode at a time, so a gesture meant for one job (drawing, picking
// a face, dragging a move arrow) can never also do another (selecting a piece, nudging it, switching the view).

export type InteractionMode =
  /** Looking at and working on the part: click selects a piece, keys nudge it and change the view. */
  | "model"
  /** Waiting for a click on a flat face to sketch on it. */
  | "pick-face"
  /** The sketch screen is open and handles its own pointer and keys. */
  | "sketch"
  /** A move arrow is being dragged. */
  | "move";

export function interactionMode(s: { sketching: boolean; picking: boolean; moving: boolean }): InteractionMode {
  if (s.sketching) return "sketch";
  if (s.picking) return "pick-face";
  if (s.moving) return "move";
  return "model";
}

export type Action =
  /** Click a piece to select it, or empty space to let go. */
  | "select"
  /** Highlight the piece under the pointer. */
  | "hover"
  /** Click a flat face to start a sketch on it. */
  | "pick-face"
  /** Arrow keys and Page Up / Down move the selected piece; Delete removes it. */
  | "edit-keys"
  /** Single-key shortcuts: views (1-4, 0) and M for sizes. */
  | "view-keys"
  /** Ctrl shortcuts: undo, redo, save, open, new. */
  | "file-keys";

const ALLOWED: Record<InteractionMode, readonly Action[]> = {
  model: ["select", "hover", "edit-keys", "view-keys", "file-keys"],
  "pick-face": ["pick-face", "view-keys", "file-keys"],
  sketch: [],
  move: [],
};

export const allows = (mode: InteractionMode, action: Action) => ALLOWED[mode].includes(action);
