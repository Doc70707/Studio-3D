import { forwardRef, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FIT,
  FIELD_LABELS,
  OPEN_SIDES,
  THREADS,
  THREAD_SIZES,
  threadLabel,
  SHAPES,
  SIZE_FIELDS,
  PROFILE_LABELS,
  hasErrors,
  newHole,
  newHollow,
  newEdgeStep,
  isEdgeStep,
  EDGE_SETS,
  type EdgeFeature,
  newShape,
  shapesOf,
  singleBox,
  type BoxFeature,
  type Feature,
  type HoleFeature,
  type HollowFeature,
  type Issue,
  type ProjectDocument,
  type ShapeFeature,
  type ShapeType,
  type SketchFeature,
  type ThreadSize,
} from "@studio3d/document";
import type { Measurements } from "@studio3d/geometry";
import { Icon } from "./Icon";
import { NumberField } from "./NumberField";

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

export const SHAPE_ORDER: ShapeType[] = ["box", "cylinder", "tube", "cone", "sphere"];

type Patch = Record<string, unknown>;

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
  onSketchOnFace: () => void;
  onSketchOnPlate: () => void;
  onEditSketch: (id: string) => void;
  /** Waiting for a face to be clicked. */
  picking: boolean;
  /** Tells which shape or hole is being worked on, so the 3D view can show its measurements. */
  onFocus: (id: string | null) => void;
  /** The step picked in the 3D view (or by opening its card); its card opens and scrolls into sight. */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** The left panel: every shape in the part, then its holes, then the measurements. */
