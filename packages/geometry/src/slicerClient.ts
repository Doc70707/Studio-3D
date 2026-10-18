// Interface-side handle to the slicing worker. Only the newest request matters: asking again stops the one still
// running (the worker is replaced), so changing a setting never waits for an out-of-date slice.
import type { PrintJob, PrintJobResult } from "./printJob";
import type { SlicedPart, SlicerSettings } from "./slicer";
import type { SliceRequest, SliceResponse } from "./slicer.worker";

type Request = SliceRequest extends infer R ? (R extends SliceRequest ? Omit<R, "id"> : never) : never;

export class SlicerClient {
  private worker: Worker | null = null;
  private busy: { id: number; reject: (e: Error) => void } | null = null;
  private nextId = 1;

  constructor(private readonly createWorker: () => Worker) {}

  /** Slices a copy of `stl`. Rejects with a "superseded" error if something else is asked for first. */
  slice(stl: ArrayBuffer, settings: SlicerSettings): Promise<SlicedPart> {
    return this.request({ kind: "slice", stl: stl.slice(0), settings }) as Promise<SlicedPart>;
  }

  /** Writes the sliced part as G-code for a printer and reads it back to check it. */
  gcode(part: SlicedPart, job: PrintJob): Promise<PrintJobResult> {
    return this.request({ kind: "gcode", part, job }) as Promise<PrintJobResult>;
  }

  private request(message: Request): Promise<SlicedPart | PrintJobResult> {
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy.reject(new Error("superseded"));
    }
    const worker = (this.worker ??= this.createWorker());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.busy = { id, reject };
      worker.onmessage = (ev: MessageEvent<SliceResponse>) => {
        if (ev.data.id !== id) return;
        this.busy = null;
        if (ev.data.ok) resolve(ev.data.result);
        else reject(new Error(ev.data.error));
      };
      worker.onerror = (ev) => {
        this.busy = null;
        this.worker = null;
        worker.terminate();
        reject(new Error(ev.message || "The slicer stopped unexpectedly."));
      };
      worker.postMessage({ ...message, id } as SliceRequest);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
