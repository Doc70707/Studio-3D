/** Starts the geometry worker. Bundlers (Vite) pick up the worker file from this URL. */
export function createGeometryWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "geometry" });
}

/** Starts a slicing worker. */
export function createSlicerWorker(): Worker {
  return new Worker(new URL("./slicer.worker.ts", import.meta.url), { type: "module", name: "slicer" });
}
