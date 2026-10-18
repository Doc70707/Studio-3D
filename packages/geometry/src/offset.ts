// Growing or shrinking a layer's outlines by an exact distance: the basis of walls (each wall is the outline moved
// inwards by a line width) and of finding parts too thin to print. Written for Studio 3D:
//
// 1. Every edge is moved sideways by the distance. Where neighbouring moved edges leave a gap (the outline bends away
//    from the moving side), the gap is closed with an arc round the corner; where they overlap, the two are joined
//    through the original corner, which only adds loops that wind the wrong way.
// 2. The moved outlines are split wherever they cross, and a piece is kept when the area on its left is covered
//    (winding number above 0) and the area on its right isn't (0 or less). Corners cut too deep and parts that vanish wind
//    zero or less, so they drop out.
// 3. The kept pieces are joined end to start into the new outlines.
//
// Outlines follow the slicer's rule: material on the left (outsides counter-clockwise, holes clockwise).

import { loopArea, type Loop } from "./slice";

/** Points on a round corner: one every this many radians at most, and never further apart than ARC_STEP_MM. */
const ARC_ANGLE = Math.PI / 18;
const ARC_STEP_MM = 0.2;

/**
 * Moves outlines by `distance` mm: positive shrinks the material (moves every edge into it), negative grows it.
 * Returns the new outlines, by the same rule.
 */
export function offsetLoops(loops: Loop[], distance: number): Loop[] {
  if (distance === 0) return loops.map((l) => l.slice());
  const raw: number[][] = [];
  for (const loop of loops) {
    const moved = moveLoop(withoutTinySides(loop), distance);
    if (moved.length >= 6) raw.push(moved);
  }
  return keepCovered(raw);
}

/** Corners closer than this to the previous one are merged: far below what a printer can draw, and they only make
 * the moved edges cross in clusters of nearly equal points. */
const MIN_SIDE = 1e-3;

function withoutTinySides(loop: Loop): Loop {
  const out: number[] = [];
  for (let i = 0; i < loop.length; i += 2) {
    const n = out.length;
    if (n && Math.hypot(loop[i]! - out[n - 2]!, loop[i + 1]! - out[n - 1]!) < MIN_SIDE) continue;
    out.push(loop[i]!, loop[i + 1]!);
  }
  while (out.length > 6 && Math.hypot(out[0]! - out[out.length - 2]!, out[1]! - out[out.length - 1]!) < MIN_SIDE)
    out.length -= 2;
  return out.length === loop.length ? loop : Float64Array.from(out);
}

/** One outline with every edge moved left by d (into the material). */
function moveLoop(loop: Loop, d: number): number[] {
  const n = loop.length / 2;
  const out: number[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = loop[2 * j]! - loop[2 * i]!;
    const dy = loop[2 * j + 1]! - loop[2 * i + 1]!;
    const len = Math.hypot(dx, dy) || 1;
    // Left of the direction of travel.
    nx.push(-dy / len);
    ny.push(dx / len);
  }
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n; // edge arriving at corner i
    const x = loop[2 * i]!;
    const y = loop[2 * i + 1]!;
    const ax = x + nx[p]! * d;
    const ay = y + ny[p]! * d;
    const bx = x + nx[i]! * d;
    const by = y + ny[i]! * d;
    // Which way the outline turns at this corner, against the side the edges move to.
    const turn = nx[p]! * ny[i]! - ny[p]! * nx[i]!;
    if (turn * d < -1e-12) {
      // The moved edges pull apart: round the corner, centred on it, at the distance.
      const start = Math.atan2(ny[p]!, nx[p]!);
      let sweep = Math.atan2(ny[i]!, nx[i]!) - start;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const r = Math.abs(d);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(sweep) / ARC_ANGLE, (Math.abs(sweep) * r) / ARC_STEP_MM)));
      for (let k = 0; k <= steps; k++) {
        const a = start + (sweep * k) / steps;
        out.push(x + Math.cos(a) * d, y + Math.sin(a) * d);
      }
    } else if (Math.abs(turn) <= 1e-12 && nx[p]! * nx[i]! + ny[p]! * ny[i]! > 0) {
      out.push(ax, ay); // straight on
    } else {
      out.push(ax, ay, x, y, bx, by);
    }
  }
  return out;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Splits the moved outlines where they cross and keeps the pieces that bound the covered area. */
