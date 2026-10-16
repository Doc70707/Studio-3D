import { forwardRef, useEffect, useId, useState } from "react";
import {
  FIELD_LABELS,
  SHAPES,
  SIZE_FIELDS,
  hasErrors,
  newHole,
  newShape,
  shapesOf,
  singleBox,
  type BoxFeature,
  type Feature,
  type HoleFeature,
  type Issue,
  type ProjectDocument,
  type ShapeFeature,
  type ShapeType,
} from "@studio3d/document";
import type { Measurements } from "@studio3d/geometry";
import { Icon } from "./Icon";

const HELP: Record<string, string> = {
  width: "Left to right, along the red X axis.",
  depth: "Front to back, along the green Y axis.",
  height: "From its base up.",
  wall: "Thickness of the sides and floor. Use 0 for a solid block.",
  diameter: "Distance straight across.",
  outerDiameter: "Distance across the outside.",
  innerDiameter: "Size of the hole through the middle.",
  bottomDiameter: "Distance across the base.",
  topDiameter: "Distance across the top. Use 0 for a point.",
};

const SHAPE_ORDER: ShapeType[] = ["box", "cylinder", "tube", "cone", "sphere"];

type Patch = Partial<Record<string, number | string>>;

interface Props {
  doc: ProjectDocument;
  holes: HoleFeature[];
  issues: Issue[];
  measurements: Measurements | null;
  /** The document the shown model was built from (may lag behind `doc` while it is invalid). */
  builtDoc: ProjectDocument | null;
  /** True when the 3D view shows an older valid version than the values typed. */
  stale: boolean;
  onChange: (id: string, patch: Patch) => void;
  onAdd: (feature: Feature) => void;
  onRemove: (id: string) => void;
}

/** The left panel: every shape in the part, then its holes, then the measurements. */
export const DesignPanel = forwardRef<HTMLElement, Props>(function DesignPanel(
  { doc, holes, issues, measurements, builtDoc, stale, onChange, onAdd, onRemove },
  ref,
) {
  const shapes = shapesOf(doc);
  const [selected, setSelected] = useState<string | null>(shapes[0]?.id ?? null);
  const open = shapes.some((s) => s.id === selected) ? selected : (shapes[0]?.id ?? null);
  const general = issues.filter((i) => i.featureId === undefined);
  // New shapes go in the middle of the part, standing on top of it, so they are easy to see.
  const where = measurements
    ? {
        x: round((measurements.min[0] + measurements.max[0]) / 2),
        y: round((measurements.min[1] + measurements.max[1]) / 2),
        z: round(measurements.max[2]),
      }
    : { x: 0, y: 0, z: 0 };

  const addShape = (type: ShapeType) => {
    const s = newShape(doc, type, where);
    onAdd(s);
    setSelected(s.id);
  };

  return (
    <aside className="panel glass" aria-label="Design" ref={ref}>
      <div className="panel-scroll">
        <h2>Part</h2>
        <p className="lead">Build your part from shapes. Each one adds material or cuts it away.</p>

        <section aria-label="Shapes">
          {shapes.map((s, i) => (
            <ShapeCard
              key={s.id}
              shape={s}
              first={i === 0}
              only={shapes.length === 1}
              open={s.id === open}
              issues={issues.filter((x) => x.featureId === s.id)}
              onOpen={() => setSelected(s.id === open ? null : s.id)}
              onChange={(patch) => onChange(s.id, patch)}
              onRemove={() => onRemove(s.id)}
            />
          ))}
          <div className="add-row" role="group" aria-label="Add a shape">
            {SHAPE_ORDER.map((type) => (
              <button
                key={type}
                type="button"
                className="add"
                aria-label={`Add ${SHAPES[type].label.toLowerCase()}`}
                onClick={() => addShape(type)}
              >
                <Icon name="plus" />
                {SHAPES[type].label}
              </button>
            ))}
          </div>
        </section>

        {general.map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role="alert">
            {i.message}
          </p>
        ))}

        <section className="holes" aria-label="Holes">
          <div className="section-head">
            <h3>Holes</h3>
            <button type="button" className="add" onClick={() => onAdd(newHole(doc, where))}>
              <Icon name="plus" />
              Add hole
            </button>
          </div>
          {holes.length === 0 && (
            <p className="help">Add a hole for a screw, a drain or a cable. Holes go straight down from the top of the part.</p>
          )}
          {holes.map((h) => (
            <HoleCard
              key={h.id}
              hole={h}
              issues={issues.filter((i) => i.featureId === h.id)}
              onChange={(patch) => onChange(h.id, patch)}
              onRemove={() => onRemove(h.id)}
            />
          ))}
        </section>

        {stale && hasErrors(issues) && (
          <p className="help">The 3D view shows your last valid design until the highlighted values are fixed.</p>
        )}
      </div>
      {builtDoc && <Facts box={singleBox(builtDoc)} measurements={measurements} />}
    </aside>
  );
});

