# Dependency and licensing report

*Engineer's reading, not legal advice. Items marked ⚠ need a lawyer before any paid distribution.*

Versions are the latest on npm/PyPI as checked on 2026-10-15. Exact versions get pinned in a lockfile at Milestone 1.

## Dependency register (planned for the shipped app)

| Package | Version | Repository | License | Use | Obligations | Concern |
|---|---|---|---|---|---|---|
| replicad-opencascadejs (contains **OCCT 8.0**, confirmed from version strings inside the `.wasm`) | 1.1.0 | github.com/sgenoud/replicad | **LGPL-2.1-only** (+ Open CASCADE exception 1.0) | Geometry kernel | Notice, license text, provide OCCT source and our build scripts, allow user to replace/relink | ⚠ See below |
| replicad | 1.1.0 | github.com/sgenoud/replicad | MIT | Friendly API over OCCT | Keep copyright notice | Single-maintainer risk |
| manifold-3d | 3.5.4 | github.com/elalish/manifold | Apache-2.0 | Mesh validation and booleans | Notice + license; NOTICE file if present | None |
| three | 0.186.1 | github.com/mrdoob/three.js | MIT | Viewport | Notice | None |
| react / react-dom | 19.3.1 | github.com/facebook/react | MIT | Interface | Notice | None |
| zustand | 5.0.15 | github.com/pmndrs/zustand | MIT | App state | Notice | None |
| fflate | 0.8.3 | github.com/101arrowz/fflate | MIT | Project-file zip, 3MF | Notice | Chosen over jszip, which is dual MIT/GPL-3 |
| @tauri-apps/api, Tauri runtime | 2.12.x | github.com/tauri-apps/tauri | Apache-2.0 OR MIT | Desktop shell | Notice | Rust crates pulled in by Tauri must be audited with `cargo-about` (most are MIT/Apache) |
| Microsoft Edge WebView2 | system | Microsoft | Microsoft runtime terms | Renders the UI on Windows | Redistribution allowed via the official bootstrapper | None expected |

**Development and test only (not shipped):** TypeScript 7.0.2 (Apache-2.0), Vite 8.3.4 (MIT), Vitest 5.0.5 (MIT), `trimesh` (MIT), `numpy-stl` (BSD-3-Clause), `cadquery-ocp` 8.0.1 (LGPL, used only to re-read STEP in tests). Tools we don't distribute create no distribution obligations.

## OCCT: what the license actually says

I read the exception text in the OCCT repository (`OCCT_LGPL_EXCEPTION.txt`). It lets object code that **incorporates material from OCCT header files** be distributed under our own terms, provided we give "prominent notice in supporting documentation" that we use OCCT. It does **not** remove the normal LGPL-2.1 duties for the OCCT library itself. Under LGPL-2.1 section 6 we must:

- State prominently that the app uses OCCT, and include the LGPL text and OCCT's copyright notices.
- Let users modify OCCT and use their modified version with our app. In practice: ship the kernel as its **own separate `.wasm` file** that the app loads at runtime and the user could swap. Do not bundle it into one combined file.
- Provide the complete OCCT source and the exact scripts used to build the `.wasm`, or a written offer valid for 3 years.
- Not forbid reverse engineering for debugging modifications to the library in our end-user license.

My reading: a paid, closed-source app is compatible with this, as FreeCAD-adjacent commercial tools have shown. But the `.wasm` build merges OCCT with replicad's binding glue, and WASM linking isn't what the 1999 license authors imagined. ⚠ **Have a software-licensing lawyer confirm the "separate replaceable .wasm + source offer" approach before selling.** The project can keep developing in the meantime.

**I could not read OCCT's official licensing web page.** It now redirects to occt3d.com. I found no license change mentioned in the 8.0 release notes I read, but that is only what I saw. ⚠ Re-confirm when a release is chosen.

## Things we will not do

- Copy code from FreeCAD (LGPL-2.1+), PrusaSlicer, OrcaSlicer or Bambu Studio (AGPL-3.0), Cura (LGPL-3.0), or OpenSCAD (GPL-2.0).
- Link or bundle any slicer. "Send to slicer" only **launches a slicer the user installed themselves** with our exported file, the same as double-clicking it. We distribute none of their code. Your plan rightly says a separate process doesn't automatically avoid copyleft. Here, though, nothing of theirs ships with our app at all.
- Use any AGPL dependency in the app or in any future cloud service.

## Process from Milestone 1 onward

- `npm` and `cargo` licence scanners run in CI and fail the build if a GPL or AGPL licence appears.
- `THIRD_PARTY_NOTICES.txt` is generated on every build and shown in Help → About.
- A CycloneDX SBOM (software bill of materials) is produced for each release.
