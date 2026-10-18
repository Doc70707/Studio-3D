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

/** A part file for a slicer: the mesh as STL, or as 3MF with its name, units and place on the printer's plate. */
export type MeshFormat = "stl" | "3mf";

/** A slicer program on this computer, found in its usual folder or located by the user. */
export interface SlicerProgram {
  name: string;
  path: string;
}

export interface Platform {
  kind: "desktop" | "browser";
  capabilities: { saveInPlace: boolean };
  openProject(): Promise<{ file: FileRef; text: string } | null>;
  /** Saves to `target` if given (desktop only), otherwise asks where. Returns where it went, or null if cancelled. */
  saveProject(text: string, suggestedName: string, target?: FileRef): Promise<FileRef | null>;
  exportMesh(data: ArrayBuffer | Uint8Array, suggestedName: string, format: MeshFormat): Promise<FileRef | null>;
  /**
   * Opening a part in a slicer the user installed (desktop only): it runs as its own program with the file, the way
   * double-clicking the file would. Absent in the browser, which can't start programs.
   */
  slicers?: {
    /** Bambu Studio, OrcaSlicer and PrusaSlicer, where their installers put them. */
    find(): Promise<SlicerProgram[]>;
    /** Asks the user to point at a slicer's program file. */
    locate(): Promise<SlicerProgram | null>;
    /** Writes the part to the app's hand-off folder and opens it with the slicer. Returns the file's path. */
    open(program: SlicerProgram, data: Uint8Array, name: string, format: MeshFormat): Promise<string>;
  };
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
const bytesOf = (data: ArrayBuffer | Uint8Array) => (data instanceof Uint8Array ? data : new Uint8Array(data));
const MESH_FILTERS = {
  stl: { name: "STL mesh", extensions: ["stl"] },
  "3mf": { name: "3MF model", extensions: ["3mf"] },
};
const MESH_TYPES = { stl: "model/stl", "3mf": "model/3mf" };
const KNOWN_SLICERS: [RegExp, string][] = [
  [/bambu-studio/i, "Bambu Studio"],
  [/orca-slicer/i, "OrcaSlicer"],
  [/prusa-slicer/i, "PrusaSlicer"],
];
/** A located program's name: the slicer's own name if it's one we know, otherwise its file name. */
export const slicerName = (path: string) =>
  KNOWN_SLICERS.find(([re]) => re.test(baseName(path)))?.[1] ?? baseName(path).replace(/\.exe$/i, "");

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

  async exportMesh(data, suggestedName, format) {
    const filter = MESH_FILTERS[format];
    const chosen = await save({ defaultPath: withExt(suggestedName, format), filters: [filter] });
    if (!chosen) return null;
    const path = withExt(chosen, format);
    await invoke("write_export", { path, bytes: Array.from(bytesOf(data)) });
    return { name: baseName(path), path };
  },

  slicers: {
    async find() {
      return invoke<SlicerProgram[]>("find_slicers");
    },
    async locate() {
      const path = await open({
        multiple: false,
        directory: false,
        title: "Locate your slicer's program",
        filters: [{ name: "Programs", extensions: ["exe"] }],
      });
      if (typeof path !== "string") return null;
      return { name: slicerName(path), path };
    },
    open(program, data, name, format) {
      return invoke<string>("open_in_slicer", { program: program.path, name, ext: format, bytes: Array.from(data) });
    },
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

  async exportMesh(data, suggestedName, format) {
    const name = withExt(suggestedName, format);
    download(new Blob([bytesOf(data) as Uint8Array<ArrayBuffer>], { type: MESH_TYPES[format] }), name);
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
