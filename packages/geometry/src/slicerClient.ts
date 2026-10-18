// Interface-side handle to the slicing worker. Only the newest request matters: asking again stops the slice
// still running (the worker is replaced), so changing a setting never waits for an out-of-date slice.
import type { SlicedPart, SlicerSettings } from "./slicer";
import type { SliceRequest, SliceResponse } from "./slicer.worker";

export class SlicerClient {
  private worker: Worker | null = null;
  private busy: { id: number; reject: (e: Error) => void } | null = null;
  private nextId = 1;

  constructor(private readonly createWorker: () => Worker) {}

  /** Slices a copy of `stl`. Rejects with a "superseded" error if another slice is asked for first. */
  slice(stl: ArrayBuffer, settings: SlicerSettings): Promise<SlicedPart> {
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy.reject(new Error("superseded"));
    }
    const worker = (this.worker ??= this.createWorker());
    const id = this.nextId++;
    return new Promise<SlicedPart>((resolve, reject) => {
      this.busy = { id, reject };
      worker.onmessage = (ev: MessageEvent<SliceResponse>) => {
        if (ev.data.id !== id) return;
        this.busy = null;
        if (ev.data.ok) resolve(ev.data.part);
        else reject(new Error(ev.data.error));
      };
      worker.onerror = (ev) => {
        this.busy = null;
        this.worker = null;
        worker.terminate();
        reject(new Error(ev.message || "The slicer stopped unexpectedly."));
      };
      worker.postMessage({ id, stl: stl.slice(0), settings } satisfies SliceRequest);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
