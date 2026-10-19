// Print Studio's side panel: the printer, the checks run on the exact file that would go to a slicer, and export or
// opening it in a slicer the user installed. Nothing here changes the design; the printer is saved beside it.
import { forwardRef, useEffect, useState } from "react";
import {
  INFILL_DENSITIES,
  LAYER_HEIGHTS,
  WALL_COUNTS,
  PRINTERS,
  type PrintCheck,
  type Printer,
} from "@studio3d/document";
import { PLA, type SlicedLayer, type SlicerSettings } from "@studio3d/geometry";
import { Icon } from "./Icon";
import { platform, type MeshFormat, type SlicerProgram } from "./platform";
import { defaultSlicer, readSlicerMemory, slicerList, writeSlicerMemory, type SlicerMemory } from "./slicerChoice";

const round = (n: number) => Math.round(n * 10) / 10 + 0;
/** What the maker publishes about the printer, leaving out anything they don't state. */
export function printerSummary(p: Printer): string {
  const parts = [`Build volume ${p.volume.join(" × ")} mm.`];
  const nozzle = p.nozzle ? `${p.nozzle} mm nozzle` : "Nozzle";
  if (p.maxNozzleTemp) parts.push(`${nozzle} up to ${p.maxNozzleTemp} °C.`);
  else if (p.nozzle) parts.push(`${nozzle}.`);
  if (p.maxBedTemp) parts.push(`Bed up to ${p.maxBedTemp} °C.`);
  return parts.join(" ");
}

const MAKERS = [...new Set(PRINTERS.map((p) => p.maker))];

export type PrintState =
  /** The design has problems to fix first, or nothing to print. */
  | { kind: "blocked"; reason: string }
  /** Exporting and checking the file. */
  | { kind: "checking" }
  | { kind: "checked"; checks: PrintCheck[]; size: [number, number, number]; volume: number }
  | { kind: "failed"; reason: string };

/** The layer preview: slicing, failed, or the sliced layers and which one is shown on top. */
export type LayerPreview =
  | { status: "slicing" }
  | { status: "failed"; error: string }
  | {
      status: "sliced";
      count: number;
      index: number;
      layer: SlicedLayer | null;
      /** Cut lines that didn't close into outlines (a gap in the surface). */
      openEnds: number;
      /** Layers with places thinner than one line. */
      thinLayers: number[];
    };

/** What slicing came to: the G-code written from the layers and read back, or why it couldn't be. */
export type SliceSummary =
  | { status: "writing" }
  | { status: "failed"; problem: string }
  | {
      status: "ready";
      layers: number;
      height: number;
      /** Filament, mm. */
      filament: number;
      grams: number;
      /** About how long the moves take, seconds. */
      seconds: number;
    };

/** "1 h 05 min", "38 min" or "under a minute". */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  return h ? `${h} h ${String(minutes % 60).padStart(2, "0")} min` : `${minutes} min`;
}

/** The offered values, plus the current one if a file holds another. */
const withCurrent = (values: number[], current: number) =>
  (values.includes(current) ? values : [...values, current]).sort((a, b) => a - b);

/** "1–3, 7, 9–10" for layer numbers (from 0). */
function spans(layers: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < layers.length; ) {
    let j = i;
    while (j + 1 < layers.length && layers[j + 1] === layers[j]! + 1) j++;
    out.push(i === j ? `${layers[i]! + 1}` : `${layers[i]! + 1}–${layers[j]! + 1}`);
    i = j + 1;
  }
  return out.join(", ");
}

/** How many of the walls fit on this layer. */
function wallSummary(layer: SlicedLayer, wanted: number): string {
  const fit = layer.walls.filter((w) => w.length > 0).length;
  if (fit === wanted) return `${wanted} ${wanted === 1 ? "wall" : "walls"}.`;
  return fit === 0 ? "Too thin for any wall." : `Room for ${fit} of ${wanted} walls in places.`;
}

