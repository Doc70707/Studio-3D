# Risk register

Likelihood and impact: L = low, M = medium, H = high.

| # | Risk | Likelihood | Impact | Mitigation | Owner / when |
|---|---|---|---|---|---|
| 1 | **Kernel silently returns a wrong result** (observed: wall thicker than the box returned an un-hollowed solid, no error) | H (seen) | H | Input validation per feature, result checks (volume, bounds, BRepCheck), keep last valid model, a geometry test for every feature | Built into Milestone 2 onward |
| 2 | replicad is mostly a single maintainer | M | M | Our own kernel adapter; MIT means we can fork; record the OCCT WASM build recipe | Milestone 1 |
| 3 | LGPL obligations for OCCT misunderstood | M | H | Separate replaceable `.wasm`, notices, source offer; **lawyer review before any paid release** | You, before Milestone 6 (alpha) or any sale |
| 4 | Windows behaviour differs from my Linux tests (WebView2, file paths, permissions) | M | M | GitHub Actions Windows runner builds the installer and runs smoke tests on every change; you install it on your own PC at Milestone 1 | Milestone 1 |
| 5 | Fillets and chamfers fail on some edges (a known OCCT weak spot) | H | M | Offer fillets only on simple edge sets at first; failures revert with a clear message; collect failing cases as regression tests | Milestone 4 |
| 6 | Constraint sketching is a large, hard feature | H | M | Guided Mode doesn't need it. Start with dimensioned rectangles and circles, then add a constraint solver later (evaluate MIT/Apache solvers; avoid GPL ones like SolveSpace's) | After Milestone 4 |
| 7 | WASM performance too slow for larger models | M | M | Worker plus cancellation keeps the UI smooth; measure from Milestone 2; escape hatch is a native OCCT sidecar for heavy ops | Measure from Milestone 2 |
| 8 | Imported STL files are malformed or hostile | H | M | Size limits, defensive parsing in the worker, Manifold validation, never execute file content | Milestone 5 |
| 9 | Project-file corruption or data loss | L | H | Atomic writes, `.bak`, autosave snapshots, versioned format with migrations, corrupted-file tests | Milestone 2–3 |
| 10 | Unsigned Windows installer triggers SmartScreen warnings for testers | H | M | Code-signing certificate before a public release (roughly $100–$400 per year; Azure Trusted Signing is often cheapest). Testers can click through for the private alpha | You, before Milestone 6 |
| 11 | Scope creep (slicing, AI, cloud) before the core is dependable | M | H | Milestone gates exactly as in your plan; "unavailable" labels instead of fake buttons | Ongoing |
| 12 | You are new to software development and get blocked on setup | M | M | CI builds the app for you; setup steps are numbered and short; I do the coding | Ongoing |
| 13 | No repository yet, so code would live only in a temporary container | H (now) | H | Connect GitHub and create a repo before Milestone 1 | **You, now** |
| 14 | Very new toolchain versions (TypeScript 7.0, Vite 8) have rough edges | M | L | Pin exact versions; drop back one major version if anything breaks | Milestone 1 |
