/** Starts the geometry worker. Bundlers (Vite) pick up the worker file from this URL. */
export function createGeometryWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "geometry" });
}
