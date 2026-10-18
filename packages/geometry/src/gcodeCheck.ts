// Reads a G-code file back, the way a printer would, and checks it before Studio 3D calls a slice finished. Written
// separately from the writer (gcode.ts) and from what the slicer says the layers are, so a mistake in writing the
// file can't hide itself: every move is followed, and every line of plastic is checked against the part.

import { linesLength } from "./infill";
import { filamentPerMm } from "./gcode";
import type { SlicedPart } from "./slicer";
import type { Loop } from "./slice";

export interface GcodeExpectations {
  part: SlicedPart;
  /** The printer's build volume, mm, front-left corner of the plate at 0, 0. */
  volume: [number, number, number];
  /** Where the slice's centred x, y sit on the plate. */
  offset: [number, number];
  filamentDiameter: number;
  /** The hottest the maker says the nozzle and bed go, °C, where known. */
  maxNozzleTemp?: number;
  maxBedTemp?: number;
  /** Where plastic may go outside the part on the first layer (the prime line): x1, y1, x2, y2. */
  primeArea?: [number, number, number, number];
}

export interface GcodeReport {
  ok: boolean;
  problems: string[];
  /** Layers with plastic laid down. */
  layers: number;
  /** Filament pushed into the part (not counting the prime line), mm. */
  filament: number;
  /** What the toolpaths should use, worked out from the sliced layers, mm. */
  expectedFilament: number;
  /** Plastic in the part, mm³. */
  plastic: number;
  moves: number;
  lines: number;
}

const MIN_NOZZLE_TEMP = 170;
const MAX_FEED_MM_S = 500;

