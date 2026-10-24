// Screen modes: Full screen (the window covers the whole screen) and Focus canvas (most panels step aside so the
// part gets the room). They are independent, only change what is shown, and never touch the design, the selection
// or the camera.

/**
 * The side panel in Focus canvas: closed, opened by the user, or opened on its own because a piece is selected (so
 * its sizes can be typed) and closed again when it is let go.
 */
export type FocusPanel = "closed" | "open" | "auto";

/** The focus-canvas side panel after the selection changes. */
export function focusPanelAfterSelection(panel: FocusPanel, selected: boolean): FocusPanel {
  if (selected) return panel === "closed" ? "auto" : panel;
  return panel === "auto" ? "closed" : panel;
}

/** What Escape leaves, once it has nothing else to do (no menu, dialog, pick or selection): full screen first. */
export function escapeLeaves(s: { fullScreen: boolean; focus: boolean }): "full-screen" | "focus" | null {
  if (s.fullScreen) return "full-screen";
  if (s.focus) return "focus";
  return null;
}
