# Milestone 0: audit and feasibility

**Result: the project is feasible.** I ran a real geometry-kernel test, and it passed 11 of 11 checks. The exported STL and STEP files were verified by separate tools. One proof item, running on Windows, is still open and is covered by Milestone 1.

## Read in this order

1. [feasibility-report.md](feasibility-report.md): what I tested and what it proved
2. [architecture.md](architecture.md): the recommended design, in plain language
3. [kernel-comparison.md](kernel-comparison.md): why OCCT (WebAssembly) plus Manifold
4. [licensing-and-dependencies.md](licensing-and-dependencies.md): dependency register and OCCT licence notes
5. [browser-strategy.md](browser-strategy.md)
6. [risk-register.md](risk-register.md)
7. [setup-instructions.md](setup-instructions.md): **Part A is what you need to do**
8. [poc-plan.md](poc-plan.md): the next two milestones, step by step
9. [poc/](poc/): the smoke-test code, outputs and run log

## Decisions that need you

| Decision | My recommendation | Why it's yours |
|---|---|---|
| Geometry kernel | OCCT 8.0 as WebAssembly (LGPL-2.1 + exception), with Manifold for meshes | Licensing and product direction |
| Desktop shell | Tauri 2 (Electron as fallback) | Platform support |
| Legal review of the OCCT licence before selling | Yes, before the private alpha or any sale | Cost and licensing |

## Setup step that blocks Milestone 1

There is no code repository yet, and GitHub isn't connected. Without a repository, code would live only in a temporary container. See setup-instructions.md, Part A.
