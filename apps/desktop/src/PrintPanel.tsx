// Print Studio's side panel: the printer, the checks run on the exact file that would go to a slicer, and export or
// opening it in a slicer the user installed. Nothing here changes the design; the printer is saved beside it.
import { forwardRef, useEffect, useState } from "react";
import { LAYER_HEIGHTS, PRINTERS, type PrintCheck, type Printer } from "@studio3d/document";
import type { Layer } from "@studio3d/geometry";
import { Icon } from "./Icon";
import { platform, type MeshFormat, type SlicerProgram } from "./platform";
import { defaultSlicer, readSlicerMemory, slicerList, writeSlicerMemory, type SlicerMemory } from "./slicerChoice";

const round = (n: number) => Math.round(n * 10) / 10 + 0;
const MAKERS = [...new Set(PRINTERS.map((p) => p.maker))];

export type PrintState =
  /** The design has problems to fix first, or nothing to print. */
  | { kind: "blocked"; reason: string }
  /** Exporting and checking the file. */
  | { kind: "checking" }
  | { kind: "checked"; checks: PrintCheck[]; size: [number, number, number]; volume: number }
  | { kind: "failed"; reason: string };

/** The sliced layers being previewed, and which one is shown on top. */
export interface LayerPreview {
  count: number;
  index: number;
  layer: Layer | null;
  /** Cut lines that didn't close into outlines (a gap in the surface). */
  openEnds: number;
}

const mm = (n: number) => `${(Math.round(n * 100) / 100 + 0).toFixed(2)} mm`;

interface Props {
  printer: Printer;
  layerHeight: number;
  onLayerHeight: (h: number) => void;
  layers: LayerPreview | null;
  onLayerView: (on: boolean) => void;
  onLayer: (index: number) => void;
  state: PrintState;
  onPrinter: (id: string) => void;
  onExport: (format: MeshFormat) => void;
  onOpenInSlicer: (slicer: SlicerProgram) => void;
  onBackToDesign: () => void;
  busy: boolean;
}

export const PrintPanel = forwardRef<HTMLElement, Props>(function PrintPanel(props, ref) {
  const { printer, state } = props;
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
    <aside className="panel glass print-panel" aria-label="Print Studio" ref={ref}>
      <div className="panel-scroll">
        <h2 className="panel-title">Print Studio</h2>
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
          Build volume {printer.volume.join(" × ")} mm.
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
              value={props.layerHeight}
              onChange={(e) => props.onLayerHeight(Number(e.target.value))}
              title="Thinner layers show less of the steps on curves and slopes, and take longer to print"
            >
              {(LAYER_HEIGHTS.includes(props.layerHeight) ? LAYER_HEIGHTS : [...LAYER_HEIGHTS, props.layerHeight])
                .sort((a, b) => a - b)
                .map((h) => (
                  <option key={h} value={h}>
                    {mm(h)}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          className="layer-toggle"
          aria-pressed={!!props.layers}
          disabled={!props.layers && state.kind !== "checked"}
          onClick={() => props.onLayerView(!props.layers)}
          title={state.kind !== "checked" ? "The checks need to finish first" : "Cut the part into its printed layers"}
        >
          {props.layers ? "Show the part" : "Preview layers"}
        </button>
        {props.layers && (
          <>
            <div className="field compact">
              <label htmlFor="layer">Layer</label>
              <div className="input-row range-row">
                <input
                  id="layer"
                  type="range"
                  min={1}
                  max={props.layers.count}
                  value={props.layers.index + 1}
                  onChange={(e) => props.onLayer(Number(e.target.value) - 1)}
                />
              </div>
            </div>
            {props.layers.layer && (
              <p className="props-note" data-testid="layer-info">
                Layer {props.layers.index + 1} of {props.layers.count}: {mm(props.layers.layer.bottom)} to{" "}
                {mm(props.layers.layer.top)}, {Math.round(props.layers.layer.area * 10) / 10} mm² of material.
              </p>
            )}
            {props.layers.openEnds > 0 && (
              <p className="issue warning" role="alert">
                Some layers have outlines that don't close: the surface has a gap there.
              </p>
            )}
            <p className="props-note">Outlines from Studio 3D's own slicer. Walls, infill and G-code come next.</p>
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
    </aside>
  );
});
