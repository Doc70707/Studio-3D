# Browser support strategy

**Short version: the browser version gets the same geometry as desktop, because the kernel is WebAssembly in both. Only file access and app packaging differ.** We still build Windows desktop first, as your plan says.

## What runs where

| Capability | Windows desktop (Tauri + WebView2) | Browser | Notes |
|---|---|---|---|
| Exact modeling (box, shell, booleans, fillets, sketch/extrude) | OCCT WASM in a worker | **Same file**, same worker | Proven in Node; desktop and browser both run Chromium-class WASM. Browser proof is a Milestone 1 CI test (Playwright). |
| Mesh validation, imported-STL booleans | Manifold WASM | Same | Proven in Node |
| STL / 3MF / STEP export | Generated in worker | Same, saved as a download | — |
| Save / open projects | Native dialogs, atomic writes, `.bak`, crash recovery | File System Access API (Chrome/Edge) or upload/download; recovery snapshots in IndexedDB | Firefox/Safari lack FS Access, so they get download-based save |
| Send to slicer | Launch installed slicer with file | Not possible; download the file instead | The browser must not show this button |
| Multi-threaded kernel | Possible | Needs cross-origin isolation headers on our web host | Start single-threaded everywhere |
| Big models | WASM 4 GB memory cap | Same, plus browser tab limits | Printable parts are far below this |

## Options considered for the browser

1. **WASM in the browser (chosen).** No server costs, works offline, private by default. Cost: a 7 MB compressed download on first visit, then cached.
2. **Geometry server.** The browser sends parameters and a server computes geometry. It adds hosting cost and latency, needs internet, and uploads users' models, which needs consent and a privacy policy. Keep it only as a later option for very heavy operations.
3. **Mesh-only browser version.** Simpler, but it can't offer exact dimensions, fillets or STEP, so it would be a different product. Rejected.

## Rules that keep us honest

- Platform features (dialogs, slicer launch, recovery) sit behind a `platform` interface with a desktop and a browser implementation. The UI asks the platform what it supports before showing a control, so the browser never displays a feature it can't do.
- Every geometry test runs in Node (CI), with a smoke subset in a real headless browser.
