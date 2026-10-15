# Milestone 2: real geometry proof

Goal: a dimensioned box built by the chosen geometry kernel, which can be saved, reopened and exported, with the export verified independently.

## Acceptance criteria and evidence

| Criterion | Evidence |
|---|---|
| Dimensions change the real geometry | `packages/geometry/src/kernel.test.ts`: exact volume and size for 7 boxes, 1 mm to 1000 mm, solid and hollow, against hand-calculated formulas (relative error < 1e-9). `e2e/box.spec.ts`: typing a new width updates the measured volume in the app. |
| Invalid values are explained; the last valid model is kept | `packages/document/src/document.test.ts` (7 rejection cases with plain messages). `e2e/box.spec.ts` "invalid values…". Kernel results are also checked after every build, because OCCT silently returns a solid block for over-thick walls (found in Milestone 0). |
| Save and reopen | Document round-trip tests, plus a kernel test that a reopened file rebuilds to identical measurements, plus an end-to-end save → new → open test in the app. Damaged files and files from newer versions are refused with an explanation and the current design is left untouched. Unknown data from newer versions is kept on save. |
| Safe saving (desktop) | `apps/desktop/src-tauri/src/files.rs`: temp file + flush + rename, previous version kept as `.bak`; tests run on Windows in CI, including "a failed write leaves the original untouched". |
| A mesh can be exported | Export STL button (desktop: save dialog; browser: download). |
| Export verified independently | Our own STL checker (watertight edges, winding, size, volume) and, separately, `scripts/verify_stl.py` using trimesh, on STL files written by both the kernel tests and the real app's Export button. |

## Decisions

- **Project file:** `.s3d`, versioned JSON (format version 1). The zip container described in Milestone 0 arrives when projects need to hold imported meshes; the migration hook is in place.
- **Geometry in a worker:** the UI never freezes; only the newest rebuild is applied; if the worker crashes it restarts and the design is rebuilt from the document.
- **OCCT licence:** the kernel ships as its own `.wasm` file (visible in the build output), and `THIRD_PARTY_NOTICES.md` carries the OCCT notice and source offer. The licence check fails on any new copyleft dependency unless a person has reviewed it.

## Not done here (by plan)

Guided workflow (Milestone 3), undo/redo and more shapes (Milestone 4), print preparation (Milestone 5), 3MF/STEP export.

## Needs a human check

Open an exported STL in your slicer (PrusaSlicer, Cura, Bambu Studio, OrcaSlicer…) and confirm it looks right and measures correctly. Also try Save / Open in the Windows app; the native dialogs aren't covered by automated tests.
