// A print job: the sliced part written as G-code for one printer, then read back and checked. Only a file that passes
// the check is ever offered to the user.

import { DEFAULT_RETRACT, DEFAULT_SPEEDS, PLA, PRIME_LINE, writeGcode } from "./gcode";
import { checkGcode, type GcodeReport } from "./gcodeCheck";
import type { SlicedPart } from "./slicer";

export interface PrintJob {
  printerName: string;
  /** Build volume, mm. */
  volume: [number, number, number];
  maxNozzleTemp?: number;
  maxBedTemp?: number;
  /** Who made the file, for its first line. */
  application: string;
}

export interface PrintJobResult {
  gcode: string;
  report: GcodeReport;
  /** Filament used, grams of PLA. */
  grams: number;
}

/** PLA's density, g/mm³. */
const PLA_DENSITY = 1.24e-3;

export function makeGcode(part: SlicedPart, job: PrintJob): PrintJobResult {
  // The slice is centred on the plate; the printer's 0, 0 is the plate's front-left corner.
  const offset: [number, number] = [job.volume[0] / 2, job.volume[1] / 2];
  const gcode = writeGcode(part, {
    printerName: job.printerName,
    volume: job.volume,
    offset,
    material: PLA,
    speeds: DEFAULT_SPEEDS,
    retract: DEFAULT_RETRACT,
    application: job.application,
  });
  const report = checkGcode(gcode, {
    part,
    volume: job.volume,
    offset,
    filamentDiameter: PLA.filamentDiameter,
    maxNozzleTemp: job.maxNozzleTemp,
    maxBedTemp: job.maxBedTemp,
    primeArea: [PRIME_LINE.x - 0.01, PRIME_LINE.y - 0.01, PRIME_LINE.x + PRIME_LINE.length + 0.01, PRIME_LINE.y + 0.01],
  });
  return { gcode, report, grams: report.plastic * PLA_DENSITY };
}
