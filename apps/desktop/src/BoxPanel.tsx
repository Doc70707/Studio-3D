import { forwardRef, useEffect, useId, useState } from "react";
import { hasErrors, type BoxFeature, type HoleFeature, type Issue } from "@studio3d/document";
import type { Measurements } from "@studio3d/geometry";
import { Icon } from "./Icon";

type NumericField = "width" | "depth" | "height" | "wall";

const FIELDS: { key: NumericField; label: string; help: string }[] = [
  { key: "width", label: "Width", help: "Left to right, along the red X axis." },
  { key: "depth", label: "Depth", help: "Front to back, along the green Y axis." },
  { key: "height", label: "Height", help: "From the build plate up." },
  { key: "wall", label: "Wall thickness", help: "Thickness of the sides and floor. Use 0 for a solid block." },
];

interface Props {
  box: BoxFeature;
  holes: HoleFeature[];
  issues: Issue[];
  measurements: Measurements | null;
  /** The values the shown model was built from (may lag behind `box` while it is invalid). */
  builtBox: BoxFeature | null;
  /** True when the 3D view shows an older valid version than the values typed. */
  stale: boolean;
  onChange: (patch: Partial<BoxFeature>) => void;
  onHoleChange: (id: string, patch: Partial<HoleFeature>) => void;
  onAddHole: () => void;
  onRemoveHole: (id: string) => void;
}

export const BoxPanel = forwardRef<HTMLElement, Props>(function BoxPanel(
  { box, holes, issues, measurements, builtBox, stale, onChange, onHoleChange, onAddHole, onRemoveHole },
  ref,
) {
  const boxIssues = issues.filter((i) => i.featureId === undefined || i.featureId === box.id);
  const general = boxIssues.filter((i) => i.field === null);
  return (
    <aside className="panel glass" aria-label="Design" ref={ref}>
      <div className="panel-scroll">
        <h2>Box</h2>
        <p className="lead">Type a size and the box updates as you go.</p>
        {FIELDS.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            help={f.help}
            value={box[f.key]}
            issue={boxIssues.find((i) => i.field === f.key)}
            onCommit={(v) => onChange({ [f.key]: v })}
          />
        ))}
        {general.map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role="alert">
            {i.message}
          </p>
        ))}

        <section className="holes" aria-label="Holes">
          <div className="section-head">
            <h3>Holes</h3>
            <button type="button" className="add" onClick={onAddHole}>
              <Icon name="plus" />
              Add hole
            </button>
          </div>
          {holes.length === 0 && (
            <p className="help">Add a hole for a screw, a drain or a cable. Holes go straight down from the top.</p>
          )}
          {holes.map((h) => (
            <HoleCard
              key={h.id}
              hole={h}
              box={box}
              issues={issues.filter((i) => i.featureId === h.id)}
              onChange={(patch) => onHoleChange(h.id, patch)}
              onRemove={() => onRemoveHole(h.id)}
            />
          ))}
        </section>

        {stale && hasErrors(issues) && (
          <p className="help">The 3D view shows your last valid design until the highlighted values are fixed.</p>
        )}
      </div>
      {builtBox && <Facts box={builtBox} measurements={measurements} />}
    </aside>
  );
});

function HoleCard(props: {
  hole: HoleFeature;
  box: BoxFeature;
  issues: Issue[];
  onChange: (patch: Partial<HoleFeature>) => void;
  onRemove: () => void;
}) {
  const { hole, box, issues, onChange } = props;
  const through = hole.depth === 0;
  const issueFor = (field: keyof HoleFeature) => issues.find((i) => i.field === field);
  return (
    <div className="hole-card" data-testid="hole">
      <div className="hole-head">
        <span className="hole-name">{hole.name}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${hole.name}`}
          title="Remove this hole"
          onClick={props.onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="hole-grid">
        <NumberField
          label="From left"
          name={`${hole.name} distance from left edge`}
          value={hole.x}
          issue={issueFor("x")}
          onCommit={(v) => onChange({ x: v })}
          compact
        />
        <NumberField
          label="From front"
          name={`${hole.name} distance from front edge`}
          value={hole.y}
          issue={issueFor("y")}
          onCommit={(v) => onChange({ y: v })}
          compact
        />
        <NumberField
          label="Diameter"
          name={`${hole.name} diameter`}
          value={hole.diameter}
          issue={issueFor("diameter")}
          onCommit={(v) => onChange({ diameter: v })}
          compact
        />
        {!through && (
          <NumberField
            label="Depth"
            name={`${hole.name} depth`}
            value={hole.depth}
            issue={issueFor("depth")}
            onCommit={(v) => onChange({ depth: v })}
            compact
          />
        )}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={through}
          onChange={(e) => onChange({ depth: e.target.checked ? 0 : Math.round(Math.min(5, box.height) * 100) / 100 })}
        />
        All the way through
      </label>
      {issues.map((i) => (
        <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

function NumberField(props: {
  label: string;
  /** Accessible name when the visible label alone is ambiguous, e.g. "Hole 1 diameter". */
  name?: string;
  help?: string;
  value: number;
  issue?: Issue;
  onCommit: (v: number) => void;
  /** Compact fields show no help or message underneath; the caller shows messages instead. */
  compact?: boolean;
}) {
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
    <div className={props.compact ? "field compact" : "field"}>
      <label htmlFor={id}>{props.label}</label>
      <div className="input-row">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          aria-label={props.name}
          aria-invalid={severity === "error"}
          aria-describedby={props.help ? `${id}-help` : undefined}
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
      {props.compact ? (
        typingError && (
          <p className="issue error" role="alert">
            {typingError}
          </p>
        )
      ) : message ? (
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