function keepCovered(raw: number[][]): Loop[] {
  const segs: Seg[] = [];
  for (const pts of raw) {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const s = { ax: pts[2 * i]!, ay: pts[2 * i + 1]!, bx: pts[2 * j]!, by: pts[2 * j + 1]! };
      if (s.ax !== s.bx || s.ay !== s.by) segs.push(s);
    }
  }
  if (!segs.length) return [];
  const grid = new Grid(segs);

  // Where each segment is cut: parameters along it, with the exact point shared by both segments that cross there.
  const cuts: { t: number; x: number; y: number }[][] = segs.map(() => []);
  segs.forEach((s, i) => {
    for (const j of grid.near(s)) {
      if (j <= i) continue;
      const hit = cross(s, segs[j]!);
      if (!hit) continue;
      const [t, u, x, y] = hit;
      if (t > 0 && t < 1) cuts[i]!.push({ t, x, y });
      if (u > 0 && u < 1) cuts[j]!.push({ t: u, x, y });
    }
  });

  const pieces: Seg[] = [];
  segs.forEach((s, i) => {
    const pts = [{ t: 0, x: s.ax, y: s.ay }, ...cuts[i]!.sort((a, b) => a.t - b.t), { t: 1, x: s.bx, y: s.by }];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (a.x === b.x && a.y === b.y) continue;
      pieces.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  });

  // Keep a piece when the covered area is on its left and not on its right: test just to its right.
  const kept: Seg[] = [];
  for (const p of pieces) {
    const dx = p.bx - p.ax;
    const dy = p.by - p.ay;
    const len = Math.hypot(dx, dy);
    const e = Math.min(1e-6, len * 1e-3);
    const mx = (p.ax + p.bx) / 2 + (dy / len) * e;
    const my = (p.ay + p.by) / 2 - (dx / len) * e;
    if (grid.winding(mx, my) <= 0 && grid.winding(mx - (dy / len) * 2 * e, my + (dx / len) * 2 * e) > 0) kept.push(p);
  }
  return join(kept);
}

/** Where two segments cross: the parameter along each, and the point. Parallel or touching-only segments don't. */
function cross(s: Seg, o: Seg): [number, number, number, number] | null {
  const rx = s.bx - s.ax;
  const ry = s.by - s.ay;
  const qx = o.bx - o.ax;
  const qy = o.by - o.ay;
  const den = rx * qy - ry * qx;
  if (Math.abs(den) < 1e-18) return null;
  const wx = o.ax - s.ax;
  const wy = o.ay - s.ay;
  const t = (wx * qy - wy * qx) / den;
  const u = (wx * ry - wy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u, s.ax + t * rx, s.ay + t * ry];
}

/**
 * Joins kept pieces end to start. Where several moved edges cross almost at one point (round a sharp corner), the
 * crossings can differ by rounding, so ends within SNAP of a start are taken as meeting it.
 */
const SNAP = 1e-5;
function join(pieces: Seg[]): Loop[] {
  const cell = (v: number) => Math.floor(v / (SNAP * 10));
  const starts = new Map<string, number[]>();
  pieces.forEach((p, i) => {
    const k = `${cell(p.ax)},${cell(p.ay)}`;
    const list = starts.get(k);
    if (list) list.push(i);
    else starts.set(k, [i]);
  });
  const used = new Uint8Array(pieces.length);
  const nextAfter = (x: number, y: number): number | undefined => {
    let best: number | undefined;
    let bestD = SNAP;
    const cx = cell(x);
    const cy = cell(y);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of starts.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used[j]) continue;
          const d = Math.hypot(pieces[j]!.ax - x, pieces[j]!.ay - y);
          if (d <= bestD) {
            bestD = d;
            best = j;
          }
        }
    return best;
  };
  const loops: Loop[] = [];
  for (let s = 0; s < pieces.length; s++) {
    if (used[s]) continue;
    const first = pieces[s]!;
    const pts: number[] = [];
    let i = s;
    for (;;) {
      used[i] = 1;
      const p = pieces[i]!;
      pts.push(p.ax, p.ay);
      if (pts.length >= 6 && Math.hypot(p.bx - first.ax, p.by - first.ay) <= SNAP) {
        if (Math.abs(loopArea(Float64Array.from(pts))) > 1e-9) loops.push(tidy(pts));
        break;
      }
      const next = nextAfter(p.bx, p.by);
      if (next === undefined) break; // a piece that leads nowhere is dropped rather than guessed at
      i = next;
    }
  }
  return loops;
}

