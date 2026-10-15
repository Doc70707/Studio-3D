# Recommended architecture

In plain language: the app is a web-technology interface (React) inside a lightweight Windows desktop shell (Tauri). The 3D view is drawn with Three.js. All real geometry is computed by OCCT running as WebAssembly in a background worker, so the interface never freezes. Your project is a small file of **parameters and steps**, and the 3D model is always rebuilt from it. That is what makes "change the width and everything updates" work, and what makes undo trustworthy.

## Stack

| Layer | Choice | Why | Alternative considered |
|---|---|---|---|
| Interface | React 19 + TypeScript | Huge ecosystem, easy to hire for, strong typing catches mistakes | Svelte, Solid (smaller ecosystems) |
| 3D viewport | Three.js 0.186 | The standard WebGL library; display only | Babylon.js (heavier, game-oriented) |
| Geometry | OCCT 8.0 WASM via replicad, in a Web Worker | See [kernel-comparison.md](kernel-comparison.md) | Native OCCT |
| Mesh tools | manifold-3d | Validation and booleans on imported STL | — |
| Desktop shell | Tauri 2.12 | Small installers (uses Windows' built-in WebView2), small Rust core, strict permission model | Electron: bundles its own Chromium, roughly 100 MB+ installers. It is the fallback if WebView2 causes trouble, and the UI code would carry over unchanged. |
| App state | Zustand | Small and simple | Redux (more ceremony) |
| Build and test | Vite, Vitest, Playwright, GitHub Actions (Windows + Linux) | Fast, standard; CI gives us real Windows proof | — |
| Project files | Zip container (fflate) with versioned JSON inside | Human-inspectable, extensible, safe to migrate | SQLite (overkill for now) |

## Modules (the 11 you required)

```
studio/
  apps/desktop/            Tauri shell (Rust): windows, file dialogs, atomic file writes, launch slicer
  packages/ui/             1. Application interface: Guided + Advanced mode over the same document
  packages/viewport/       2. Three.js scene, camera, selection, standard views (display only)
  packages/geometry/       3. Kernel adapter interface + OCCT worker + Manifold; validation guards
  packages/document/       4. Document types, schema, version migrations, units
  packages/features/       5. Feature list, parameters, dependencies, rebuild engine
  packages/history/        6. Undo/redo over immutable document snapshots
  packages/persistence/    7. Save/open/save-as, autosave, crash recovery (platform adapters: Tauri fs, browser)
  packages/io/             8. STL / 3MF / STEP export, STL / 3MF import (treated as untrusted)
  packages/validation/     9. Watertight, manifold, self-intersection, build-volume checks
  packages/print-prep/    10. Build plate, placement, orientation, duplication
  packages/integrations/  11. Slicer handoff (later: cloud, accounts, billing, all optional)
```

Rule: arrows only point downward. `ui` may use everything. `geometry` knows nothing about React or Three.js. `viewport` receives finished triangle meshes and never changes geometry.

## How a change flows

```
User types width = 80
  → ui dispatches command  setParam(box1.width, 80)
  → features validates input   (plain-language error? stop, keep old model)
  → history records new document snapshot
  → geometry worker rebuilds affected features with OCCT
  → validation checks result   (wrong or failed? revert to last valid, explain)
  → worker returns triangles + measurements
  → viewport displays; ui shows "Unsaved changes"
```

Each rebuild has a request ID, so newer edits cancel stale ones. If the worker crashes, we restart it and rebuild from the last valid document. No work is lost.

## Document model

- **Parametric features are the source of truth.** Each one has a stable ID, a type, parameters with units, and references to the features it depends on.
- **Imported meshes are a different kind of object.** They are stored as data, marked "mesh (not parametric)", and the UI never offers parametric editing for them.
- **Units:** stored internally in millimetres, displayed in the user's choice. Conversion happens only at the edges.
- **Undo/redo** stores whole document states (cheap, because documents are small parameter lists), so undo restores real geometry, never just the screen.
- **Unknown or unsupported data** read from a newer file is preserved untouched and reported to the user, never silently dropped.

## Project file (`.s3d`, name to be decided)

A zip containing `manifest.json` (format name, format version, app version), `document.json`, `meshes/*.stl` for imports, an optional `cache/*.brep` for fast reopening, and `thumbnail.png`.

Saving works like this:

1. Write to a temporary file and flush it to disk.
2. Rename it over the original.
3. Keep the previous version as `.bak`.

Autosave snapshots go to the app's data folder and are offered on the next launch after a crash. Opening a file never overwrites it silently. A corrupted or newer-version file gives a clear message and is left untouched.

## Security basics

- Imported files have size limits, are parsed defensively in the worker, and never run embedded scripts.
- Tauri capabilities are limited to dialogs plus file access the user picked.
- No secrets in frontend code.
- No uploads without explicit consent.