export const DesignPanel = forwardRef<HTMLElement, Props>(function DesignPanel(
  {
    doc,
    holes,
    issues,
    measurements,
    builtDoc,
    stale,
    onChange,
    onAdd,
    onRemove,
    onFocus,
    selected: picked,
    onSelect,
    ...sketching
  },
  ref,
) {
  const shapes = shapesOf(doc);
  const sketches = doc.features.filter((f): f is SketchFeature => f.type === "sketch");
  const hollows = doc.features.filter((f): f is HollowFeature => f.type === "hollow");
  const edgeSteps = doc.features.filter(isEdgeStep);
  const [selected, setSelected] = useState<string | null>(shapes[0]?.id ?? null);
  const open = shapes.some((s) => s.id === selected) ? selected : (shapes[0]?.id ?? null);
  const [holeFocus, setHoleFocus] = useState<string | null>(null);
  const focused = holes.some((h) => h.id === holeFocus) ? holeFocus : open;
  useEffect(() => onFocus(focused), [focused, onFocus]);
  // A piece clicked in the 3D view opens its card and brings it into sight.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    const f = doc.features.find((x) => x.id === picked);
    if (f?.type === "hole") setHoleFocus(picked);
    else if (f) {
      setHoleFocus(null);
      if (f.type !== "sketch" && f.type !== "hollow" && !isEdgeStep(f)) setSelected(picked);
    }
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-feature-id="${picked}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    // Only when another piece is picked, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  const general = issues.filter((i) => i.featureId === undefined);
  const where = placeNew(measurements);

  const addShape = (type: ShapeType) => {
    const s = newShape(doc, type, where);
    onAdd(s);
    setSelected(s.id);
    setHoleFocus(null);
    onSelect(s.id);
  };

  return (
    <aside className="panel glass" aria-label="Design" ref={ref}>
      <div className="panel-scroll" ref={scroller}>
        <h2>Part</h2>
        <p className="lead">Build your part from shapes. Each one adds material or cuts it away.</p>

        {doc.features.length === 0 && (
          <p className="help" data-testid="empty-plate">
            The plate is empty. Add a shape below, or draw an outline on the plate, to start a new part.
          </p>
        )}
        <section aria-label="Shapes">
          {shapes.map((s) => (
            <ShapeCard
              key={s.id}
              shape={s}
              first={doc.features[0]?.id === s.id}
              open={s.id === open}
              picked={s.id === picked}
              issues={issues.filter((x) => x.featureId === s.id)}
              onOpen={() => {
                setSelected(s.id === open ? null : s.id);
                setHoleFocus(null);
                onSelect(s.id === open ? null : s.id);
              }}
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

        <section className="sketches" aria-label="Sketches">
          <div className="section-head">
            <h3>Sketches</h3>
          </div>
          <div className="add-row" role="group" aria-label="Start a sketch">
            <button
              type="button"
              className="add"
              aria-pressed={sketching.picking}
              onClick={sketching.onSketchOnFace}
              disabled={!measurements}
            >
              <Icon name="face" />
              Sketch on a face
            </button>
            <button type="button" className="add" onClick={sketching.onSketchOnPlate}>
              <Icon name="pencil" />
              Draw on the plate
            </button>
          </div>
          {sketches.length === 0 && (
            <p className="help">
              Draw rectangles, circles or any outline on a flat face, then push it out (for a bracket or a boss) or cut
              it in (for a pocket, slot or hole).
            </p>
          )}
          {sketches.map((sk) => (
            <SketchCard
              key={sk.id}
              sketch={sk}
              picked={sk.id === picked}
              onPick={() => onSelect(sk.id)}
              first={doc.features[0]?.id === sk.id}
              issues={issues.filter((i) => i.featureId === sk.id)}
              onChange={(patch) => onChange(sk.id, patch)}
              onEdit={() => sketching.onEditSketch(sk.id)}
              onRemove={() => onRemove(sk.id)}
            />
          ))}
        </section>

        <section className="hollows" aria-label="Hollow">
          <div className="section-head">
            <h3>Hollow</h3>
            {hollows.length === 0 && (
              <button type="button" className="add" onClick={() => onAdd(newHollow(doc))}>
                <Icon name="hollow" />
                Hollow out
              </button>
            )}
          </div>
          {hollows.length === 0 && (
            <p className="help">
              Empty out the inside of the part, leaving walls of the thickness you choose. Saves material and print
              time, or makes a cup, a case or a planter.
            </p>
          )}
          {hollows.map((h) => (
            <HollowCard
              key={h.id}
              hollow={h}
              picked={h.id === picked}
              onPick={() => onSelect(h.id)}
              issues={issues.filter((i) => i.featureId === h.id)}
              onChange={(patch) => onChange(h.id, patch)}
              onRemove={() => onRemove(h.id)}
            />
          ))}
        </section>

        <section className="edges" aria-label="Edges">
          <div className="section-head">
            <h3>Edges</h3>
            <div className="add-row compact">
              <button
                type="button"
                className="add"
                onClick={() => onAdd(newEdgeStep(doc, "fillet"))}
                disabled={!measurements}
                title="Round edges of the part"
              >
                <Icon name="fillet" />
                Fillet
              </button>
              <button
                type="button"
                className="add"
                onClick={() => onAdd(newEdgeStep(doc, "chamfer"))}
                disabled={!measurements}
                title="Bevel edges of the part"
              >
                <Icon name="chamfer" />
                Chamfer
              </button>
            </div>
          </div>
          {edgeSteps.length === 0 && (
            <p className="help">
              Round (fillet) or bevel (chamfer) edges. Rounded corners are stronger and nicer to hold; a small chamfer
              on the bottom edges stops the first layer squashing out.
            </p>
          )}
          {edgeSteps.map((e) => (
            <EdgeCard
              key={e.id}
              step={e}
              picked={e.id === picked}
              onPick={() => onSelect(e.id)}
              issues={issues.filter((i) => i.featureId === e.id)}
              onChange={(patch) => onChange(e.id, patch)}
              onRemove={() => onRemove(e.id)}
            />
          ))}
        </section>

        <section className="holes" aria-label="Holes">
          <div className="section-head">
            <h3>Holes</h3>
            <button type="button" className="add" onClick={() => onAdd(newHole(doc, where))}>
              <Icon name="plus" />
              Add hole
            </button>
          </div>
          {holes.length === 0 && (
            <p className="help">
              Add a hole for a screw, a drain or a cable. Holes go straight down from the top of the part.
            </p>
          )}
          {holes.map((h) => (
            <HoleCard
              key={h.id}
              hole={h}
              focused={h.id === focused}
              picked={h.id === picked}
              onFocus={() => {
                setHoleFocus(h.id);
                if (h.id !== picked) onSelect(h.id);
              }}
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

/** New shapes go in the middle of the part, standing on top of it, so they are easy to see. */
export function placeNew(measurements: Measurements | null): { x: number; y: number; z: number } {
  if (!measurements) return { x: 0, y: 0, z: 0 };
  return {
    x: round((measurements.min[0] + measurements.max[0]) / 2),
    y: round((measurements.min[1] + measurements.max[1]) / 2),
    z: round(measurements.max[2]),
  };
}
const mm = (n: number) => `${round(n)}`;

/** A short description of a shape's size, shown when its card is closed. */
function summary(s: ShapeFeature): string {
  switch (s.type) {
    case "box":
      return `${mm(s.width)} × ${mm(s.depth)} × ${mm(s.height)} mm${s.wall > 0 ? `, ${mm(s.wall)} walls` : ""}`;
    case "cylinder":
      if (s.thread) return `${s.thread} ${s.mode === "add" ? "threaded rod" : "thread"} × ${mm(s.height)} mm`;
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
  open: boolean;
  picked: boolean;
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
    <div
      className={`shape-card${props.open ? " open" : ""}${props.picked ? " picked" : ""}${bad ? " has-error" : ""}`}
      data-testid="shape"
      data-feature-id={s.id}
    >
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
          title="Remove this shape"
          onClick={props.onRemove}
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
              title={
                props.first
                  ? "The first shape is what the others add to or cut from"
                  : "Cut this shape away from the part"
              }
            >
              Cut away
            </button>
          </div>
          {SIZE_FIELDS[s.type]
            .filter((k) => !(s.type === "cylinder" && s.thread && k === "diameter"))
            .map((k) => (
              <NumberField
                key={k}
                label={FIELD_LABELS[k]!}
                help={HELP[k]}
                value={value(k)}
                issue={issueFor(k)}
                onCommit={(v) => onChange({ [k]: v })}
              />
            ))}
          {s.type === "cylinder" && (
            <ThreadPicker
              id={s.id}
              name={s.name}
              thread={s.thread}
              fit={s.fit}
              help={
                s.mode === "add"
                  ? "Turns the cylinder into a threaded rod, like a bolt without a head."
                  : "Cuts a threaded hole that a bolt of this size screws into."
              }
              issues={issues}
              onChange={onChange}
            />
          )}
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

const surfaceWord = (sk: SketchFeature) => (sk.surface === "plate" ? "plate" : "face");

/** The hollow step: how thick the walls are and which side is left open. */
function HollowCard(props: {
  hollow: HollowFeature;
  picked: boolean;
  onPick: () => void;
  issues: Issue[];
  onChange: (patch: Patch) => void;
  onRemove: () => void;
}) {
  const { hollow: h, issues, onChange } = props;
  const side = OPEN_SIDES.find((o) => o.side === h.open);
  const summary = h.open === "none" ? "closed inside" : `open at the ${h.open}`;
  const openIssue = issues.find((i) => i.field === "open");
  const general = issues.filter((i) => i.field !== "open" && i.field !== "wall");
  return (
    <div
      className={`shape-card open${props.picked ? " picked" : ""}${hasErrors(issues) ? " has-error" : ""}`}
      data-testid="hollow"
      data-feature-id={h.id}
      onPointerDown={props.onPick}
    >
      <div className="shape-head">
        <span className="shape-toggle static">
          <span className="mode-dot cut" aria-hidden="true" />
          <span className="shape-name">{h.name}</span>
          <span className="shape-summary">
            {mm(h.wall)} mm walls · {summary}
          </span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${h.name}`}
          title="Make the part solid again"
          onClick={props.onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="shape-body">
        <NumberField
          label="Wall thickness"
          name={`${h.name} wall thickness`}
          help="How thick the walls, floor and roof are left."
          value={h.wall}
          issue={issues.find((i) => i.field === "wall")}
          onCommit={(wall) => onChange({ wall })}
        />
        <div className="field">
          <label htmlFor={`${h.id}-open`}>Open side</label>
          <div className="input-row select-row">
            <select
              id={`${h.id}-open`}
              value={h.open}
              aria-invalid={openIssue ? true : undefined}
              onChange={(e) => onChange({ open: e.target.value })}
            >
              {OPEN_SIDES.map((o) => (
                <option key={o.side} value={o.side}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <p className={openIssue ? `issue ${openIssue.severity}` : "help"} role={openIssue ? "alert" : undefined}>
            {openIssue?.message ??
              (side?.side === "none"
                ? "Every outside face stays. Resin prints will need a drain hole."
                : "The flat face on this side is removed so you can reach inside.")}
          </p>
        </div>
        {general.map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role="alert">
            {i.message}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A sketch in the list: what it does and how far, with the drawing itself edited on the sketch screen. */
function SketchCard(props: {
  sketch: SketchFeature;
  picked: boolean;
  onPick: () => void;
  first: boolean;
  issues: Issue[];
  onChange: (patch: Patch) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { sketch: sk, issues, onChange } = props;
  const counts = new Map<string, number>();
  for (const p of sk.profiles) counts.set(PROFILE_LABELS[p.kind], (counts.get(PROFILE_LABELS[p.kind]) ?? 0) + 1);
  const what =
    [...counts].map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ") || "empty";
  const how =
    sk.mode === "add" ? `out ${mm(sk.depth)} mm` : sk.depth === 0 ? "cut through" : `cut ${mm(sk.depth)} mm deep`;
  const canCut = !props.first && sk.surface !== "plate";
  return (
    <div
      className={`shape-card open${props.picked ? " picked" : ""}${hasErrors(issues) ? " has-error" : ""}`}
      data-testid="sketch"
      data-feature-id={sk.id}
      onPointerDown={props.onPick}
    >
      <div className="shape-head">
        <span className="shape-toggle static">
          <span className={`mode-dot ${sk.mode}`} aria-hidden="true" />
          <span className="shape-name">{sk.name}</span>
          <span className="shape-summary">
            On the {sk.surface} · {what} · {how}
          </span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Edit ${sk.name}`}
          title="Edit the drawing"
          onClick={props.onEdit}
        >
          <Icon name="pencil" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${sk.name}`}
          title="Remove this sketch"
          onClick={props.onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="shape-body">
        <div className="segmented-small" role="group" aria-label={`${sk.name} pushes out or cuts in`}>
          <button
            type="button"
            aria-pressed={sk.mode === "add"}
            onClick={() => onChange({ mode: "add", depth: sk.depth || 5 })}
          >
            Push out
          </button>
          <button
            type="button"
            aria-pressed={sk.mode === "cut"}
            onClick={() => onChange({ mode: "cut" })}
            disabled={!canCut}
            title={canCut ? "Cut the drawing into the part" : "Only a sketch on a face of the part can cut into it"}
          >
            Cut in
          </button>
        </div>
        {!(sk.mode === "cut" && sk.depth === 0) && (
          <NumberField
            label={sk.mode === "add" ? "Height" : "Depth"}
            name={`${sk.name} ${sk.mode === "add" ? "height" : "depth"}`}
            help={
              sk.mode === "add"
                ? `How far it sticks out of the ${surfaceWord(sk)}.`
                : `How far it cuts into the ${surfaceWord(sk)}.`
            }
            value={sk.depth}
            issue={issues.find((i) => i.field === "depth")}
            onCommit={(v) => onChange({ depth: v })}
          />
        )}
        {sk.mode === "cut" && (
          <label className="check">
            <input
              type="checkbox"
              checked={sk.depth === 0}
              onChange={(e) => onChange({ depth: e.target.checked ? 0 : 5 })}
            />
            All the way through
          </label>
        )}
      </div>
      {issues
        .filter((i) => i.field !== "depth" || (sk.mode === "cut" && sk.depth === 0))
        .map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
            {i.message}
          </p>
        ))}
    </div>
  );
}

function HoleCard(props: {
  hole: HoleFeature;
  focused: boolean;
  picked: boolean;
  onFocus: () => void;
  issues: Issue[];
  onChange: (patch: Patch) => void;
  onRemove: () => void;
}) {
  const { hole, issues, onChange } = props;
  const through = hole.depth === 0;
  const issueFor = (field: keyof HoleFeature) => issues.find((i) => i.field === field);
  return (
    <div
      className={`hole-card${props.focused ? " focused" : ""}${props.picked ? " picked" : ""}`}
      data-testid="hole"
      data-feature-id={hole.id}
      onFocusCapture={props.onFocus}
      onPointerDown={props.onFocus}
    >
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
        {!hole.thread && (
          <NumberField
            label="Diameter"
            name={`${hole.name} diameter`}
            value={hole.diameter}
            issue={issueFor("diameter")}
            onCommit={(v) => onChange({ diameter: v })}
            compact
          />
        )}
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
      <ThreadPicker
        id={hole.id}
        name={hole.name}
        thread={hole.thread}
        fit={hole.fit}
        help="Cuts a thread inside the hole that a bolt of this size screws into."
        issues={issues}
        onChange={onChange}
        compact
      />
      {issues.map((i) => (
        <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

/**
 * Picks an ISO metric thread (or none) and, with a thread, how much room to leave so printed threads turn.
 * Choosing a size also sets the plain diameter to match, so switching the thread off keeps the same size.
 */
function ThreadPicker(props: {
  id: string;
  name: string;
  thread: ThreadSize | undefined;
  fit: number | undefined;
  help: string;
  issues: Issue[];
  onChange: (patch: Patch) => void;
  compact?: boolean;
}) {
  const { thread, issues, onChange } = props;
  const threadIssue = issues.find((i) => i.field === "thread");
  return (
    <div className="thread-picker">
      <div className={props.compact ? "field compact" : "field"}>
        <label htmlFor={`${props.id}-thread`}>Thread</label>
        <div className="input-row select-row">
          <select
            id={`${props.id}-thread`}
            aria-label={`${props.name} thread`}
            value={thread ?? ""}
            aria-invalid={threadIssue ? true : undefined}
            onChange={(e) => {
              const size = e.target.value as ThreadSize | "";
              onChange(
                size
                  ? { thread: size, fit: props.fit ?? DEFAULT_FIT, diameter: THREADS[size].diameter }
                  : { thread: undefined, fit: undefined },
              );
            }}
          >
            <option value="">None (smooth)</option>
            {THREAD_SIZES.map((size) => (
              <option key={size} value={size}>
                {threadLabel(size)}
              </option>
            ))}
          </select>
        </div>
        {!props.compact && <p className="help">{props.help}</p>}
      </div>
      {thread && (
        <NumberField
          label="Fit clearance"
          name={`${props.name} fit clearance`}
          help="Extra room so printed threads turn. 0.2 to 0.4 mm suits most printers; 0 is the exact ISO size."
          value={props.fit ?? 0}
          issue={issues.find((i) => i.field === "fit")}
          onCommit={(fit) => onChange({ fit })}
          compact={props.compact}
        />
      )}
      {thread && <p className="help">Threads take a few seconds to build the first time.</p>}
    </div>
  );
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

/** A fillet or chamfer: its size, and which edges it goes on. */
function EdgeCard(props: {
  step: EdgeFeature;
  picked: boolean;
  onPick: () => void;
  issues: Issue[];
  onChange: (patch: Patch) => void;
  onRemove: () => void;
}) {
  const { step: e, issues, onChange } = props;
  const fillet = e.type === "fillet";
  const set = EDGE_SETS.find((x) => x.edges === e.edges);
  const edgesIssue = issues.find((i) => i.field === "edges");
  const general = issues.filter((i) => i.field !== "edges" && i.field !== "size");
  return (
    <div
      className={`shape-card open${props.picked ? " picked" : ""}${hasErrors(issues) ? " has-error" : ""}`}
      data-testid="edge-step"
      data-feature-id={e.id}
      onPointerDown={props.onPick}
    >
      <div className="shape-head">
        <span className="shape-toggle static">
          <span className="mode-dot cut" aria-hidden="true" />
          <span className="shape-name">{e.name}</span>
          <span className="shape-summary">
            {mm(e.size)} mm · {set?.label.toLowerCase() ?? "edges"}
          </span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${e.name}`}
          title={fillet ? "Make these edges sharp again" : "Remove the bevel"}
          onClick={props.onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="shape-body">
        <NumberField
          label={fillet ? "Radius" : "Size"}
          name={`${e.name} size`}
          help={fillet ? "How round the edges are." : "How far the bevel cuts back along each face."}
          value={e.size}
          issue={issues.find((i) => i.field === "size")}
          onCommit={(size) => onChange({ size })}
        />
        <div className="field">
          <label htmlFor={`${e.id}-edges`}>Edges</label>
          <div className="input-row select-row">
            <select
              id={`${e.id}-edges`}
              value={e.edges}
              aria-invalid={edgesIssue ? true : undefined}
              onChange={(ev) => onChange({ edges: ev.target.value })}
            >
              {EDGE_SETS.map((x) => (
                <option key={x.edges} value={x.edges}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <p className={edgesIssue ? `issue ${edgesIssue.severity}` : "help"} role={edgesIssue ? "alert" : undefined}>
            {edgesIssue?.message ?? set?.help}
          </p>
        </div>
        {general.map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role="alert">
            {i.message}
          </p>
        ))}
      </div>
    </div>
  );
}
