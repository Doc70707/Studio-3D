# Geometry kernel comparison

A "geometry kernel" is the engine that actually computes solids: boxes, holes, fillets, and exports. Everything the app promises depends on it.

## What we need from a kernel

- Exact solid modeling (B-rep), so dimensions are true values, not mesh approximations.
- Booleans, shelling, fillets and chamfers, sketch-to-extrude.
- STL/3MF output for printing, and STEP so users can move to other CAD tools.
- Runs on Windows desktop now and in a browser later.
- A license we can ship in a paid, closed-source product.
- Healthy maintenance.

## Candidates

| Kernel | Type | License | Fillets / shell / STEP | Desktop + browser | Maturity | Verdict |
|---|---|---|---|---|---|---|
| **OCCT 8.0 via WebAssembly** (`replicad-opencascadejs` 1.1.0 + `replicad` 1.1.0) | Exact B-rep | OCCT: LGPL-2.1 + Open CASCADE exception. replicad: MIT | Yes / yes / yes | **Same file runs in both** | OCCT: decades old, used by FreeCAD and KiCad. 8.0.1 released 2026-07-30. replicad is mostly one maintainer | **Recommended primary kernel. Smoke test passed 11/11.** |
| OCCT native (C++, called from Rust/Tauri) | Exact B-rep | Same as above | Yes / yes / yes | Desktop only; browser would need the WASM build anyway | Mature kernel. Rust bindings (e.g. `opencascade-rs`) are young | Faster, but two code paths and a hard Windows C++ build. Keep as a later escape hatch. |
| **Manifold** (`manifold-3d` 3.5.4) | Robust triangle-mesh booleans | Apache-2.0 | No exact fillets / limited / no STEP | Both (WASM) | Very active; used in OpenSCAD and Blender | **Recommended secondary engine** for imported meshes and mesh checks. Tested on our STL: correct. |
| CGAL | Exact mesh and polyhedra | GPL or paid commercial license | Partial | Desktop; WASM is hard | Mature | Rejected: GPL or a paid license, and a heavy build. |
| truck (Rust) | B-rep | Apache-2.0 / MIT | Limited | Both (Rust→WASM) | Early-stage | Rejected for now: too immature for dependable geometry. Worth watching. |
| JSCAD | Mesh CSG | MIT | No / no / no | Both | Stable, but basic | Rejected: no exact geometry, fillets or STEP. |
| Parasolid, ACIS, C3D | Exact B-rep (industry grade) | Commercial, typically five to six figures per year plus royalties | Yes | Desktop; browser via a server | Best in class | Rejected at this stage on cost. Revisit only if the business outgrows OCCT. |

## Recommendation

**OCCT 8.0 compiled to WebAssembly is the source of truth for editable parts. Manifold handles imported meshes and print checks.**

Why WebAssembly instead of native OCCT on a Windows desktop:

1. **One geometry code path** for desktop and the future browser version, so the browser can never advertise features the desktop has and it lacks.
2. **Testable anywhere.** The exact same kernel runs in Node on Linux CI, which is how I ran the smoke test. Geometry tests don't need a Windows machine.
3. **Simpler setup for you.** No C++ build of OCCT on Windows, which is notoriously fiddly.
4. **A cleaner license position.** The LGPL component is a separate `.wasm` file the user can replace. See the licensing notes.

What it costs (inferred, not measured yet):

- Probably slower than native for large models (often 1.5–3× for WASM vs native C++). Our box rebuilt in about 100 ms, so this is fine for MVP parts.
- WebAssembly memory is capped (4 GB for 32-bit WASM). That is fine for printable parts, but a limit for huge imported assemblies.
- The single-threaded build is the simple one. A multi-threaded build exists but needs special browser headers.
- The kernel download is 22 MB (7.2 MB gzipped). That is irrelevant on desktop and acceptable on the web with caching.

## How we stay safe if a choice goes wrong

All geometry goes through our own **kernel adapter interface** (`createBox`, `shell`, `cut`, `export`, and so on). The UI and document never touch replicad or OCCT directly. If replicad stalls we can fork it (MIT), call `opencascade.js`-style bindings directly, or move heavy operations to a native OCCT process, all without rewriting the app.
