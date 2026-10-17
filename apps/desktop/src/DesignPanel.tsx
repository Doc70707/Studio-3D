import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
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
  newMirror,
  newPattern,
  isCopyStep,
  isShape,
  isCopyable,
  isEdgeStep,
  type MirrorFeature,
  type PatternFeature,
  EDGE_SETS,
  type EdgeFeature,
  newShape,
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
import { Icon, type IconName } from "./Icon";
import { NumberField } from "./NumberField";

/** Tooltips for shape sizes: shown on hover, so the panel itself stays short. */
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
  onRevolve: () => void;
  onEditSketch: (id: string) => void;
  /** Waiting for a face to be clicked. */
  picking: boolean;
  /** Tells which step is being worked on, so the 3D view can show its measurements. */
  onFocus: (id: string | null) => void;
  /** The step picked in the 3D view (or in the list); its properties are shown. */
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** The test id each kind of step's row carries (kept from the card layout, which tests and tools look for). */
const ROW_TEST_ID = (f: Feature) =>
  isShape(f) ? "shape" : isEdgeStep(f) ? "edge-step" : isCopyStep(f) ? "copy-step" : f.type;

/**
 * The left panel, in three parts: a toolbar to add things, the steps of the part in the order they are built (one
 * line each), and the properties of the one step being worked on. The part's size and volume sit underneath.
 */
