# Studio 3D

A beginner-first 3D design studio for making functional, dimensionally accurate parts for 3D printing. Windows desktop first; browser later.

## Status

| Milestone | State |
|---|---|
| 0. Audit and feasibility | Done. See [docs/milestone-0](docs/milestone-0/README.md) |
| 1. Running application | Done. App shell, 3D viewport, camera controls, tests, Windows CI |
| 2. Real geometry proof | **In review.** Real box from the OCCT kernel, save/reopen, verified STL export |
| 3. Guided "Make a Box" | Next |
| 4. Editing and operations | **In progress.** Holes (cut by the kernel) and undo/redo are in review |

What works today:

- A box with width, depth, height and wall thickness (0 = solid block, more = open-top container),
  built as a real solid by the OCCT geometry kernel in a background worker. The 3D view updates as you type.
- Plain-language errors for impossible values; the last valid box stays on screen and Export is disabled until fixed.
- Outside size, inside space and material volume, measured from the real geometry.
- New, Open, Save, Save as (Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S). Desktop saves are atomic and keep a `.bak`
  of the previous version. You're asked before unsaved changes are thrown away or the window closes.
- Holes: add round holes that go straight down from the top, all the way through or to a set depth. Each cut is
  checked against the hand calculation, holes that run off an edge are explained, and a hole that cuts nothing gets a warning.
- Undo and redo (Ctrl+Z, Ctrl+Y) for every change. Typing a number counts as one step.
- Export STL for your slicer. Tests check every exported mesh is watertight with exact dimensions, independently with trimesh.
- 3D view of a 256 × 256 mm build plate with orbit, pan, zoom and standard views (keys 0–3).
- A clean frosted-glass interface: the 3D view fills the window and the controls float over it. Text contrast is
  checked by a test, and the app respects Windows' reduced motion, reduced transparency and high contrast settings.

![Studio 3D](docs/ui/glass-default.png)

Not yet: guided workflow, holes on the sides, more shapes, print preparation.

## Getting the Windows app (no setup needed)

1. Open the repository's **Actions** tab on GitHub and click the latest green **CI** run.
2. Under **Artifacts**, download `studio-3d-windows-installer` and unzip it.
3. Run the `*-setup.exe` file. Windows SmartScreen may warn because the app isn't code-signed yet. Click **More info → Run anyway**.

## Developer setup

You need Node 22, plus Rust and the Tauri prerequisites for the desktop app. Full Windows steps are in [docs/milestone-0/setup-instructions.md](docs/milestone-0/setup-instructions.md), Part B.

```bash
npm ci
npm run dev             # interface only, in your browser at http://localhost:1420
npm run desktop:dev     # the real desktop window (needs Rust + Tauri prerequisites)
npm run desktop:build   # Windows installers in apps/desktop/src-tauri/target/release/bundle
```

## Checks

```bash
npm run typecheck   # TypeScript
npm test            # unit tests (Vitest)
npm run build && npm run test:e2e   # browser tests (Playwright, Chromium)
python3 -I scripts/verify_stl.py test-output   # independent STL check of files the tests exported (needs trimesh)
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml   # safe file write tests
npm run licenses    # fails on copyleft/unknown licences; regenerates THIRD_PARTY_NOTICES.md
```

CI runs the TypeScript, browser, STL and licence checks on Linux. On a Windows machine it runs the Rust file-write tests, builds the installers, launches the app and checks the interface loads.

## Layout

```
apps/desktop/        React interface, file platform (desktop/browser), Tauri desktop shell (src-tauri/)
packages/document/   the project document, validation rules, .s3d file format and migrations
packages/geometry/   OCCT kernel adapter, background worker, result checks, STL export
packages/viewport/   Three.js view and camera controls (display only, never changes geometry)
scripts/             licence check and notices generator
docs/                milestone reports and decisions
```

Later milestones add `features`, `history`, `io`, `validation`, `print-prep` and `integrations`, as described in [docs/milestone-0/architecture.md](docs/milestone-0/architecture.md).