const round = (n: number) => Math.round(n * 100) / 100;
const mm = (n: number) => `${round(n)}`;

/** A short description of a shape's size, shown when its card is closed. */
function summary(s: ShapeFeature): string {
  switch (s.type) {
    case "box":
      return `${mm(s.width)} × ${mm(s.depth)} × ${mm(s.height)} mm${s.wall > 0 ? `, ${mm(s.wall)} walls` : ""}`;
    case "cylinder":
      return `Ø${mm(s.diameter)} × ${mm(s.height)} mm`;
    case "tube":
      return `Ø${mm(s.outerDiameter)} / Ø${mm(s.innerDiameter)} × ${mm(s.height)} mm`;
    case "cone":
      return `Ø${mm(s.bottomDiameter)} to Ø${mm(s.topDiameter)} × ${mm(s.height)} mm`;
    case "sphere":
      return `Ø${mm(s.diameter)} mm`;
  }
}

function ShapeCard(props: {
  shape: ShapeFeature;
  first: boolean;
  only: boolean;
  open: boolean;
  issues: Issue[];
  onOpen: () => void;
  onChange: (patch: Patch) => void;
  onRemove: () => void;
}) {
  const { shape: s, issues, onChange } = props;
  const value = (k: string) => (s as unknown as Record<string, number>)[k]!;
  const issueFor = (k: string) => issues.find((i) => i.field === k);
  const bad = hasErrors(issues);
  const loose = issues.filter((i) => i.field === null || i.field === "mode" || (!props.open && i.field !== null));
  return (
    <div className={`shape-card${props.open ? " open" : ""}${bad ? " has-error" : ""}`} data-testid="shape">
      <div className="shape-head">
        <button type="button" className="shape-toggle" aria-expanded={props.open} onClick={props.onOpen}>
          <span className={`mode-dot ${s.mode}`} aria-hidden="true" />
          <span className="shape-name">{s.name}</span>
          <span className="shape-summary">
            {s.mode === "cut" ? "Cut · " : ""}
            {summary(s)}
          </span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${s.name}`}
          title={props.only ? "A part needs at least one shape" : "Remove this shape"}
          onClick={props.onRemove}
          disabled={props.only}
        >
          <Icon name="trash" />
        </button>
      </div>
      {props.open && (
        <div className="shape-body">
          <div className="segmented-small" role="group" aria-label={`${s.name} adds or cuts`}>
            <button type="button" aria-pressed={s.mode === "add"} onClick={() => onChange({ mode: "add" })}>
              Add material
            </button>
            <button
              type="button"
              aria-pressed={s.mode === "cut"}
              onClick={() => onChange({ mode: "cut" })}
              disabled={props.first}
              title={props.first ? "The first shape is what the others add to or cut from" : "Cut this shape away from the part"}
            >
              Cut away
            </button>
          </div>
          {SIZE_FIELDS[s.type].map((k) => (
            <NumberField
              key={k}
              label={FIELD_LABELS[k]!}
              help={HELP[k]}
              value={value(k)}
              issue={issueFor(k)}
              onCommit={(v) => onChange({ [k]: v })}
            />
          ))}
          <div className="position">
            <span className="position-title">Position (mm)</span>
            <div className="hole-grid three">
              {(["x", "y", "z"] as const).map((k) => (
                <NumberField
                  key={k}
                  label={FIELD_LABELS[k]!}
                  value={value(k)}
                  issue={issueFor(k)}
                  onCommit={(v) => onChange({ [k]: v })}
                  compact
                />
              ))}
            </div>
            <p className="help">
              From the centre of the build plate to the middle of the shape's base. Lift raises it off the plate.
            </p>
            {(["x", "y", "z"] as const).map((k) => {
              const i = issueFor(k);
              return i ? (
                <p key={k} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
                  {i.message}
                </p>
              ) : null;
            })}
          </div>
        </div>
      )}
      {loose.map((i) => (
        <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

function HoleCard(props: { hole: HoleFeature; issues: Issue[]; onChange: (patch: Patch) => void; onRemove: () => void }) {
  const { hole, issues, onChange } = props;
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
          label="Left / right"
          name={`${hole.name} left / right position`}
          value={hole.x}
          issue={issueFor("x")}
          onCommit={(v) => onChange({ x: v })}
          compact
        />
        <NumberField
          label="Front / back"
          name={`${hole.name} front / back position`}
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
        <input type="checkbox" checked={through} onChange={(e) => onChange({ depth: e.target.checked ? 0 : 5 })} />
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

  // Follow outside changes (open, new project, undo) without fighting the user's typing.
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

function Facts({ box, measurements }: { box: BoxFeature | null; measurements: Measurements | null }) {
  if (!measurements) return null;
  const [x, y, z] = measurements.size;
  return (
    <dl className="facts" data-testid="measurements">
      <dt>Outside size</dt>
      <dd>
        {mm(x)} × {mm(y)} × {mm(z)} mm
      </dd>
      {box && box.wall > 0 && (
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
