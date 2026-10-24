/// <reference lib="webworker" />
// Slices off the interface thread, so the window stays responsive while a curved part takes seconds. Writing and
// checking G-code runs here too.
import { makeGcode, type PrintJob, type PrintJobResult } from "./printJob";
import { slicePart, type SlicedPart, type SlicerSettings } from "./slicer";

declare const self: DedicatedWorkerGlobalScope;

export type SliceRequest =
  | { id: number; kind: "slice"; stl: ArrayBuffer; settings: SlicerSettings }
  | { id: number; kind: "gcode"; part: SlicedPart; job: PrintJob };
export type SliceResponse =
  | { id: number; ok: true; result: SlicedPart | PrintJobResult }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  const req = ev.data;
  try {
    const result = req.kind === "slice" ? slicePart(req.stl, req.settings) : makeGcode(req.part, req.job);
    self.postMessage({ id: req.id, ok: true, result } satisfies SliceResponse);
  } catch (e) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies SliceResponse);
  }
};
