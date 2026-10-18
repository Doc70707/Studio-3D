// Print Studio's side panel: the printer, the checks run on the exact file that would go to a slicer, and export.
// Nothing here changes the design; the printer is saved beside it.
import { forwardRef } from "react";
import { PRINTERS, type PrintCheck, type Printer } from "@studio3d/document";
import { Icon } from "./Icon";

const round = (n: number) => Math.round(n * 10) / 10 + 0;
const MAKERS = [...new Set(PRINTERS.map((p) => p.maker))];

export type PrintState =
  /** The design has problems to fix first, or nothing to print. */
  | { kind: "blocked"; reason: string }
  /** Exporting and checking the file. */
  | { kind: "checking" }
  | { kind: "checked"; checks: PrintCheck[]; size: [number, number, number]; volume: number }
  | { kind: "failed"; reason: string };

interface Props {
  printer: Printer;
  state: PrintState;
  onPrinter: (id: string) => void;
  onExportStl: () => void;
  onBackToDesign: () => void;
  busy: boolean;
}

export const PrintPanel = forwardRef<HTMLElement, Props>(function PrintPanel(props, ref) {
  const { printer, state } = props;
  const errors = state.kind === "checked" ? state.checks.filter((c) => c.status === "error").length : 0;
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
        <button
          type="button"
          className="primary"
          onClick={props.onExportStl}
          disabled={props.busy || state.kind !== "checked"}
          title={
            state.kind !== "checked"
              ? "The checks need to finish first"
              : errors
                ? "Exports as it is; fix the red checks first for a good print"
                : "Save the checked file for your slicer"
          }
        >
          <Icon name="export" />
          Export STL
        </button>
        <button type="button" onClick={props.onBackToDesign}>
          Back to design
        </button>
      </div>
    </aside>
  );
});
