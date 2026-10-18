// Studio 3D's own slicer, step one: cutting the part into layers. Written for Studio 3D from first principles (a plane
// cuts each triangle in a line; the lines join into closed loops); no other slicer's code is used.
//
// The input is the exact binary STL that Print Studio checked, so what is sliced is what would be exported.

export interface SliceOptions {
  /** Height of every layer, mm. */
  layerHeight: number;
  /** Height of the first layer, mm (often thicker, to stick to the plate). Defaults to `layerHeight`. */
  firstLayerHeight?: number;
}

/** One closed outline: x, y pairs in order. Counter-clockwise (seen from above) for an outside edge, clockwise for a hole. */
export type Loop = Float64Array;

export interface Layer {
  /** Bottom and top of the layer, mm above the plate. */
  bottom: number;
  top: number;
  /** Where the part was cut: the middle of the layer. */
  z: number;
  loops: Loop[];
  /** Material area of the cut, mm² (outsides minus holes). */
  area: number;
}

export interface SliceResult {
  layers: Layer[];
  /** Cut lines that didn't join into closed loops: the surface has a gap at that height. 0 for a good part. */
  openEnds: number;
}

/** Signed area of a loop (shoelace formula): positive when counter-clockwise. */
export function loopArea(loop: Loop): number {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += loop[2 * j]! * loop[2 * i + 1]! - loop[2 * i]! * loop[2 * j + 1]!;
  return a / 2;
}

/** Each layer's bottom and top, from the part's lowest point to its highest. */
export function layerBounds(minZ: number, maxZ: number, options: SliceOptions): { bottom: number; top: number }[] {
  const h = options.layerHeight;
  const first = options.firstLayerHeight ?? h;
  if (!(h > 0) || !(first > 0)) throw new Error("The layer height must be more than 0 mm.");
  const out: { bottom: number; top: number }[] = [];
  let bottom = minZ;
  let top = minZ + first;
  // A last layer thinner than a hundredth of a layer would be rounding noise, not material.
  while (bottom < maxZ - h * 0.01) {
    out.push({ bottom, top: Math.min(top, maxZ) }); // the last layer ends at the top of the part
    bottom = top;
    top = minZ + first + out.length * h;
  }
  return out;
}