/** What fills this layer inside its walls. */
function fillSummary(layer: SlicedLayer, density: number): string {
  const solid = layer.solidLines.length > 0;
  const sparse = layer.sparseLines.length > 0;
  const pct = `${Math.round(density * 100)}% infill`;
  if (solid && sparse) return `Solid skin and ${pct}.`;
  if (solid) return "Solid skin.";
  if (sparse) return `${pct[0]!.toUpperCase()}${pct.slice(1)}.`;
  return "Nothing to fill inside the walls.";
}

const mm = (n: number) => `${(Math.round(n * 100) / 100 + 0).toFixed(2)} mm`;

interface Props {
  printer: Printer;
  settings: SlicerSettings;
  onSettings: (patch: { layerHeight?: number; walls?: number; infill?: number }) => void;
  layers: LayerPreview | null;
  /** The sliced part's print, once its G-code is written and checked. */
  summary: SliceSummary | null;
  onLayerView: (on: boolean) => void;
  onLayer: (index: number) => void;
  state: PrintState;
  onPrinter: (id: string) => void;
  onExport: (format: MeshFormat) => void;
  /** Why G-code can't be made for this printer or part, or null when it can. */
  gcodeBlocked: string | null;
  onExportGcode: () => void;
  onOpenInSlicer: (slicer: SlicerProgram) => void;
  onBackToDesign: () => void;
  busy: boolean;
}

/** The slice at a glance: how long, how much filament, how many layers, and that the file was checked. */
function SliceResult({ summary }: { summary: SliceSummary }) {
  if (summary.status === "writing")
    return (
      <p className="props-note" role="status" data-testid="slice-result">
        Writing the toolpaths and checking them…
      </p>
    );
  if (summary.status === "failed")
    return (
      <p className="issue error" role="alert" data-testid="slice-result">
        The toolpaths didn't pass their check: {summary.problem}
      </p>
    );
  return (
    <div className="slice-result" role="status" data-testid="slice-result">
      <div className="slice-figures">
        <span>
          <strong data-testid="slice-time">{duration(summary.seconds)}</strong>
          <small>printing, roughly</small>
        </span>
        <span>
          <strong data-testid="slice-filament">{Math.round(summary.grams)} g</strong>
          <small>{(summary.filament / 1000).toFixed(2)} m of PLA</small>
        </span>
        <span>
          <strong data-testid="slice-layers">{summary.layers}</strong>
          <small>layers, {Math.round(summary.height * 100) / 100} mm</small>
        </span>
      </div>
      <p className="props-note">
        <Icon name="check" /> Every line checked inside the part and the printer. The time is a rough guess at Studio
        3D's own speeds (20 to 60 mm/s), without heating up; your printer's own estimate will differ.
      </p>
    </div>
  );
}

