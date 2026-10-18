/// <reference lib="webworker" />
// Slices off the interface thread, so the window stays responsive while a curved part takes seconds.
import { slicePart, type SlicedPart, type SlicerSettings } from "./slicer";

declare const self: DedicatedWorkerGlobalScope;

export type SliceRequest = { id: number; stl: ArrayBuffer; settings: SlicerSettings };
export type SliceResponse = { id: number; ok: true; part: SlicedPart } | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  const { id, stl, settings } = ev.data;
  try {
    self.postMessage({ id, ok: true, part: slicePart(stl, settings) } satisfies SliceResponse);
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies SliceResponse);
  }
};
