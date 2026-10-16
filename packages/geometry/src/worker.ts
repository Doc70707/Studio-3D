/// <reference lib="webworker" />
// Runs the geometry kernel off the interface thread so typing and orbiting never freeze.
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import type { Shape3D } from "replicad";
import { buildDocument, exportStl, tessellate, useKernel } from "./kernel";
import type { Request, Response } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let lastGood: Shape3D | null = null;

const post = (msg: Response, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

const ready = opencascade({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} }).then(
  (oc) => {
    useKernel(oc);
    post({ id: 0, kind: "ready" });
  },
  (e: unknown) => post({ id: 0, kind: "fatal", error: `The geometry engine failed to start: ${String(e)}` }),
);

self.onmessage = async (ev: MessageEvent<Request>) => {
  await ready;
  const req = ev.data;
  if (req.kind === "rebuild") {
    const r = buildDocument(req.document);
    if (!r.ok) return post({ id: req.id, kind: "rebuilt", ok: false, issues: r.issues });
    lastGood?.delete();
    lastGood = r.shape;
    const mesh = tessellate(r.shape);
    post({ id: req.id, kind: "rebuilt", ok: true, mesh, measurements: r.measurements, issues: r.issues }, [
      mesh.positions.buffer,
      mesh.normals.buffer,
      mesh.indices.buffer,
      mesh.edges.buffer,
      mesh.faces.buffer,
    ]);
  } else if (req.kind === "exportStl") {
    if (!lastGood) return post({ id: req.id, kind: "stl", ok: false, error: "There's no valid model to export yet." });
    try {
      const data = await exportStl(lastGood);
      post({ id: req.id, kind: "stl", ok: true, data }, [data]);
    } catch (e) {
      post({ id: req.id, kind: "stl", ok: false, error: `Export failed: ${String(e)}` });
    }
  }
};
