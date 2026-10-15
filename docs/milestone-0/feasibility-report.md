# Feasibility report (Milestone 0)

Date: 2026-10-15. Status: **feasible, with one decision and one setup step needed from you** (see [README](README.md)).

## What I inspected

| Item | Finding |
|---|---|
| Project repository | None exists. GitHub is not connected to this project, so there is no code to preserve. I treated the project as empty. |
| Project files | Empty before this milestone. |
| Build environment (mine) | Linux cloud container: 4 CPUs, 15 GB RAM, Node 22.22, npm 10.9, Python 3.13, internet access to npm and PyPI. |
| Windows environment | **Not available to me.** I cannot run or package anything on Windows from here. The plan below uses GitHub Actions' hosted Windows machines to build and test the Windows app, so Windows proof happens automatically on every change. |

## The geometry-kernel feasibility gate

Your plan says to prove eight things before committing to a kernel. I ran a real smoke test using **Open CASCADE Technology (OCCT) 8.0**, compiled to WebAssembly (the `replicad-opencascadejs` 1.1.0 build), driven from Node. The script, outputs and run log are in [`poc/`](poc/) and [`poc/out/poc-run.txt`](poc/out/poc-run.txt).

| Gate item | Result | Evidence |
|---|---|---|
| Create a solid box with exact dimensions | **Passed** | 60×40×30 mm box: volume exactly 72000 mm³, bounds exactly 60×40×30. |
| Change one dimension and rebuild | **Passed** | Open box with 2 mm walls and an 8 mm hole; width 60→80 rebuilt to 19190.9381 mm³, matching the hand-calculated value to 4 decimal places. |
| Perform a real geometry modification | **Passed** | Two real operations: hollowing (OCCT thick-solid "shell", open top) and boolean subtraction of a cylinder. Volumes match analytic formulas. Not a visual trick. |
| Save and reopen | **Passed** | Saved a JSON parameter document plus an exact B-rep file; both reopened to identical volume. |
| Export a valid mesh | **Passed** | Binary STL, 1044 triangles. STEP (AP242) also exported. |
| Verify in an independent application | **Passed** | STL checked with `trimesh` and `numpy-stl` (independent Python libraries): watertight, consistent winding, extents exactly 80×40×30, volume within 0.001% of exact, genus 2 (the two hole openings). STEP re-read by a separate native OCCT 8.0.1 build (`cadquery-ocp`): valid solid, identical volume. *Caveat: the STEP reader is the same kernel family, so it is not fully independent. Milestone 2 adds a check in FreeCAD or a slicer by hand.* |
| Run in the intended Windows environment | **Not yet proven** | Not possible from this container. WebAssembly is platform-neutral, so the same file runs in Windows' WebView2 (Chromium-based). That is a strong expectation, not proof. Milestone 1's Windows CI build closes this item. |
| Document browser requirements | **Done** | See [browser-strategy.md](browser-strategy.md). With this approach the browser uses the exact same kernel file. |

Speed on this machine: kernel startup 210–290 ms, full rebuild of the box with hole 77–113 ms. That is fast enough for live preview while typing dimensions.

### An important finding: the kernel can be silently wrong

With a wall thickness of 50 mm on a 40 mm deep box, OCCT **did not report an error**. It quietly returned the un-hollowed solid. This confirms your instruction to "preserve the last valid model" is essential, and that it can't rely on the kernel throwing errors. The architecture therefore has a **validation layer around every feature**:

1. Check inputs first, with plain-language messages ("Walls of 50 mm would fill the whole box. Use less than 20 mm.").
2. After building, check the result did what the feature promised (volume, bounds, validity).
3. If either check fails, keep the last valid model and explain why.

The smoke test includes this guard, and it passes.

### Mesh tools for imported files

`manifold-3d` 3.5.4 (Apache-2.0) loaded the exported STL, confirmed it was a valid manifold (genus 2, matching volume), and performed a mesh boolean on it correctly. That makes it the right tool for checking and editing **imported** triangle meshes, which OCCT handles poorly. See [kernel-comparison.md](kernel-comparison.md).

## Overall verdict

- **Technically feasible.** The hardest risk in this kind of project is the geometry kernel, and it worked in an afternoon with exact, verifiable results.
- **Commercially feasible, with a legal check.** OCCT is LGPL-2.1 with a header exception. A closed-source app can use it if the kernel stays a separate, replaceable file and you meet the notice and source obligations. Get a lawyer to confirm before selling anything. Details: [licensing-and-dependencies.md](licensing-and-dependencies.md).
- **Biggest practical risk:** the friendly wrapper library (`replicad`) is largely one person's project. We contain it behind our own adapter, and it is MIT-licensed, so we can fork it if needed. Full list: [risk-register.md](risk-register.md).

## What I did not do

- I did not create the application or install any app dependencies. That waits for the architecture to be confirmed, as your plan asks.
- I did not test on Windows, test a full STEP import, or measure performance on large models.
- I have not had a lawyer review anything. The licensing notes are an engineer's reading, not legal advice.
