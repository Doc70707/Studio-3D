// Timings for rebuilding typical designs, stage by stage, with the real kernel. Skipped unless PERF=1, since times
// depend on the machine: `PERF=1 npx vitest run packages/geometry/src/perf.test.ts`. Results go to
// test-output/perf.json and the console.
import { beforeAll, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import {
  DEFAULT_BOX,
  PLATE_PLANE,
  newSketch,
  type Feature,
  type HoleFeature,
  type ProjectDocument,
} from "@studio3d/document";
import { buildDocument, faceOwners, tessellate, useKernel } from "./kernel";
import { clearThreadCache } from "./threads";

const require = createRequire(import.meta.url);
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const run = process.env.PERF === "1" ? it : it.skip;

beforeAll(async () => {
  if (process.env.PERF !== "1") return;
  const oc = await opencascade({ locateFile: () => require.resolve("replicad-opencascadejs/wasm") });
  useKernel(oc);
}, 60_000);

const block = { ...DEFAULT_BOX, id: "box", name: "Box", wall: 0 } as Feature;
const hole = (id: string, over: Partial<HoleFeature> = {}): HoleFeature => ({
  id,
  type: "hole",
  name: id,
  x: 0,
  y: 0,
  diameter: 5,
  depth: 0,
  ...over,
});
const doc = (...features: Feature[]): ProjectDocument => ({ units: "mm", features });
const empty: ProjectDocument = { units: "mm", features: [] };

const DESIGNS: { name: string; doc: ProjectDocument; threads?: boolean }[] = [
  { name: "open box (default)", doc: doc({ ...DEFAULT_BOX, id: "box", name: "Box" } as Feature) },
  {
    name: "block + 6 holes (pattern)",
    doc: doc(block, hole("h", { x: -20, y: -8 }), {
      id: "p",
      type: "pattern",
      name: "Pattern",
      source: "h",
      kind: "grid",
      count: 3,
      spacing: 20,
      rows: 2,
      rowSpacing: 16,
      angle: 360,
      cx: 0,
      cy: 0,
    }),
  },
  {
    name: "block + counterbored M5 holes x4",
    doc: doc(
      block,
      hole("h", {
        x: -20,
        y: -10,
        clearance: { screw: "M5", series: "medium" },
        head: { kind: "counterbore", diameter: 9.5, depth: 5 },
      }),
      {
        id: "p",
        type: "pattern",
        name: "Pattern",
        source: "h",
        kind: "grid",
        count: 2,
        spacing: 40,
        rows: 2,
        rowSpacing: 20,
        angle: 360,
        cx: 0,
        cy: 0,
      },
    ),
  },
  { name: "block + M6 thread", doc: doc(block, hole("h", { thread: "M6", fit: 0.3, diameter: 6 })), threads: true },
  {
    name: "block + 4 M5 threads (pattern)",
    doc: doc(block, hole("h", { x: -20, y: -10, thread: "M5", fit: 0.3, diameter: 5 }), {
      id: "p",
      type: "pattern",
      name: "Pattern",
      source: "h",
      kind: "grid",
      count: 2,
      spacing: 40,
      rows: 2,
      rowSpacing: 20,
      angle: 360,
      cx: 0,
      cy: 0,
    }),
    threads: true,
  },
  {
    name: "sketch bracket + fillet",
    doc: doc(
      {
        ...newSketch(
          empty,
          PLATE_PLANE,
          "plate",
          [
            {
              kind: "polygon",
              points: [
                [-30, -20],
                [30, -20],
                [30, -5],
                [0, -5],
                [0, 20],
                [-30, 20],
              ],
            },
          ],
          "add",
          8,
        ),
        id: "s",
      },
      { id: "f", type: "fillet", name: "Fillet", size: 1, edges: "all" },
    ),
  },
];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const time = <T>(fn: () => T): [T, number] => {
  const t = performance.now();
  const r = fn();
  return [r, performance.now() - t];
};

run("rebuild timings", { timeout: 600_000 }, () => {
  const rows: Record<string, number | string>[] = [];
  for (const d of DESIGNS) {
    const stages = { build: [] as number[], mesh: [] as number[], owners: [] as number[], total: [] as number[] };
    let first = 0;
    for (let i = 0; i < 6; i++) {
      if (i === 0 && d.threads) clearThreadCache();
      const [r, build] = time(() => buildDocument(d.doc, true));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const [mesh, meshTime] = time(() => tessellate(r.shape));
      const [, owners] = time(() => faceOwners(mesh, r.pieces ?? []));
      r.pieces?.forEach((p) => p.shape.delete());
      r.shape.delete();
      const total = build + meshTime + owners;
      if (i === 0) first = total;
      else {
        stages.build.push(build);
        stages.mesh.push(meshTime);
        stages.owners.push(owners);
        stages.total.push(total);
      }
    }
    rows.push({
      design: d.name,
      "first (ms)": Math.round(first),
      "build (ms)": Math.round(median(stages.build)),
      "mesh (ms)": Math.round(median(stages.mesh)),
      "face owners (ms)": Math.round(median(stages.owners)),
      "total (ms)": Math.round(median(stages.total)),
    });
  }
  console.table(rows);
  writeFileSync(`${OUT}perf.json`, JSON.stringify(rows, null, 2));
});
