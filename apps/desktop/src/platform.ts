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
  /** `hasUnsavedChanges` is read when the user tries to close the app. */
  guardClose(hasUnsavedChanges: () => boolean): () => void;
  /** Asks before throwing away unsaved work. */
  confirmDiscard(message: string): Promise<boolean>;
  setTitle(title: string): void;
}

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

  guardClose(hasUnsavedChanges) {
    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (event) => {
      if (!hasUnsavedChanges()) return;
      const leave = await ask("You have unsaved changes. Close Studio 3D without saving?", {
        title: "Unsaved changes",
        kind: "warning",
        okLabel: "Close without saving",
        cancelLabel: "Keep working",
      });
      if (!leave) event.preventDefault();
    });
    return () => void off.then((f) => f());
  },

  confirmDiscard(message) {
    return ask(message, { title: "Unsaved changes", kind: "warning", okLabel: "Discard changes", cancelLabel: "Keep working" });
  },

  setTitle(title) {
    void getCurrentWindow().setTitle(title);
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

  async confirmDiscard(message) {
    return window.confirm(message);
  },

  setTitle(title) {
    document.title = title;
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