/** Cuts a binary STL into layers. */
export function sliceStl(stl: ArrayBuffer, options: SliceOptions): SliceResult {
  const view = new DataView(stl);
  const n = view.getUint32(80, true);
  const tri = new Float64Array(n * 9);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 9; k++) {
      const v = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
      tri[t * 9 + k] = v;
      if (k % 3 === 2) {
        minZ = Math.min(minZ, v);
        maxZ = Math.max(maxZ, v);
      }
    }
  if (n === 0) return { layers: [], openEnds: 0 };

  const bounds = layerBounds(minZ, maxZ, options);
  const cuts = bounds.map(() => [] as number[]); // per layer: x1 y1 x2 y2 per cut line
  const zs = bounds.map((b) => (b.bottom + b.top) / 2);
  // Parts are drawn in round millimetres, so a layer's middle often falls exactly on a flat face (the top of a floor).
  // Cutting a hundred-thousandth of a millimetre higher, far below what a printer can show, takes the material just
  // above that face, rather than leaving it to chance.
  const cutZs = zs.map((z) => z + 1e-5);
  const first = options.firstLayerHeight ?? options.layerHeight;
  const h = options.layerHeight;
  // The layer whose middle is the first one at or above z.
  const layerAtOrAbove = (z: number) => {
    if (z <= cutZs[0]!) return 0;
    return Math.max(1, Math.ceil((z - (minZ + first) - h / 2 - 1e-5) / h) + 1);
  };

  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const z0 = tri[o + 2]!;
    const z1 = tri[o + 5]!;
    const z2 = tri[o + 8]!;
    const lo = Math.min(z0, z1, z2);
    const hi = Math.max(z0, z1, z2);
    // The triangle's facing, from its corners (the order sets which side is outside).
    const ux = tri[o + 3]! - tri[o]!;
    const uy = tri[o + 4]! - tri[o + 1]!;
    const uz = z1 - z0;
    const vx = tri[o + 6]! - tri[o]!;
    const vy = tri[o + 7]! - tri[o + 1]!;
    const vz = z2 - z0;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    for (let l = layerAtOrAbove(lo); l < cutZs.length && cutZs[l]! < hi; l++) {
      const z = cutZs[l]!;
      // A corner exactly at the cut counts as above it, so every edge is cut at most once and neighbours agree.
      const pts: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = o + e * 3;
        const b = o + ((e + 1) % 3) * 3;
        const za = tri[a + 2]!;
        const zb = tri[b + 2]!;
        if (za < z !== zb < z) {
          // Interpolate from the lower corner, so the two triangles sharing this edge get the very same point.
          const [p, q] = za < zb ? [a, b] : [b, a];
          const s = (z - tri[p + 2]!) / (tri[q + 2]! - tri[p + 2]!);
          pts.push(tri[p]! + s * (tri[q]! - tri[p]!), tri[p + 1]! + s * (tri[q + 1]! - tri[p + 1]!));
        }
      }
      if (pts.length !== 4) continue;
      let [x1, y1, x2, y2] = pts as [number, number, number, number];
      if (x1 === x2 && y1 === y2) continue; // touches the cut at one corner only
      // Walk with the outside on the right, so outsides come out counter-clockwise and holes clockwise.
      if ((y2 - y1) * nx - (x2 - x1) * ny < 0) [x1, y1, x2, y2] = [x2, y2, x1, y1];
      cuts[l]!.push(x1, y1, x2, y2);
    }
  }

  let openEnds = 0;
  const layers = bounds.map((b, l) => {
    const { loops, open } = joinLoops(cuts[l]!);
    openEnds += open;
    const area = loops.reduce((s, loop) => s + loopArea(loop), 0);
    return { ...b, z: zs[l]!, loops, area };
  });
  return { layers, openEnds };
}

const key = (x: number, y: number) => `${x},${y}`;

/** Joins cut lines end to start into closed loops. Lines left over mean the surface has a gap. */
function joinLoops(lines: number[]): { loops: Loop[]; open: number } {
  const count = lines.length / 4;
  const byStart = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const k = key(lines[4 * i]!, lines[4 * i + 1]!);
    const list = byStart.get(k);
    if (list) list.push(i);
    else byStart.set(k, [i]);
  }
  const used = new Uint8Array(count);
  const loops: Loop[] = [];
  let open = 0;
  for (let start = 0; start < count; start++) {
    if (used[start]) continue;
    const pts: number[] = [];
    let i = start;
    let closed = false;
    for (;;) {
      used[i] = 1;
      pts.push(lines[4 * i]!, lines[4 * i + 1]!);
      const endKey = key(lines[4 * i + 2]!, lines[4 * i + 3]!);
      if (endKey === key(lines[4 * start]!, lines[4 * start + 1]!)) {
        closed = true;
        break;
      }
      const next = byStart.get(endKey)?.find((j) => !used[j]);
      if (next === undefined) break;
      i = next;
    }
    if (closed && pts.length >= 6) loops.push(simplify(pts));
    else open += pts.length / 2;
  }
  return { loops, open };
}

/** Drops corners that lie on a straight line between their neighbours (a flat face cut in several triangles). */
function simplify(pts: number[]): Loop {
  const n = pts.length / 2;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const ax = pts[2 * i]! - pts[2 * p]!;
    const ay = pts[2 * i + 1]! - pts[2 * p + 1]!;
    const bx = pts[2 * q]! - pts[2 * i]!;
    const by = pts[2 * q + 1]! - pts[2 * i + 1]!;
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    // Straight to within a millionth of the sides' lengths, and going the same way.
    if (len > 0 && Math.abs(ax * by - ay * bx) <= 1e-9 * len && ax * bx + ay * by > 0) continue;
    keep.push(pts[2 * i]!, pts[2 * i + 1]!);
  }
  return Float64Array.from(keep.length >= 6 ? keep : pts);
}