export const DesignPanel = forwardRef<HTMLElement, Props>(function DesignPanel(
  {
    doc,
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
  const features = doc.features;
  // The step whose properties are shown: the one picked, else the last one looked at, else the first.
  const [last, setLast] = useState<string | null>(null);
  const current =
    features.find((f) => f.id === picked) ?? features.find((f) => f.id === last) ?? features[0] ?? null;
  useEffect(() => {
    if (picked) setLast(picked);
  }, [picked]);
  const currentId = current?.id ?? null;
  useEffect(() => onFocus(currentId), [currentId, onFocus]);

  // A step picked in the 3D view is brought into sight in the list.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked) return;
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-feature-id="${picked}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [picked]);

  const general = issues.filter((i) => i.featureId === undefined);
  const where = placeNew(measurements);
  const source = copySource(doc, picked);
  const hasHollow = features.some((f) => f.type === "hollow");
  const add = (f: Feature) => {
    onAdd(f);
    setLast(f.id);
    onSelect(f.id);
  };
  const tools: (ToolButton | "gap" | "break")[] = [
    ...SHAPE_ORDER.map((type) => ({
      icon: type,
      label: `Add ${SHAPES[type].label.toLowerCase()}`,
      onClick: () => add(newShape(doc, type, where)),
    })),
    { icon: "hole", label: "Add hole", onClick: () => add(newHole(doc, where)) },
    "break",
    {
      icon: "face",
      label: "Sketch on a face",
      onClick: sketching.onSketchOnFace,
      pressed: sketching.picking,
      disabled: !measurements,
      reason: "Add a shape first",
    },
    { icon: "pencil", label: "Draw on the plate", onClick: sketching.onSketchOnPlate },
    { icon: "revolve", label: "Revolve", onClick: sketching.onRevolve },
    "gap",
    {
      icon: "hollow",
      label: "Hollow out",
      onClick: () => add(newHollow(doc)),
      disabled: hasHollow || !measurements,
      reason: hasHollow ? "The part is already hollowed" : "Add a shape first",
    },
    {
      icon: "fillet",
      label: "Fillet",
      title: "Fillet: round edges",
      onClick: () => add(newEdgeStep(doc, "fillet")),
      disabled: !measurements,
      reason: "Add a shape first",
    },
    {
      icon: "chamfer",
      label: "Chamfer",
      title: "Chamfer: bevel edges",
      onClick: () => add(newEdgeStep(doc, "chamfer")),
      disabled: !measurements,
      reason: "Add a shape first",
    },
    {
      icon: "pattern",
      label: "Pattern",
      title: source ? `Pattern: repeat ${source.name}` : "Pattern",
      onClick: () => source && add(newPattern(doc, source.id, placeNew(measurements))),
      disabled: !source,
      reason: "Add a shape, hole or sketch first",
    },
    {
      icon: "mirror",
      label: "Mirror",
      title: source ? `Mirror: copy ${source.name} to the other side` : "Mirror",
      onClick: () => source && add(newMirror(doc, source.id, placeNew(measurements).x)),
      disabled: !source,
      reason: "Add a shape, hole or sketch first",
    },
  ];

  const issuesOf = (id: string) => issues.filter((i) => i.featureId === id);
  return (
    <aside className="panel glass" aria-label="Design" ref={ref}>
      <div className="panel-tools" role="toolbar" aria-label="Add to the part">
        {tools.map((t, i) =>
          t === "gap" || t === "break" ? (
            <span key={`${t}${i}`} className={`tool-${t}`} aria-hidden="true" />
          ) : (
            <button
              key={t.label}
              type="button"
              className="tool"
              aria-label={t.label}
              aria-pressed={t.pressed}
              title={t.disabled ? `${t.title ?? t.label} (${t.reason})` : (t.title ?? t.label)}
              disabled={t.disabled}
              onClick={t.onClick}
            >
              <Icon name={t.icon} />
            </button>
          ),
        )}
      </div>
      <div className="panel-scroll" ref={scroller}>
        <h2 className="panel-title">Steps</h2>
        {features.length === 0 ? (
          <p className="empty" data-testid="empty-plate">
            Empty plate. Add a shape to start.
          </p>
        ) : (
          <ol className="steps" aria-label="Steps">
            {features.map((f) => (
              <StepRow
                key={f.id}
                step={f}
                doc={doc}
                current={f.id === currentId}
                picked={f.id === picked}
                problem={issuesOf(f.id).find((i) => i.severity === "error")?.message}
                onPick={() => {
                  setLast(f.id);
                  onSelect(f.id);
                }}
                onRemove={() => onRemove(f.id)}
              />
            ))}
          </ol>
        )}
        {general.map((i) => (
          <p key={i.message} className={`issue ${i.severity}`} role="alert">
            {i.message}
          </p>
        ))}
        {current && (
          <section className="props" data-testid="properties" aria-label={`${current.name} properties`}>
            <h3 className="props-title">
              <Icon name={iconOf(current)} />
              {current.name}
              {current.type === "sketch" && (
                <button
                  type="button"
                  className="small"
                  aria-label={`Edit ${current.name}`}
                  title="Edit the drawing"
                  onClick={() => sketching.onEditSketch(current.id)}
                >
                  <Icon name="pencil" />
                  Edit
                </button>
              )}
            </h3>
            <Properties
              key={current.id}
              step={current}
              doc={doc}
              issues={issuesOf(current.id)}
              onChange={(patch) => onChange(current.id, patch)}
            />
          </section>
        )}
        {stale && hasErrors(issues) && (
          <p className="help">The 3D view shows your last valid design until the highlighted values are fixed.</p>
        )}
      </div>
      {builtDoc && <Facts box={singleBox(builtDoc)} measurements={measurements} />}
    </aside>
  );
});

interface ToolButton {
  icon: IconName;
  label: string;
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  reason?: string;
}

const iconOf = (f: Feature): IconName =>
  isShape(f) ? f.type : f.type === "sketch" ? (f.revolve !== undefined ? "revolve" : "pencil") : f.type;

/** One line in the list of steps: what it is and its main sizes; click to work on it. */
function StepRow(props: {
  step: Feature;
  doc: ProjectDocument;
  current: boolean;
  picked: boolean;
  /** The step's first error, shown on its line unless its properties are open (where the full detail is). */
  problem: string | undefined;
  onPick: () => void;
  onRemove: () => void;
}) {
  const f = props.step;
  const cls = `step${props.current ? " current" : ""}${props.picked ? " picked" : ""}${props.problem ? " has-error" : ""}`;
  return (
    <li
      className={cls}
      data-testid={ROW_TEST_ID(f)}
      data-feature-id={f.id}
    >
      <button type="button" className="step-main" aria-current={props.current || undefined} onClick={props.onPick}>
        <span className={`step-icon ${"mode" in f && f.mode === "cut" ? "cut" : ""}`} aria-hidden="true">
          <Icon name={iconOf(f)} />
        </span>
        <span className="step-name">{f.name}</span>
        <span className="step-summary">{stepSummary(f, props.doc)}</span>
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${f.name}`}
        title={isCopyStep(f) ? "Remove the copies (the original stays)" : "Remove"}
        onClick={props.onRemove}
      >
        <Icon name="trash" />
      </button>
      {props.problem && !props.current && <p className="issue error step-problem">{props.problem}</p>}
    </li>
  );
}

/** The editable values of one step. */
function Properties(props: { step: Feature; doc: ProjectDocument; issues: Issue[]; onChange: (patch: Patch) => void }) {
  const { step: f, doc, issues, onChange } = props;
  const first = doc.features[0]?.id === f.id;
  if (isShape(f)) return <ShapeProps shape={f} first={first} issues={issues} onChange={onChange} />;
  if (f.type === "hole") return <HoleProps hole={f} issues={issues} onChange={onChange} />;
  if (f.type === "sketch") return <SketchProps sketch={f} first={first} issues={issues} onChange={onChange} />;
  if (f.type === "hollow") return <HollowProps hollow={f} issues={issues} onChange={onChange} />;
  if (isEdgeStep(f)) return <EdgeProps step={f} issues={issues} onChange={onChange} />;
  if (isCopyStep(f)) return <CopyProps step={f} doc={doc} issues={issues} onChange={onChange} />;
  return null;
}

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

/** A short description of a shape's size. */
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

function sketchSummary(sk: SketchFeature): string {
  const counts = new Map<string, number>();
  for (const p of sk.profiles) counts.set(PROFILE_LABELS[p.kind], (counts.get(PROFILE_LABELS[p.kind]) ?? 0) + 1);
  const what =
    [...counts].map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ") || "empty";
  const how =
    sk.revolve !== undefined
      ? `${sk.mode === "add" ? "spun" : "cut"} ${mm(sk.revolve)}°`
      : sk.mode === "add"
        ? `out ${mm(sk.depth)} mm`
        : sk.depth === 0
          ? "cut through"
          : `cut ${mm(sk.depth)} mm deep`;
  return `On the ${sk.surface} · ${what} · ${how}`;
}

/** What a step's row says about it. */
function stepSummary(f: Feature, doc: ProjectDocument): string {
  if (isShape(f)) return `${f.mode === "cut" ? "Cut · " : ""}${summary(f)}`;
  switch (f.type) {
    case "hole":
      return `${f.thread ?? `Ø${mm(f.diameter)}`} · ${f.depth === 0 ? "through" : `${mm(f.depth)} mm deep`}`;
    case "sketch":
      return sketchSummary(f);
    case "hollow":
      return `${mm(f.wall)} mm walls · ${f.open === "none" ? "closed inside" : `open at the ${f.open}`}`;
    case "fillet":
    case "chamfer":
      return `${mm(f.size)} mm · ${EDGE_SETS.find((x) => x.edges === f.edges)?.label.toLowerCase() ?? "edges"}`;
    case "pattern":
    case "mirror": {
      const src = doc.features.find((x) => x.id === f.source)?.name ?? "?";
      if (f.type === "mirror") return `${src} mirrored`;
      return f.kind === "grid" ? `${src} × ${f.count * f.rows}` : `${src} × ${f.count} round a circle`;
    }
  }
}

/** Messages for a step that no field shows. */
function Messages({ issues }: { issues: Issue[] }) {
  return (
    <>
      {issues.map((i) => (
        <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
          {i.message}
        </p>
      ))}
    </>
  );
}

/** Settings most parts don't need, folded away until asked for (and opened when one of them has a problem). */
function More({ children, open }: { children: ReactNode; open?: boolean }) {
  return (
    <details className="more" open={open || undefined}>
      <summary>More</summary>
      {children}
    </details>
  );
}

function ShapeProps(props: { shape: ShapeFeature; first: boolean; issues: Issue[]; onChange: (patch: Patch) => void }) {
  const { shape: s, issues, onChange } = props;
  const value = (k: string) => (s as unknown as Record<string, number>)[k]!;
  const issueFor = (k: string) => issues.find((i) => i.field === k);
  return (
    <>
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
            props.first ? "The first shape is what the others add to or cut from" : "Cut this shape away from the part"
          }
        >
          Cut away
        </button>
      </div>
      <div className="hole-grid">
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
              compact
            />
          ))}
      </div>
      {s.type === "cylinder" && (
        <ThreadPicker
          id={s.id}
          name={s.name}
          thread={s.thread}
          fit={s.fit}
          title={
            s.mode === "add"
              ? "Turns the cylinder into a threaded rod, like a bolt without a head."
              : "Cuts a threaded hole that a bolt of this size screws into."
          }
          issues={issues}
          onChange={onChange}
        />
      )}
      <div className="position" title="From the centre of the build plate to the middle of the shape's base">
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
      </div>
      <Messages issues={issues} />
    </>
  );
}

function HoleProps(props: { hole: HoleFeature; issues: Issue[]; onChange: (patch: Patch) => void }) {
  const { hole, issues, onChange } = props;
  const through = hole.depth === 0;
  const issueFor = (field: keyof HoleFeature) => issues.find((i) => i.field === field);
  return (
    <>
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
        title="Cuts a thread inside the hole that a bolt of this size screws into."
        issues={issues}
        onChange={onChange}
      />
      <Messages issues={issues} />
    </>
  );
}

/**
 * Picks an ISO metric thread (or none) and, under More, how much room to leave so printed threads turn.
 * Choosing a size also sets the plain diameter to match, so switching the thread off keeps the same size.
 */
function ThreadPicker(props: {
  id: string;
  name: string;
  thread: ThreadSize | undefined;
  fit: number | undefined;
  title: string;
  issues: Issue[];
  onChange: (patch: Patch) => void;
}) {
  const { thread, issues, onChange } = props;
  const threadIssue = issues.find((i) => i.field === "thread");
  const fitIssue = issues.find((i) => i.field === "fit");
  return (
    <div className="thread-picker">
      <div className="field compact">
        <label htmlFor={`${props.id}-thread`} title={props.title}>
          Thread
        </label>
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
      </div>
      {thread && (
        <More open={!!fitIssue}>
          <NumberField
            label="Fit clearance"
            name={`${props.name} fit clearance`}
            help="Extra room so printed threads turn. 0.2 to 0.4 mm suits most printers; 0 is the exact ISO size."
            value={props.fit ?? 0}
            issue={fitIssue}
            onCommit={(fit) => onChange({ fit })}
            compact
          />
        </More>
      )}
    </div>
  );
}

/** A sketch's settings; the drawing itself is changed on the sketch screen (Edit). */
function SketchProps(props: {
  sketch: SketchFeature;
  first: boolean;
  issues: Issue[];
  onChange: (patch: Patch) => void;
}) {
  const { sketch: sk, issues, onChange } = props;
  const spun = sk.revolve !== undefined;
  const canCut = !props.first && sk.surface !== "plate";
  const word = sk.surface === "plate" ? "plate" : "face";
  return (
    <>
      <p className="props-note">{sketchSummary(sk)}</p>
      <div className="segmented-small" role="group" aria-label={`${sk.name} pushes out or cuts in`}>
        <button
          type="button"
          aria-pressed={sk.mode === "add"}
          onClick={() => onChange({ mode: "add", depth: sk.depth || 5 })}
        >
          {spun ? "Add" : "Push out"}
        </button>
        <button
          type="button"
          aria-pressed={sk.mode === "cut"}
          onClick={() => onChange({ mode: "cut" })}
          disabled={!canCut}
          title={canCut ? "Cut the drawing into the part" : "Only a sketch on a face of the part can cut into it"}
        >
          {spun ? "Cut" : "Cut in"}
        </button>
      </div>
      {spun && (
        <NumberField
          label="Angle"
          name={`${sk.name} angle`}
          unit="°"
          help="How far round the outline spins: 360° for a whole round part."
          value={sk.revolve!}
          issue={issues.find((i) => i.field === "revolve")}
          onCommit={(v) => onChange({ revolve: v })}
        />
      )}
      {!spun && !(sk.mode === "cut" && sk.depth === 0) && (
        <NumberField
          label={sk.mode === "add" ? "Height" : "Depth"}
          name={`${sk.name} ${sk.mode === "add" ? "height" : "depth"}`}
          help={sk.mode === "add" ? `How far it sticks out of the ${word}.` : `How far it cuts into the ${word}.`}
          value={sk.depth}
          issue={issues.find((i) => i.field === "depth")}
          onCommit={(v) => onChange({ depth: v })}
        />
      )}
      {!spun && sk.mode === "cut" && (
        <label className="check">
          <input
            type="checkbox"
            checked={sk.depth === 0}
            onChange={(e) => onChange({ depth: e.target.checked ? 0 : 5 })}
          />
          All the way through
        </label>
      )}
      <Messages
        issues={issues.filter(
          (i) => (i.field !== "depth" || (sk.mode === "cut" && sk.depth === 0)) && i.field !== "revolve",
        )}
      />
    </>
  );
}

/** The hollow step: how thick the walls are and which side is left open. */
function HollowProps(props: { hollow: HollowFeature; issues: Issue[]; onChange: (patch: Patch) => void }) {
  const { hollow: h, issues, onChange } = props;
  const openIssue = issues.find((i) => i.field === "open");
  return (
    <>
      <NumberField
        label="Wall thickness"
        name={`${h.name} wall thickness`}
        help="How thick the walls, floor and roof are left."
        value={h.wall}
        issue={issues.find((i) => i.field === "wall")}
        onCommit={(wall) => onChange({ wall })}
      />
      <div className="field">
        <label
          htmlFor={`${h.id}-open`}
          title="The flat face on this side is removed so you can reach inside. None keeps every face."
        >
          Open side
        </label>
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
      </div>
      <Messages issues={issues.filter((i) => i.field !== "wall")} />
    </>
  );
}

function Facts({ box, measurements }: { box: BoxFeature | null; measurements: Measurements | null }) {
  if (!measurements) return null;
  const [x, y, z] = measurements.size;
  return (
    <dl className="facts" data-testid="measurements" aria-label="Part size (measured)">
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
function EdgeProps(props: { step: EdgeFeature; issues: Issue[]; onChange: (patch: Patch) => void }) {
  const { step: e, issues, onChange } = props;
  const fillet = e.type === "fillet";
  const set = EDGE_SETS.find((x) => x.edges === e.edges);
  const edgesIssue = issues.find((i) => i.field === "edges");
  return (
    <>
      <NumberField
        label={fillet ? "Radius" : "Size"}
        name={`${e.name} size`}
        help={fillet ? "How round the edges are." : "How far the bevel cuts back along each face."}
        value={e.size}
        issue={issues.find((i) => i.field === "size")}
        onCommit={(size) => onChange({ size })}
      />
      <div className="field">
        <label htmlFor={`${e.id}-edges`} title={set?.help}>
          Edges
        </label>
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
      </div>
      <Messages issues={issues.filter((i) => i.field !== "size")} />
    </>
  );
}

/** What a new pattern or mirror copies: the selected piece if it can be copied, else the last thing that can. */
export function copySource(doc: ProjectDocument, selected: string | null) {
  const copyable = doc.features.filter(isCopyable);
  return copyable.find((f) => f.id === selected) ?? copyable[copyable.length - 1] ?? null;
}

/** A pattern or mirror: what it copies, and where the copies go. */
function CopyProps(props: {
  step: PatternFeature | MirrorFeature;
  doc: ProjectDocument;
  issues: Issue[];
  onChange: (patch: Patch) => void;
}) {
  const { step: c, issues, onChange } = props;
  const at = props.doc.features.findIndex((f) => f.id === c.id);
  const choices = props.doc.features.slice(0, at).filter(isCopyable);
  const src = props.doc.features.find((f) => f.id === c.source);
  const issue = (field: string) => issues.find((i) => i.field === field);
  const sourceIssue = issue("source");
  const general = issues.filter((i) => i.field === null || i.field === undefined);
  const num = (key: string, label: string, value: number, help?: string, unit?: string) => (
    <NumberField
      label={label}
      name={`${c.name} ${label.toLowerCase()}`}
      help={help}
      value={value}
      unit={unit}
      issue={issue(key)}
      onCommit={(v) => onChange({ [key]: v })}
      compact
    />
  );
  const fieldIssues = issues.filter((i) => i.field && i.field !== "source");
  return (
    <>
      <div className="field">
        <label htmlFor={`${c.id}-source`}>Copies</label>
        <div className="input-row select-row">
          <select
            id={`${c.id}-source`}
            value={c.source}
            aria-invalid={sourceIssue ? true : undefined}
            onChange={(e) => onChange({ source: e.target.value })}
          >
            {!src && <option value={c.source}>(removed)</option>}
            {choices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        {sourceIssue && (
          <p className={`issue ${sourceIssue.severity}`} role="alert">
            {sourceIssue.message}
          </p>
        )}
      </div>
      {c.type === "pattern" ? (
        <>
          <div className="segmented-small" role="group" aria-label={`${c.name} layout`}>
            <button type="button" aria-pressed={c.kind === "grid"} onClick={() => onChange({ kind: "grid" })}>
              Row or grid
            </button>
            <button type="button" aria-pressed={c.kind === "circle"} onClick={() => onChange({ kind: "circle" })}>
              Round a circle
            </button>
          </div>
          {c.kind === "grid" ? (
            <div className="hole-grid">
              {num("count", "Across", c.count, "How many left to right, the original included.", "")}
              {num("spacing", "Spacing", c.spacing, "Centre to centre. Minus goes left.")}
              {num("rows", "Rows", c.rows, "How many rows, front to back.", "")}
              {num("rowSpacing", "Row spacing", c.rowSpacing, "Minus goes to the front.")}
            </div>
          ) : (
            <div className="hole-grid">
              {num("count", "Count", c.count, "How many, the original included.", "")}
              {num("angle", "Angle", c.angle, "360 spreads them all the way round.", "°")}
              {num("cx", "Centre left / right", c.cx, "Where the circle's middle is.")}
              {num("cy", "Centre front / back", c.cy)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="segmented-small" role="group" aria-label={`${c.name} direction`}>
            <button type="button" aria-pressed={c.axis === "x"} onClick={() => onChange({ axis: "x" })}>
              Left ↔ right
            </button>
            <button type="button" aria-pressed={c.axis === "y"} onClick={() => onChange({ axis: "y" })}>
              Front ↔ back
            </button>
          </div>
          {num(
            "at",
            "Mirror line",
            c.at,
            c.axis === "x" ? "Left / right position of the mirror line." : "Front / back position of the mirror line.",
          )}
        </>
      )}
      <Messages issues={[...fieldIssues, ...general]} />
    </>
  );
}