export const PrintPanel = forwardRef<HTMLDivElement, Props>(function PrintPanel(props, ref) {
  const { printer, state, settings, layers } = props;
  const errors = state.kind === "checked" ? state.checks.filter((c) => c.status === "error").length : 0;
  const ready = !props.busy && state.kind === "checked";
  const why =
    state.kind !== "checked"
      ? "The checks need to finish first"
      : errors
        ? "Goes as it is; fix the red checks first for a good print"
        : undefined;

  // The slicers on this computer (desktop only), looked for each time Print Studio opens.
  const slicers = platform.slicers;
  const [found, setFound] = useState<SlicerProgram[] | null>(null);
  const [memory, setMemory] = useState<SlicerMemory>(readSlicerMemory);
  useEffect(() => {
    let live = true;
    slicers?.find().then(
      (list) => live && setFound(list),
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [slicers]);
  const list = slicerList(found ?? [], memory.located);
  const slicer = defaultSlicer(list, memory.last);
  const remember = (m: SlicerMemory) => {
    setMemory(m);
    writeSlicerMemory(m);
  };
  const locate = async () => {
    const picked = await slicers?.locate();
    if (picked) remember({ last: picked.path, located: picked });
  };
  return (
    <div className="print-panel" ref={ref}>
      <div className="panel-scroll">
        <div className="field compact">
          <label htmlFor="printer">Printer</label>
          <div className="input-row select-row">
            <select id="printer" value={printer.id} onChange={(e) => props.onPrinter(e.target.value)}>
              {MAKERS.map((maker) => (
                <optgroup key={maker} label={maker}>
                  {PRINTERS.filter((p) => p.maker === maker).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <p
          className="props-note"
          data-testid="build-volume"
          title={`From the maker's specifications: ${printer.source}`}
        >
          {printerSummary(printer)}
        </p>

        <h2 className="panel-title">Before printing</h2>
        {state.kind === "blocked" || state.kind === "failed" ? (
          <p className="issue error" role="alert" data-testid="print-blocked">
            {state.reason}
          </p>
        ) : state.kind === "checking" ? (
          <p className="props-note" role="status" data-testid="print-checking">
            Checking the file that would go to your slicer…
          </p>
        ) : (
          <ul className="print-checks" aria-label="Print checks">
            {state.checks.map((c) => (
              <li
                key={c.id}
                className={`print-check ${c.status}`}
                data-testid="print-check"
                data-check={c.id}
                data-status={c.status}
              >
                <Icon name={c.status === "ok" ? "check" : "alert"} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}

        <h2 className="panel-title">Layers</h2>
        <div className="field compact">
          <label htmlFor="layer-height">Layer height</label>
          <div className="input-row select-row">
            <select
              id="layer-height"
              value={settings.layerHeight}
              onChange={(e) => props.onSettings({ layerHeight: Number(e.target.value) })}
              title="Thinner layers show less of the steps on curves and slopes, and take longer to print"
            >
              {withCurrent(LAYER_HEIGHTS, settings.layerHeight).map((h) => (
                <option key={h} value={h}>
                  {mm(h)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field compact">
          <label htmlFor="walls">Walls</label>
          <div className="input-row select-row">
            <select
              id="walls"
              value={settings.walls}
              onChange={(e) => props.onSettings({ walls: Number(e.target.value) })}
              title={`Lines round every outline, each ${settings.lineWidth} mm wide. More walls make a stronger part.`}
            >
              {withCurrent(WALL_COUNTS, settings.walls).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field compact">
          <label htmlFor="infill">Infill</label>
          <div className="input-row select-row">
            <select
              id="infill"
              value={settings.infillDensity}
              onChange={(e) => props.onSettings({ infill: Number(e.target.value) })}
              title={
                "How much of the inside is filled, in lines crossing at right angles from layer to layer. " +
                "The top 0.8 mm and bottom 0.6 mm are always solid."
              }
            >
              {withCurrent(INFILL_DENSITIES, settings.infillDensity).map((d) => (
                <option key={d} value={d}>
                  {Math.round(d * 100)}%
                </option>
              ))}
            </select>
          </div>
        </div>
        {layers ? (
          <button type="button" className="layer-toggle" onClick={() => props.onLayerView(false)}>
            Show the part
          </button>
        ) : (
          <button
            type="button"
            className="primary slice-button"
            disabled={state.kind !== "checked"}
            onClick={() => props.onLayerView(true)}
            title={
              state.kind !== "checked"
                ? "The checks need to finish first"
                : "Cut the part into its printed layers with Studio 3D's own slicer, and work out the print"
            }
          >
            <Icon name="layers" />
            Slice
          </button>
        )}
        {layers?.status === "slicing" && (
          <p className="props-note" role="status" data-testid="slicing">
            Slicing…
          </p>
        )}
        {layers?.status === "sliced" && props.summary && <SliceResult summary={props.summary} />}
        {layers?.status === "failed" && (
          <p className="issue error" role="alert">
            The part couldn't be sliced: {layers.error}
          </p>
        )}
        {layers?.status === "sliced" && (
          <>
            <div className="field compact">
              <label htmlFor="layer">Layer</label>
              <div className="input-row range-row">
                <input
                  id="layer"
                  type="range"
                  min={1}
                  max={layers.count}
                  value={layers.index + 1}
                  onChange={(e) => props.onLayer(Number(e.target.value) - 1)}
                />
              </div>
            </div>
            {layers.layer && (
              <p className="props-note" data-testid="layer-info">
                Layer {layers.index + 1} of {layers.count}: {mm(layers.layer.bottom)} to {mm(layers.layer.top)},{" "}
                {Math.round(layers.layer.area * 10) / 10} mm² of material. {wallSummary(layers.layer, settings.walls)}{" "}
                {fillSummary(layers.layer, settings.infillDensity)}
              </p>
            )}
            {layers.thinLayers.length > 0 && (
              <p className="issue warning" role="alert" data-testid="thin-warning">
                {layers.thinLayers.length === 1 ? "Layer" : "Layers"} {spans(layers.thinLayers)}{" "}
                {layers.thinLayers.length === 1 ? "has" : "have"} places thinner than one {settings.lineWidth} mm line.
                They won't print; make them thicker in Design.
              </p>
            )}
            {layers.openEnds > 0 && (
              <p className="issue warning" role="alert">
                Some layers have outlines that don't close: the surface has a gap there.
              </p>
            )}
            <p className="props-note">
              Walls and infill from Studio 3D's own slicer, each line {settings.lineWidth} mm wide.
            </p>
            <p className="props-note" data-testid="gcode-material">
              G-code is for {PLA.name}: nozzle {PLA.firstLayerNozzleTemp} °C on the first layer, then {PLA.nozzleTemp}{" "}
              °C; bed {PLA.bedTemp} °C; {PLA.filamentDiameter} mm filament. It's checked before it's saved.
            </p>
            {props.gcodeBlocked && (
              <p className="issue warning" data-testid="gcode-blocked">
                {props.gcodeBlocked}
              </p>
            )}
            <button
              type="button"
              onClick={props.onExportGcode}
              disabled={props.busy || !!props.gcodeBlocked || props.summary?.status !== "ready"}
              title={props.gcodeBlocked ?? "Write the printer's G-code, check it by reading it back, then save it"}
            >
              <Icon name="export" />
              Export G-code…
            </button>
          </>
        )}
      </div>

      {state.kind === "checked" && (
        <dl className="facts" data-testid="print-facts">
          <dt>Part size</dt>
          <dd>{state.size.map(round).join(" × ")} mm</dd>
          <dt>Material volume</dt>
          <dd>{(state.volume / 1000).toFixed(2)} cm³</dd>
        </dl>
      )}
      <div className="print-actions">
        {slicers ? (
          <>
            {list.length > 0 && (
              <div className="field compact">
                <label htmlFor="slicer">Slicer</label>
                <div className="print-buttons">
                  <div className="input-row select-row">
                    <select
                      id="slicer"
                      value={slicer?.path}
                      onChange={(e) => remember({ ...memory, last: e.target.value })}
                    >
                      {list.map((s) => (
                        <option key={s.path} value={s.path} title={s.path}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="narrow"
                    onClick={() => void locate()}
                    title="Point to a slicer's program file"
                  >
                    Other…
                  </button>
                </div>
              </div>
            )}
            {found && list.length === 0 && (
              <p className="props-note" data-testid="no-slicer">
                No Bambu Studio, OrcaSlicer or PrusaSlicer in its usual folder. Locate yours, or export a file below.
              </p>
            )}
            {slicer ? (
              <button
                type="button"
                className="primary"
                onClick={() => props.onOpenInSlicer(slicer)}
                disabled={!ready}
                title={why ?? `Open the checked part in ${slicer.name} as a 3MF file`}
              >
                <Icon name="printer" />
                Open in {slicer.name}
              </button>
            ) : (
              <button type="button" onClick={() => void locate()} title="Point to a slicer's program file">
                Locate slicer…
              </button>
            )}
          </>
        ) : null}
        <p className="props-note" data-testid="handoff-note">
          Only the part's shape is sure to go across. Pick your printer, filament and settings in the slicer.
        </p>
        <div className="print-buttons">
          <button
            type="button"
            className={slicers ? "" : "primary"}
            onClick={() => props.onExport("3mf")}
            disabled={!ready}
            title={why ?? "Save the checked part as a 3MF file: millimetres, its name, on the printer's plate"}
          >
            <Icon name="export" />
            Export 3MF
          </button>
          <button
            type="button"
            onClick={() => props.onExport("stl")}
            disabled={!ready}
            title={why ?? "Save the checked part as an STL file"}
          >
            <Icon name="export" />
            Export STL
          </button>
        </div>
        <button type="button" onClick={props.onBackToDesign}>
          Back to design
        </button>
      </div>
    </div>
  );
});
