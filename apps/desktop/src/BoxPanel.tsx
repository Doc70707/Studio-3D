import { useEffect, useId, useState } from "react";
import { hasErrors, type BoxFeature, type Issue } from "@studio3d/document";
import type { Measurements } from "@studio3d/geometry";

type NumericField = "width" | "depth" | "height" | "wall";

const FIELDS: { key: NumericField; label: string; help: string }[] = [
  { key: "width", label: "Width", help: "Left to right, along the red X axis." },
  { key: "depth", label: "Depth", help: "Front to back, along the green Y axis." },
  { key: "height", label: "Height", help: "From the build plate up." },
  { key: "wall", label: "Wall thickness", help: "Thickness of the sides and floor. Use 0 for a solid block." },
];

interface Props {
  box: BoxFeature;
  issues: Issue[];
  measurements: Measurements | null;
  /** The values the shown model was built from (may lag behind `box` while it is invalid). */
  builtBox: BoxFeature | null;
  /** True when the 3D view shows an older valid version than the values typed. */
  stale: boolean;
  onChange: (patch: Partial<BoxFeature>) => void;
}

export function BoxPanel({ box, issues, measurements, builtBox, stale, onChange }: Props) {
  const general = issues.filter((i) => i.field === null);
  return (
    <aside className="panel" aria-label="Box settings">
      <h2>Box</h2>
      {FIELDS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          help={f.help}
          value={box[f.key]}
          issue={issues.find((i) => i.field === f.key)}
          onCommit={(v) => onChange({ [f.key]: v })}
        />
      ))}
      {general.map((i) => (
        <p key={i.message} className={`issue ${i.severity}`} role="alert">
          {i.message}
        </p>
      ))}
      {stale && hasErrors(issues) && <p className="help">The 3D view shows your last valid box until the values above are fixed.</p>}
      {builtBox && <Facts box={builtBox} measurements={measurements} />}
    </aside>
  );
}

function NumberField(props: { label: string; help: string; value: number; issue?: Issue; onCommit: (v: number) => void }) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  const [typingError, setTypingError] = useState<string | null>(null);

  // Follow outside changes (open, new project) without fighting the user's typing.
  useEffect(() => {
    if (parse(text) !== props.value) {
      setText(String(props.value));
      setTypingError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const message = typingError ?? props.issue?.message;
  const severity = typingError ? "error" : props.issue?.severity;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="input-row">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          aria-invalid={severity === "error"}
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (v === null) setTypingError(`${props.label} needs to be a number, like 12 or 2.5.`);
            else {
              setTypingError(null);
              props.onCommit(v);
            }
          }}
        />
        <span className="unit">mm</span>
      </div>
      {message ? (
        <p className={`issue ${severity}`} role={severity === "error" ? "alert" : undefined}>
          {message}
        </p>
      ) : (
        <p id={`${id}-help`} className="help">
          {props.help}
        </p>
      )}
    </div>
  );
}

function parse(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const mm = (n: number) => `${Math.round(n * 100) / 100}`;

function Facts({ box, measurements }: { box: BoxFeature; measurements: Measurements | null }) {
  if (!measurements) return null;
  const [x, y, z] = measurements.size;
  return (
    <dl className="facts" data-testid="measurements">
      <dt>Outside size</dt>
      <dd>
        {mm(x)} × {mm(y)} × {mm(z)} mm
      </dd>
      {box.wall > 0 && (
        <>
          <dt>Inside space</dt>
          <dd>
            {mm(box.width - 2 * box.wall)} × {mm(box.depth - 2 * box.wall)} × {mm(box.height - box.wall)} mm
          </dd>
        </>
      )}
      <dt>Material volume</dt>
      <dd data-testid="volume">{(measurements.volume / 1000).toFixed(2)} cm³</dd>
    </dl>
  );
}
