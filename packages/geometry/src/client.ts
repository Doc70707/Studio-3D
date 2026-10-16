// Interface-side handle to the geometry worker.
// - Only the newest rebuild is delivered; older in-flight results are dropped.
// - If the worker dies, it is restarted, and the caller rebuilds from the document (no work lost).
import type { Issue, ProjectDocument } from "@studio3d/document";
import type { Measurements, MeshData, Request, Response } from "./protocol";

export type RebuildOutcome =
  | {
      status: "built";
      mesh: MeshData;
      measurements: Measurements;
      issues: Issue[];
    }
  | { status: "rejected"; issues: Issue[] }
  | { status: "superseded" };

type Pending = { resolve: (r: Response) => void; reject: (e: Error) => void };

export class GeometryClient {
  private worker!: Worker;
  private nextId = 1;
  private latestRebuild = 0;
  private pending = new Map<number, Pending>();
  private readyPromise!: Promise<void>;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly onCrash: (message: string) => void = () => {},
  ) {
    this.start();
  }

  /** Resolves when the kernel has loaded. Rejects if it can't start at all. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  async rebuild(document: ProjectDocument): Promise<RebuildOutcome> {
    const id = this.nextId++;
    this.latestRebuild = id;
    const res = await this.send({ id, kind: "rebuild", document });
    if (id !== this.latestRebuild) return { status: "superseded" };
    if (res.kind !== "rebuilt")
      throw new Error("Unexpected reply from the geometry engine.");
    return res.ok
      ? {
          status: "built",
          mesh: res.mesh,
          measurements: res.measurements,
          issues: res.issues,
        }
      : { status: "rejected", issues: res.issues };
  }

  /** Binary STL of the last valid model. */
  async exportStl(): Promise<ArrayBuffer> {
    const res = await this.send({ id: this.nextId++, kind: "exportStl" });
    if (res.kind !== "stl")
      throw new Error("Unexpected reply from the geometry engine.");
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  dispose(): void {
    this.worker.terminate();
    this.failAll("The geometry engine was shut down.");
  }

  private start(): void {
    this.worker = this.createWorker();
    let resolveReady!: () => void;
    let rejectReady!: (e: Error) => void;
    this.readyPromise = new Promise(
      (res, rej) => ((resolveReady = res), (rejectReady = rej)),
    );
    this.readyPromise.catch(() => {}); // callers who don't await ready() shouldn't see an unhandled rejection

    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const msg = ev.data;
      if (msg.kind === "ready") return resolveReady();
      if (msg.kind === "fatal") {
        rejectReady(new Error(msg.error));
        return this.failAll(msg.error);
      }
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      p?.resolve(msg);
    };
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      const message =
        "The geometry engine stopped unexpectedly. It has been restarted and your design is safe.";
      this.worker.terminate();
      this.failAll(message);
      this.start();
      this.onCrash(message);
    };
  }

  private send(req: Request): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.worker.postMessage(req);
    });
  }

  private failAll(message: string): void {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }
}