/** Drops corners closer than MIN_SIDE to the previous one, and corners on a straight run. */
function tidy(pts: number[]): Loop {
  const out = [...withoutTinySides(Float64Array.from(pts))];
  const keep: number[] = [];
  const m = out.length / 2;
  for (let i = 0; i < m; i++) {
    const p = (i + m - 1) % m;
    const q = (i + 1) % m;
    const ax = out[2 * i]! - out[2 * p]!;
    const ay = out[2 * i + 1]! - out[2 * p + 1]!;
    const bx = out[2 * q]! - out[2 * i]!;
    const by = out[2 * q + 1]! - out[2 * i + 1]!;
    const len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (len > 0 && Math.abs(ax * by - ay * bx) <= 1e-9 * len && ax * bx + ay * by > 0) continue;
    keep.push(out[2 * i]!, out[2 * i + 1]!);
  }
  return Float64Array.from(keep.length >= 6 ? keep : out);
}

/** Segments bucketed into square cells, to find neighbours and to count windings without looking at every one. */
class Grid {
  private readonly cells = new Map<number, number[]>();
  private readonly size: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  /** Segments by horizontal band, for winding counts. */
  private readonly bands: number[][];
  private readonly bandMinY: number;
  private readonly bandSize: number;

  constructor(private readonly segs: Seg[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.ax, s.bx);
      maxX = Math.max(maxX, s.ax, s.bx);
      minY = Math.min(minY, s.ay, s.by);
      maxY = Math.max(maxY, s.ay, s.by);
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    this.size = Math.max(span / Math.max(1, Math.sqrt(segs.length)), 1e-6);
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / this.size) + 1;
    segs.forEach((s, i) => {
      for (const c of this.cellsOf(s)) {
        const list = this.cells.get(c);
        if (list) list.push(i);
        else this.cells.set(c, [i]);
      }
    });
    const bandCount = Math.max(1, Math.ceil(Math.sqrt(segs.length)));
    this.bandMinY = minY;
    this.bandSize = Math.max((maxY - minY) / bandCount, 1e-9);
    this.bands = Array.from({ length: bandCount }, () => []);
    segs.forEach((s, i) => {
      const lo = this.band(Math.min(s.ay, s.by));
      const hi = this.band(Math.max(s.ay, s.by));
      for (let b = lo; b <= hi; b++) this.bands[b]!.push(i);
    });
  }

  private band(y: number): number {
    return Math.min(this.bands.length - 1, Math.max(0, Math.floor((y - this.bandMinY) / this.bandSize)));
  }

  private cellsOf(s: Seg): number[] {
    const x0 = Math.floor((Math.min(s.ax, s.bx) - this.minX) / this.size);
    const x1 = Math.floor((Math.max(s.ax, s.bx) - this.minX) / this.size);
    const y0 = Math.floor((Math.min(s.ay, s.by) - this.minY) / this.size);
    const y1 = Math.floor((Math.max(s.ay, s.by) - this.minY) / this.size);
    const out: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * this.cols + x);
    return out;
  }

  /** Segments that share a cell with `s`. */
  near(s: Seg): Set<number> {
    const out = new Set<number>();
    for (const c of this.cellsOf(s)) for (const i of this.cells.get(c) ?? []) out.add(i);
    return out;
  }

  /** How many times the outlines wind round (x, y), counter-clockwise positive. */
  winding(x: number, y: number): number {
    let w = 0;
    for (const i of this.bands[this.band(y)]!) {
      const s = this.segs[i]!;
      if (s.ay <= y) {
        if (s.by > y && (s.bx - s.ax) * (y - s.ay) - (x - s.ax) * (s.by - s.ay) > 0) w++;
      } else if (s.by <= y && (s.bx - s.ax) * (y - s.ay) - (x - s.ax) * (s.by - s.ay) < 0) w--;
    }
    return w;
  }
}
