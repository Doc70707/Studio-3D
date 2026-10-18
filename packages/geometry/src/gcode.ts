// G-code from Studio 3D's own slicer: plain Marlin-style commands (the dialect Marlin, Klipper and Prusa firmware all
// read), with start and end code written for Studio 3D. The file is checked by reading it back (gcodeCheck.ts) before
// it's ever offered to the user.

import type { SlicedPart } from "./slicer";
import { layerPaths, type PathRole } from "./toolpath";

export interface GcodeMaterial {
  name: string;
  /** Nozzle temperature for the first layer and the rest, °C. */
  firstLayerNozzleTemp: number;
  nozzleTemp: number;
  bedTemp: number;
  /** Filament diameter, mm. */
  filamentDiameter: number;
  /** Part cooling fan from the second layer on, 0 to 1. */
  fan: number;
}

/** Speeds in mm/s. */
export interface GcodeSpeeds {
  firstLayer: number;
  outerWall: number;
  innerWall: number;
  fill: number;
  travel: number;
}

export interface GcodeOptions {
  printerName: string;
  /** Build volume, mm, with the plate's front-left corner at 0, 0. */
  volume: [number, number, number];
  /** Added to the slice's x, y, which are centred on the plate. */
  offset: [number, number];
  material: GcodeMaterial;
  speeds: GcodeSpeeds;
  /** Filament pulled back before a travel longer than `minTravel`, mm, at `speed` mm/s. */
  retract: { length: number; speed: number; minTravel: number };
  /** Who made the file, for its first line. */
  application: string;
}

export const PLA: GcodeMaterial = {
  name: "PLA",
  firstLayerNozzleTemp: 215,
  nozzleTemp: 210,
  bedTemp: 60,
  filamentDiameter: 1.75,
  fan: 1,
};

export const DEFAULT_SPEEDS: GcodeSpeeds = { firstLayer: 20, outerWall: 30, innerWall: 45, fill: 60, travel: 120 };
export const DEFAULT_RETRACT = { length: 0.8, speed: 35, minTravel: 2 };

/** The thin line drawn along the front of the plate before the part, to get the filament flowing. */
export const PRIME_LINE = { x: 5, y: 5, length: 100 };

/** How much filament (mm) one millimetre of line takes: the line's cross-section over the filament's. */
export const filamentPerMm = (lineWidth: number, layerThickness: number, filamentDiameter: number) =>
  (lineWidth * layerThickness) / ((Math.PI * filamentDiameter * filamentDiameter) / 4);

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const f5 = (v: number) => (Math.round(v * 100000) / 100000).toString();

export function writeGcode(part: SlicedPart, options: GcodeOptions): string {
  const { material: m, speeds: s, retract: r, offset } = options;
  const w = part.settings.lineWidth;
  const out: string[] = [];
  const say = (line: string) => out.push(line);
  const feed = (mmPerS: number) => `F${Math.round(mmPerS * 60)}`;
  const first = part.layers[0];
  const top = part.layers.length ? part.layers[part.layers.length - 1]!.top : 0;

  say(`; Made by ${options.application}'s own slicer for the ${options.printerName}.`);
  say(
    `; ${m.name}, ${part.layers.length} layers of ${part.settings.layerHeight} mm, ${part.settings.walls} walls, ` +
      `${Math.round(part.settings.infillDensity * 100)}% infill, ${w} mm lines.`,
  );
  say("; Not yet tried on a real printer: watch the first layer.");
  say("G21 ; millimetres");
  say("G90 ; absolute positions");
  say("M82 ; absolute extrusion");
  say("M107 ; fan off");
  say(`M140 S${m.bedTemp} ; heat the bed`);
  say(`M104 S${m.firstLayerNozzleTemp} ; heat the nozzle`);
  say("G28 ; home");
  say(`M190 S${m.bedTemp} ; wait for the bed`);
  say(`M109 S${m.firstLayerNozzleTemp} ; wait for the nozzle`);
  say("G92 E0");

  let e = 0;
  let x = 0;
  let y = 0;
  let retracted = false;
  const travel = (tx: number, ty: number) => {
    if (Math.hypot(tx - x, ty - y) > r.minTravel && !retracted) {
      e -= r.length;
      say(`G1 E${f5(e)} ${feed(r.speed)}`);
      retracted = true;
    }
    say(`G0 X${f3(tx)} Y${f3(ty)} ${feed(s.travel)}`);
    [x, y] = [tx, ty];
  };
  const extrude = (tx: number, ty: number, perMm: number, speed: number) => {
    if (retracted) {
      e += r.length;
      say(`G1 E${f5(e)} ${feed(r.speed)}`);
      retracted = false;
    }
    e += Math.hypot(tx - x, ty - y) * perMm;
    say(`G1 X${f3(tx)} Y${f3(ty)} E${f5(e)} ${feed(speed)}`);
    [x, y] = [tx, ty];
  };

  // The prime line runs along the front, only if the part leaves room for it there.
  let minY = Infinity;
  for (const l of part.layers)
    for (const loop of l.loops) for (let k = 1; k < loop.length; k += 2) minY = Math.min(minY, loop[k]!);
  const prime = first && minY + offset[1] > PRIME_LINE.y + 3 && options.volume[0] > PRIME_LINE.x * 2 + 20;
  if (prime) {
    const length = Math.min(PRIME_LINE.length, options.volume[0] - PRIME_LINE.x * 2);
    say("; prime line");
    say(`G0 Z${f3(first.top)} ${feed(s.travel / 4)}`);
    travel(PRIME_LINE.x, PRIME_LINE.y);
    extrude(
      PRIME_LINE.x + length,
      PRIME_LINE.y,
      filamentPerMm(w * 1.5, first.top - first.bottom, m.filamentDiameter),
      s.firstLayer,
    );
    say("G92 E0");
    e = 0;
  }

  let from: [number, number] = [x - offset[0], y - offset[1]];
  part.layers.forEach((layer, i) => {
    say(`; layer ${i + 1} of ${part.layers.length}, ${f3(layer.bottom)} to ${f3(layer.top)} mm`);
    if (i === 1) {
      say(`M106 S${Math.round(m.fan * 255)} ; fan on`);
      say(`M104 S${m.nozzleTemp}`);
    }
    say(`G0 Z${f3(layer.top)} ${feed(s.travel / 4)}`);
    const perMm = filamentPerMm(w, layer.top - layer.bottom, m.filamentDiameter);
    const speedOf = (role: PathRole) =>
      i === 0 ? s.firstLayer : role === "outer-wall" ? s.outerWall : role === "inner-wall" ? s.innerWall : s.fill;
    const { paths, end } = layerPaths(layer, from);
    let role: PathRole | null = null;
    for (const path of paths) {
      if (path.role !== role) say(`; ${(role = path.role)}`);
      const p = path.points;
      travel(p[0]! + offset[0], p[1]! + offset[1]);
      for (let k = 2; k < p.length; k += 2)
        extrude(p[k]! + offset[0], p[k + 1]! + offset[1], perMm, speedOf(path.role));
    }
    from = end;
    // Absolute extrusion counts up all print long; starting each layer from 0 keeps the numbers short.
    say("G92 E0");
    e = 0;
  });

  say("; end");
  e -= r.length;
  say(`G1 E${f5(e)} ${feed(r.speed)}`);
  say(`G0 Z${f3(Math.min(options.volume[2], top + 10))} ${feed(s.travel / 4)}`);
  say("M104 S0 ; nozzle off");
  say("M140 S0 ; bed off");
  say("M107 ; fan off");
  say("M84 ; motors off");
  return out.join("\n") + "\n";
}