/** Inside the material: an odd number of outline crossings to the right (outsides and holes together). */
function inside(loops: Loop[], x: number, y: number): boolean {
  let odd = false;
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = loop[2 * i]!;
      const yi = loop[2 * i + 1]!;
      const xj = loop[2 * j]!;
      const yj = loop[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

/** Distance from a point to the nearest outline, mm. */
function toEdge(loops: Loop[], x: number, y: number): number {
  let best = Infinity;
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = loop[2 * j]!;
      const ay = loop[2 * j + 1]!;
      const dx = loop[2 * i]! - ax;
      const dy = loop[2 * i + 1]! - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

/** What the sliced layers need, mm of filament: every wall loop round and every fill line along. */
export function expectedFilament(part: SlicedPart, filamentDiameter: number): number {
  let total = 0;
  for (const layer of part.layers) {
    let length = linesLength(layer.solidLines) + linesLength(layer.sparseLines);
    for (const wall of layer.walls)
      for (const loop of wall) {
        const n = loop.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++)
          length += Math.hypot(loop[2 * i]! - loop[2 * j]!, loop[2 * i + 1]! - loop[2 * j + 1]!);
      }
    total += length * filamentPerMm(part.settings.lineWidth, layer.top - layer.bottom, filamentDiameter);
  }
  return total;
}

export function checkGcode(text: string, expect: GcodeExpectations): GcodeReport {
  const problems: string[] = [];
  const problem = (p: string) => {
    if (problems.length < 20 && !problems.includes(p)) problems.push(p);
  };
  const { part, volume, offset } = expect;
  const byTop = new Map(part.layers.map((l) => [l.top.toFixed(3), l]));
  const area = (Math.PI * expect.filamentDiameter ** 2) / 4;

  let mm = false;
  let absolute = true;
  let absoluteE = true;
  let homed = false;
  let nozzleReady = false;
  let bedReady = false;
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let feed = 0;
  let filament = 0;
  let moves = 0;
  let lastExtrusionLine = -1;
  let nozzleOff = -1;
  let bedOff = -1;
  const printed = new Set<string>();

  const lines = text.split("\n");
  lines.forEach((raw, n) => {
    const line = raw.replace(/;.*/, "").trim().toUpperCase();
    if (!line) return;
    const [cmd, ...words] = line.split(/\s+/);
    const arg: Record<string, number> = {};
    for (const w of words) {
      const v = Number(w.slice(1));
      if (!/^[A-Z]$/.test(w[0]!) || !Number.isFinite(v)) problem(`Line ${n + 1} can't be read: "${raw.trim()}".`);
      else arg[w[0]!] = v;
    }
    const where = `line ${n + 1}`;
    switch (cmd) {
      case "G21":
        mm = true;
        break;
      case "G20":
        problem(`It switches to inches (${where}).`);
        break;
      case "G90":
        absolute = true;
        break;
      case "G91":
        absolute = false;
        break;
      case "M82":
        absoluteE = true;
        break;
      case "M83":
        absoluteE = false;
        break;
      case "G28":
        homed = true;
        [x, y, z] = [0, 0, 0];
        break;
      case "G92":
        if ("E" in arg) e = arg.E!;
        if ("X" in arg || "Y" in arg || "Z" in arg) problem(`It resets the position by hand (${where}).`);
        break;
      case "M104":
      case "M109": {
        const t = arg.S ?? 0;
        if (t === 0) nozzleOff = n;
        else if (t < MIN_NOZZLE_TEMP) problem(`The nozzle is set to ${t} °C, too cool to melt filament (${where}).`);
        else if (t > (expect.maxNozzleTemp ?? 300))
          problem(`The nozzle is set to ${t} °C, hotter than this printer goes (${where}).`);
        else if (cmd === "M109") nozzleReady = true;
        break;
      }
      case "M140":
      case "M190": {
        const t = arg.S ?? 0;
        if (t === 0) bedOff = n;
        else if (t > (expect.maxBedTemp ?? 120))
          problem(`The bed is set to ${t} °C, hotter than this printer goes (${where}).`);
        else if (cmd === "M190") bedReady = true;
        break;
      }
      case "G0":
      case "G1": {
        moves++;
        if (!mm) problem("It moves before setting millimetres.");
        if (!homed) problem("It moves before homing.");
        if (!absolute) problem(`It uses relative positions (${where}).`);
        if ("F" in arg) feed = arg.F! / 60;
        if (feed > MAX_FEED_MM_S) problem(`A move is faster than ${MAX_FEED_MM_S} mm/s (${where}).`);
        const nx = arg.X ?? x;
        const ny = arg.Y ?? y;
        const nz = arg.Z ?? z;
        const ne = "E" in arg ? (absoluteE ? arg.E! : e + arg.E!) : e;
        for (const [v, max, axis] of [
          [nx, volume[0], "X"],
          [ny, volume[1], "Y"],
          [nz, volume[2], "Z"],
        ] as const)
          if (v < -1e-6 || v > max + 1e-6) problem(`A move goes outside the printer: ${axis} ${v} (${where}).`);
        const pushed = ne - e;
        const length = Math.hypot(nx - x, ny - y);
        if (pushed > 1e-9 && length > 0) {
          if (cmd === "G0") problem(`Plastic is pushed on a travel move (${where}).`);
          if (nz !== z) problem(`Plastic is pushed while moving up or down (${where}).`);
          if (!nozzleReady || !bedReady) problem("Plastic is pushed before the nozzle and bed are hot.");
          lastExtrusionLine = n;
          const pa = expect.primeArea;
          const priming =
            pa &&
            Math.min(x, nx) >= pa[0] &&
            Math.max(x, nx) <= pa[2] &&
            Math.min(y, ny) >= pa[1] &&
            Math.max(y, ny) <= pa[3];
          const layer = byTop.get(nz.toFixed(3));
          if (!layer) problem(`Plastic is laid at ${nz} mm, which isn't the top of any layer (${where}).`);
          else if (priming && layer === part.layers[0]) {
            // The prime line, off the part.
          } else {
            filament += pushed;
            printed.add(nz.toFixed(3));
            // Every point along the line, a millimetre apart, has to be in the part's material at that height.
            const steps = Math.max(1, Math.ceil(length));
            for (let k = 0; k <= steps; k++) {
              const px = x + ((nx - x) * k) / steps - offset[0];
              const py = y + ((ny - y) * k) / steps - offset[1];
              if (!inside(layer.loops, px, py) && toEdge(layer.loops, px, py) > 1e-3) {
                problem(`Plastic goes outside the part at layer ${part.layers.indexOf(layer) + 1} (${where}).`);
                break;
              }
            }
          }
        } else if (pushed > 1e-9 && nz !== z) problem(`Plastic is pushed while moving up or down (${where}).`);
        [x, y, z, e] = [nx, ny, nz, ne];
        break;
      }
      case "M106":
      case "M107":
      case "M84":
        break;
      default:
        problem(`It has a command this check doesn't know: ${cmd} (${where}).`);
    }
  });

  const expected = expectedFilament(part, expect.filamentDiameter);
  if (Math.abs(filament - expected) > Math.max(0.01, expected * 0.002))
    problem(`It uses ${filament.toFixed(1)} mm of filament where the layers need ${expected.toFixed(1)} mm.`);
  const withMaterial = part.layers.filter(
    (l) => l.walls.some((w) => w.length) || l.solidLines.length + l.sparseLines.length,
  );
  for (const l of withMaterial)
    if (!printed.has(l.top.toFixed(3))) problem(`Layer ${part.layers.indexOf(l) + 1} is missing.`);
  if (printed.size === 0) problem("It doesn't print anything.");
  if (nozzleOff < lastExtrusionLine || bedOff < lastExtrusionLine)
    problem("It doesn't turn the heaters off at the end.");
  return {
    ok: problems.length === 0,
    problems,
    layers: printed.size,
    filament,
    expectedFilament: expected,
    plastic: filament * area,
    moves,
    lines: lines.length,
  };
}
