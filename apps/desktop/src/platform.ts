// Where files come from and go to. The desktop app uses native dialogs and safe
// atomic writes in the Rust shell; the browser build uses file pickers and downloads.
// The interface asks `platform.capabilities` before showing a control, so neither
// build offers something it can't do.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { FILE_EXTENSION } from "@studio3d/document";

export interface FileRef {
  /** File name shown to the user, e.g. "organiser.s3d". */
  name: string;
  /** Full path on desktop. Absent in the browser, where every save is a download. */
  path?: string;
}

export interface Platform {
  kind: "desktop" | "browser";
  capabilities: { saveInPlace: boolean };
  openProject(): Promise<{ file: FileRef; text: string } | null>;
  /** Saves to `target` if given (desktop only), otherwise asks where. Returns where it went, or null if cancelled. */
  saveProject(text: string, suggestedName: string, target?: FileRef): Promise<FileRef | null>;
  exportStl(data: ArrayBuffer, suggestedName: string): Promise<FileRef | null>;
  /**
   * `hasUnsavedChanges` is read when the user tries to close the app. `onDiscard` runs when they choose to close
   * without saving (desktop only: a browser can't tell a deliberate close from a crash).
   */
  guardClose(hasUnsavedChanges: () => boolean, onDiscard: () => Promise<void>): () => void;
  /** The crash-recovery copy of unsaved work, kept outside the user's own files. */
  recovery: {
    read(): Promise<string | null>;
    write(text: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** Asks before throwing away unsaved work. */
  confirmDiscard(message: string): Promise<boolean>;
  setTitle(title: string): void;
  /**
   * Full screen: the window covers the whole screen with no title bar or taskbar. `onChange` reports the real state
   * whenever it changes, including when something other than the app (the browser's own Escape) ends it.
   */
  fullScreen: {
    set(on: boolean): Promise<void>;
    onChange(listener: (on: boolean) => void): () => void;
  };
}

const RECOVERY_KEY = "studio3d.recovery";
const PROJECT_FILTER = { name: "Studio 3D project", extensions: [FILE_EXTENSION] };
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const withExt = (name: string, ext: string) => (name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`);

const desktop: Platform = {
  kind: "desktop",
  capabilities: { saveInPlace: true },

  async openProject() {
    const path = await open({ multiple: false, directory: false, filters: [PROJECT_FILTER] });
    if (typeof path !== "string") return null;
    const text = await invoke<string>("read_project", { path });
    return { file: { name: baseName(path), path }, text };
  },

  async saveProject(text, suggestedName, target) {
    let path = target?.path;
    if (!path) {
      const chosen = await save({ defaultPath: withExt(suggestedName, FILE_EXTENSION), filters: [PROJECT_FILTER] });
      if (!chosen) return null;
      path = withExt(chosen, FILE_EXTENSION);
    }
    await invoke("write_project", { path, text });
    return { name: baseName(path), path };
  },

  async exportStl(data, suggestedName) {
    const chosen = await save({ defaultPath: withExt(suggestedName, "stl"), filters: [{ name: "STL mesh", extensions: ["stl"] }] });
    if (!chosen) return null;
    const path = withExt(chosen, "stl");
    await invoke("write_export", { path, bytes: Array.from(new Uint8Array(data)) });
    return { name: baseName(path), path };
  },

  guardClose(hasUnsavedChanges, onDiscard) {
    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (event) => {
      if (!hasUnsavedChanges()) return;
      const leave = await ask("You have unsaved changes. Close Studio 3D without saving?", {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Close without saving",
        cancelLabel: "Keep working",
      });
      if (!leave) return event.preventDefault();
      // The user chose to throw the work away, so don't offer it back next time.
      await onDiscard().catch(() => {});
    });
    return () => void off.then((f) => f());
  },

  recovery: {
    read: () => invoke<string | null>("read_recovery"),
    write: (text) => invoke("write_recovery", { text }),
    clear: () => invoke("clear_recovery"),
  },

  confirmDiscard(message) {
    return ask(message, { title: "Unsaved changes", kind: "warning", okLabel: "Discard changes", cancelLabel: "Keep working" });
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
  },

  fullScreen: {
    async set(on) {
      await getCurrentWindow().setFullscreen(on);
    },
    onChange(listener) {
      const win = getCurrentWindow();
      // Going in or out of full screen resizes the window, so the resize event is when to ask.
      const check = () => void win.isFullscreen().then(listener, () => {});
      const off = win.onResized(check);
      check();
      return () => void off.then((f) => f());
    },
  },
};

const browser: Platform = {
  kind: "browser",
  capabilities: { saveInPlace: false },

  openProject() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `.${FILE_EXTENSION}`;
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        if (file.size > 50 * 1024 * 1024) return reject(new Error("This file is too large to be a Studio 3D project."));
        file.text().then((text) => resolve({ file: { name: file.name }, text }), reject);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },

  async saveProject(text, suggestedName) {
    const name = withExt(suggestedName, FILE_EXTENSION);
    download(new Blob([text], { type: "application/json" }), name);
    return { name };
  },

  async exportStl(data, suggestedName) {
    const name = withExt(suggestedName, "stl");
    download(new Blob([data], { type: "model/stl" }), name);
    return { name };
  },

  guardClose(hasUnsavedChanges) {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  },

  // Local storage can be switched off or full; recovery is then simply unavailable, never an error that stops work.
  recovery: {
    async read() {
      try {
        return localStorage.getItem(RECOVERY_KEY);
      } catch {
        return null;
      }
    },
    async write(text) {
      localStorage.setItem(RECOVERY_KEY, text);
    },
    async clear() {
      try {
        localStorage.removeItem(RECOVERY_KEY);
      } catch {
        // nothing to clear
      }
    },
  },

  async confirmDiscard(message) {
    return window.confirm(message);
  },

  setTitle(title) {
    document.title = title;
  },

  fullScreen: {
    async set(on) {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    },
    onChange(listener) {
      const check = () => listener(!!document.fullscreenElement);
      document.addEventListener("fullscreenchange", check);
      check();
      return () => document.removeEventListener("fullscreenchange", check);
    },
  },
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const platform: Platform = isTauri() ? desktop : browser;
