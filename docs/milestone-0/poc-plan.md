# Smallest proof-of-concept plan

Goal: get from "the kernel works in a script" to **a Windows app where you type box dimensions, see the real model, save it, reopen it, and export a verified STL**. That covers Milestones 1 and 2 of your build plan, done as small steps that are each tested.

## Step 1: running application (Milestone 1)

Files:

- npm workspace skeleton (`apps/desktop`, `packages/ui`, `packages/viewport`, `packages/geometry`, `packages/document`)
- `.github/workflows/ci.yml`
- `README.md`, `THIRD_PARTY_NOTICES` generator

Approach:

- Tauri 2 + React + Vite shell, with a Three.js viewport showing a grid and axes.
- Orbit, pan and zoom controls, plus Top, Front, Right and Iso views.
- CI on Linux and Windows: install, typecheck, test, build the Windows installer, and upload it as a download.
- License scanner in CI.

Acceptance:

1. The CI Windows build produces an installer.
2. You install it and the app opens.
3. The viewport renders and the camera controls work.
4. A clean rebuild from the lockfile gives the same result.
5. The setup steps in the docs match reality.

## Step 2: real geometry in the app (Milestone 2)

Files: `packages/geometry` (kernel adapter, OCCT worker, validation guards), `packages/document` (schema v1 + migration scaffold), `packages/persistence`, `packages/io` (STL).

Approach:

1. Port the Milestone 0 smoke test into Vitest.
2. Add a simple panel with width, depth, height and wall.
3. Rebuild in the worker; Three.js only displays the result.
4. Add Save / Open / Save As with atomic writes, and STL export.

Acceptance:

1. Changing a dimension changes the real geometry, checked by exact volume and bounds tests.
2. Invalid values show a plain message, and the last valid model stays.
3. Save → close → reopen gives identical geometry and parameters.
4. The exported STL passes the independent check in CI (trimesh: watertight, exact extents, volume within 0.5%).
5. You open the STL in your slicer (or FreeCAD) and confirm it looks right. This is the human check.

## Explicitly not in this proof of concept

- Guided Mode, which is Milestone 3.
- Undo/redo beyond the scaffold.
- Fillets, sketches and import.
- Print preparation.
- The browser build. It is only smoke-tested in CI, never shipped.
