// The 2D drawing screen: draw rectangles, circles and outlines on a face (or the plate), with sizes
// and distances shown as you go, then choose whether they push out of the face or cut into it.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PROFILE_LABELS,
  hasErrors,
  nestingDepths,
  offsetProfile,
  profileBounds,
  type Issue,
  type Mode,
  type Point2,
  type Profile,
  type SketchFeature,
} from "@studio3d/document";
import {
  anyTyped,
  liveValues,
  startPointEntry,
  startTyping,
  typedPoint,
  typeKey,
  TYPED_FIELDS,
  type Typed,
} from "./dynamicInput";
import {
  SNAP_LABELS,
  boundaryEdges,
  constrain,
  editSide,
  findSnap,
  isPointKey,
  parsePoint,
  sideOf,
  snapScene,
  type Snap,
} from "./precision";
import { Icon } from "./Icon";
import { NumberField } from "./NumberField";

/** What is being drawn: the sketch itself, plus the face it sits on (in sketch coordinates). */
export interface SketchDraft {
  feature: SketchFeature;
  isNew: boolean;
  /** The face under the sketch: triangles covering it, and its size. Null on the plate. */
  face: { triangles: Point2[]; width: number; height: number } | null;
  /** Area to show when there is no face: [minX, minY, maxX, maxY]. */
  area: [number, number, number, number];
}

type Tool = "select" | "rectangle" | "circle" | "polygon";
type Pending =
  | { kind: "rectangle" | "circle"; start: Point2; pressed: boolean }
  | { kind: "polygon"; points: Point2[] }
  | null;

const TOOLS: { tool: Tool; label: string; key: string; hint: string }[] = [
  {
    tool: "select",
    label: "Select",
    key: "v",
    hint: "Click a shape to select it, drag it to move it. Delete removes it.",
  },
  {
    tool: "rectangle",
    label: "Rectangle",
    key: "r",
    hint: "Drag from one corner to the other, or click both corners. After the first click, type the width, Tab, the height, then Enter.",
  },
  {
    tool: "circle",
    label: "Circle",
    key: "c",
    hint: "Click the centre, then click how far out the edge goes, or type the diameter and press Enter.",
  },
  {
    tool: "polygon",
    label: "Outline",
    key: "l",
    hint:
      "Click each corner, or type a length (Tab for the angle), or a point: x,y  @dx,dy  @length<angle, then Enter. " +
      "F8 locks to straight across or up. Click the first corner, press Enter or double-click to close.",
  },
];

const SNAP_PX = 10;
/** Angle steps the outline tool can click to, in degrees (0 = off). */
const ANGLE_STEPS = [0, 15, 30, 45, 90];
const round = (n: number) => Math.round(n * 100) / 100 + 0;
const mm = (n: number) => `${round(n)} mm`;
const same = (a: Point2, b: Point2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

export function SketchEditor(props: {
  draft: SketchDraft;
  /** Problems with the sketch, from the checks and from the last preview build. */
  issues: Issue[];
  canCut: boolean;
  view: "2d" | "3d";
  onView: (v: "2d" | "3d") => void;
  onChange: (feature: SketchFeature) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { draft, onChange } = props;
  const s = draft.feature;
  const onPlate = s.surface === "plate";
  /** A revolve: the outlines spin round the drawing's up line (x = 0), which stands on the plate (y = 0). */
  const spun = s.revolve !== undefined;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<{ cx: number; cy: number; k: number } | null>(null);
  const [tool, setTool] = useState<Tool>("rectangle");
  const [selected, setSelected] = useState<number | null>(null);
  const [offsetBy, setOffsetBy] = useState(-2);
  const [offsetError, setOffsetError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  /** Ortho lock (F8): outline sides only go straight across or straight up. Shift flips it while held. */
  const [ortho, setOrtho] = useState(false);
  const [angleStep, setAngleStep] = useState(0);
  /** What the pointer is held to right now: an object snap, or an angle from the last corner. */
  const [hold, setHold] = useState<{ snap: Snap | null; angle: number | null }>({ snap: null, angle: null });
  /** Sizes typed while drawing; they start empty for every new shape and every new outline corner. */
  // Kept with the shape (or corner) they were typed for, so a new one starts with empty boxes straight away.
  const [typedFor, setTypedFor] = useState<{
    pending: Pending;
    typed: Typed;
  } | null>(null);
  const typed = !pending ? null : typedFor?.pending === pending ? typedFor.typed : startTyping(pending.kind);
  const setTyped = (t: Typed) => setTypedFor({ pending, typed: t });
  const drag = useRef<{
    start: Point2;
    original: Profile;
    index: number;
    moved: boolean;
  } | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const undoStack = useRef<Profile[][]>([]);
  const redoStack = useRef<Profile[][]>([]);

  const setProfiles = useCallback(
    (profiles: Profile[], undoable = true) => {
      if (undoable) {
        undoStack.current.push(s.profiles);
        redoStack.current = [];
      }
      onChange({ ...s, profiles });
    },
    [onChange, s],
  );

  // Size of the drawing area.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [props.view]);

  /** Frames the face (or the area) and everything drawn so far. */
  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    let [x0, y0, x1, y1] = draft.face ? [0, 0, draft.face.width, draft.face.height] : draft.area;
    for (const p of s.profiles) {
      const b = profileBounds(p);
      x0 = Math.min(x0, b[0]);
      y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]);
      y1 = Math.max(y1, b[3]);
    }
    const k = Math.min((size.w - 140) / Math.max(x1 - x0, 1), (size.h - 160) / Math.max(y1 - y0, 1));
    setCam({
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      k: Math.max(0.2, Math.min(k, 80)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, draft.face, draft.area]);
  useEffect(() => {
    if (!cam && size.w) fit();
  }, [cam, size.w, fit]);

  const k = cam?.k ?? 1;
  const toScreen = useCallback(
    ([u, v]: Point2): Point2 => (cam ? [size.w / 2 + (u - cam.cx) * cam.k, size.h / 2 - (v - cam.cy) * cam.k] : [0, 0]),
    [cam, size],
  );
  const fromScreen = useCallback(
    (px: number, py: number): Point2 =>
      cam ? [cam.cx + (px - size.w / 2) / cam.k, cam.cy - (py - size.h / 2) / cam.k] : [0, 0],
    [cam, size],
  );
  /** The grid the pointer snaps to: finer when zoomed in. */
  const step = k >= 12 ? 0.5 : k >= 2.5 ? 1 : 5;

  /** Everything worth snapping to: the face's outline, every shape drawn, and the outline being drawn. */
  const faceEdges = useMemo(() => (draft.face ? boundaryEdges(draft.face.triangles) : []), [draft.face]);
  const drawing = pending?.kind === "polygon" ? pending.points : null;
  const scene = useMemo(() => snapScene(s.profiles, faceEdges, drawing ?? []), [s.profiles, faceEdges, drawing]);

  /**
   * Where the pointer puts a point: on an object snap if one is near (Alt turns snaps off), else held to ortho or an
   * angle step from the outline's last corner, else on the grid.
   */
  const locate = useCallback(
    (e: { clientX: number; clientY: number; altKey: boolean; shiftKey: boolean }) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const raw = fromScreen(e.clientX - rect.left, e.clientY - rect.top);
      const free = { snap: null, angle: null };
      if (e.altKey) return { point: [round(raw[0]), round(raw[1])] as Point2, ...free };
      const last = drawing?.length ? drawing[drawing.length - 1]! : null;
      const snapped = findSnap(scene, raw, last, SNAP_PX, toScreen);
      if (snapped) return { point: snapped.point, snap: snapped, angle: null };
      if (last) {
        const held = constrain(last, raw, { ortho: ortho !== e.shiftKey, step: angleStep }, step);
        if (held.angle !== null) return { point: held.point, snap: null, angle: held.angle };
      }
      const point: Point2 = [round(Math.round(raw[0] / step) * step), round(Math.round(raw[1] / step) * step)];
      return { point, ...free };
    },
    [fromScreen, toScreen, scene, drawing, ortho, angleStep, step],
  );
  const snap = (e: Parameters<typeof locate>[0]) => locate(e).point;

  const addProfile = (p: Profile) => {
    setProfiles([...s.profiles, p]);
    setSelected(s.profiles.length);
  };

  const finishShape = (kind: "rectangle" | "circle", a: Point2, b: Point2): boolean => {
    if (kind === "rectangle") {
      const width = round(Math.abs(b[0] - a[0]));
      const height = round(Math.abs(b[1] - a[1]));
      if (width < 0.5 || height < 0.5) return false;
      addProfile({
        kind: "rectangle",
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width,
        height,
      });
    } else {
      const diameter = round(2 * Math.hypot(b[0] - a[0], b[1] - a[1]));
      if (diameter < 0.5) return false;
      addProfile({ kind: "circle", x: a[0], y: a[1], diameter });
    }
    return true;
  };

  const closePolygon = (points: Point2[]) => {
    const pts = points.filter((q, i) => i === 0 || !same(q, points[i - 1]!));
    if (pts.length > 1 && same(pts[0]!, pts[pts.length - 1]!)) pts.pop();
    if (pts.length >= 3) addProfile({ kind: "polygon", points: pts });
    setPending(null);
  };

  /** Where the shape being drawn gets its next point from: the corner, centre or last outline corner. */
  // An outline whose first corner is still being typed measures from the origin.
  const from = (p: NonNullable<Pending>): Point2 =>
    p.kind === "polygon" ? (p.points[p.points.length - 1] ?? [0, 0]) : p.start;
  /** The pointer's point, with any typed sizes taking over. */
  const aim = (p: NonNullable<Pending>, pointer: Point2 | null) => typedPoint(p.kind, from(p), pointer, typed);

  const addCorner = (points: Point2[], p: Point2) => {
    if (!points.length) return setPending({ kind: "polygon", points: [p] });
    if (points.length >= 3 && same(p, points[0]!)) return closePolygon(points);
    if (!same(p, points[points.length - 1]!)) setPending({ kind: "polygon", points: [...points, p] });
  };

  /** Enter with typed sizes: finish the shape (or the outline's corner) with them. */
  const commitTyped = () => {
    if (!pending) return;
    if (typed?.point !== undefined && !parsePoint(typed.point, from(pending))) return; // not a whole point yet
    const p = aim(pending, cursor);
    if (pending.kind === "polygon") addCorner(pending.points, p);
    else if (finishShape(pending.kind, pending.start, p)) setPending(null);
  };

  const hit = (q: Point2): number | null => {
    const tolerance = 6 / k;
    for (let i = s.profiles.length - 1; i >= 0; i--) {
      const p = s.profiles[i]!;
      if (p.kind === "rectangle") {
        if (
          q[0] >= p.x - tolerance &&
          q[0] <= p.x + p.width + tolerance &&
          q[1] >= p.y - tolerance &&
          q[1] <= p.y + p.height + tolerance
        )
          return i;
      } else if (p.kind === "circle") {
        if (Math.hypot(q[0] - p.x, q[1] - p.y) <= p.diameter / 2 + tolerance) return i;
      } else if (insidePolygon(q, p.points) || nearOutline(q, p.points, tolerance)) return i;
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    // Middle- or right-drag (with or without Shift) only slides the drawing: the sketch stays square-on and never turns.
    if (e.button === 1 || e.button === 2) {
      if (e.button === 1) e.preventDefault(); // no browser auto-scroll
      if (cam) pan.current = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy };
      return;
    }
    if (e.button !== 0) return;
    const p = snap(e);
    if (tool === "select") {
      const i = hit(p);
      setSelected(i);
      if (i !== null)
        drag.current = {
          start: p,
          original: s.profiles[i]!,
          index: i,
          moved: false,
        };
      return;
    }
    if (tool === "polygon") {
      if (pending?.kind === "polygon") addCorner(pending.points, aim(pending, p));
      else setPending({ kind: "polygon", points: [p] });
      return;
    }
    if (pending && pending.kind === tool) {
      if (finishShape(tool, pending.start, aim(pending, p))) setPending(null);
      return;
    }
    setPending({ kind: tool, start: p, pressed: true });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current && cam) {
      const { x, y, cx, cy } = pan.current;
      setCam({
        ...cam,
        cx: cx - (e.clientX - x) / cam.k,
        cy: cy + (e.clientY - y) / cam.k,
      });
      return;
    }
    const where = locate(e);
    const p = where.point;
    setCursor(p);
    setHold({ snap: where.snap, angle: where.angle });
    const d = drag.current;
    if (d) {
      const dx = p[0] - d.start[0];
      const dy = p[1] - d.start[1];
      if (dx === 0 && dy === 0 && !d.moved) return;
      if (!d.moved) undoStack.current.push(s.profiles);
      d.moved = true;
      const moved = moveProfile(d.original, dx, dy);
      onChange({
        ...s,
        profiles: s.profiles.map((q, i) => (i === d.index ? moved : q)),
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      pan.current = null;
      return;
    }
    drag.current = null;
    if (pending && pending.kind !== "polygon" && pending.pressed) {
      const p = snap(e);
      if (!same(p, pending.start) && finishShape(pending.kind, pending.start, aim(pending, p))) setPending(null);
      else setPending({ ...pending, pressed: false });
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!cam) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const before = fromScreen(e.clientX - rect.left, e.clientY - rect.top);
    const nk = Math.max(0.2, Math.min(200, cam.k * Math.exp(-e.deltaY * 0.0015)));
    // Keep the point under the pointer still while zooming.
    const px = e.clientX - rect.left - size.w / 2;
    const py = e.clientY - rect.top - size.h / 2;
    setCam({ k: nk, cx: before[0] - px / nk, cy: before[1] + py / nk });
  };

  const removeSelected = () => {
    if (selected === null) return;
    setProfiles(s.profiles.filter((_, i) => i !== selected));
    setSelected(null);
  };

  // Keyboard: tool letters, Enter / Escape / Backspace while drawing, and the sketch's own undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        const next = redoStack.current.pop();
        if (next) {
          undoStack.current.push(s.profiles);
          onChange({ ...s, profiles: next });
        }
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (pending) return setPending(null);
        const prev = undoStack.current.pop();
        if (prev) {
          redoStack.current.push(s.profiles);
          onChange({ ...s, profiles: prev });
          setSelected(null);
        }
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        setOrtho((o) => !o);
        return;
      }
      if (typing || mod || e.altKey) return;
      // An outline's first corner can be typed as a point straight away, before any click.
      if (tool === "polygon" && !pending && isPointKey(e.key) && e.key !== "," && e.key !== "<") {
        e.preventDefault();
        const start: Pending = { kind: "polygon", points: [] };
        setPending(start);
        setTypedFor({ pending: start, typed: { ...startPointEntry(), point: e.key } });
        return;
      }
      // Typing a size while drawing: the keys go into the boxes at the pointer.
      if (pending && typed) {
        const next = typeKey(typed, e.key, e.shiftKey, pending.kind === "polygon");
        if (next) {
          e.preventDefault();
          setTyped(next);
          return;
        }
        if (e.key === "Enter" && anyTyped(typed)) {
          e.preventDefault();
          return commitTyped();
        }
        if (e.key === "Escape" && (typed.point || typed.values.some((v) => v))) {
          if (pending.kind === "polygon" && !pending.points.length) return setPending(null);
          return setTyped(startTyping(pending.kind));
        }
      }
      if (e.key === "Escape") {
        if (pending) setPending(null);
        else if (selected !== null) setSelected(null);
        return;
      }
      if (e.key === "Enter" && pending?.kind === "polygon") {
        e.preventDefault();
        return closePolygon(pending.points);
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (pending?.kind === "polygon") {
          const points = pending.points.slice(0, -1);
          setPending(points.length ? { kind: "polygon", points } : null);
        } else removeSelected();
        e.preventDefault();
        return;
      }
      const t = TOOLS.find((x) => x.key === key);
      if (t) {
        setTool(t.tool);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const errors = hasErrors(props.issues);
  const across = onPlate ? "Left / right" : spun ? "Out from the line" : "Across";
  const up = onPlate ? "Front / back" : spun ? "Height" : "Up";
  const hint =
    (spun && tool !== "select" ? "Draw half of the part's outline, right of the spin line. " : "") +
    TOOLS.find((t) => t.tool === tool)!.hint;
  const sel = selected !== null ? s.profiles[selected] : undefined;
  const depths = useMemo(() => nestingDepths(s.profiles), [s.profiles]);
  useEffect(() => setOffsetError(null), [selected]);

  const makeOffset = () => {
    if (!sel) return;
    const copy = offsetProfile(sel, offsetBy);
    if (!copy) {
      setOffsetError(
        offsetBy < 0
          ? `${PROFILE_LABELS[sel.kind]} ${selected! + 1} is too small to shrink by ${mm(-offsetBy)}.`
          : `Growing this outline by ${mm(offsetBy)} makes it cross over itself.`,
      );
      return;
    }
    setOffsetError(null);
    setProfiles([...s.profiles, copy]);
    setSelected(s.profiles.length);
  };

  return (
    <div className={`sketch-editor view-${props.view}`} data-testid="sketch-editor">
      <div className="sketch-top glass bar">
        <span className="sketch-title">
          <Icon name="pencil" />
          {s.name} on the {s.surface}
        </span>
        <span className="divider" aria-hidden="true" />
        <div className="group" role="group" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              aria-pressed={tool === t.tool}
              aria-label={`${t.label} tool`}
              title={`${t.label} (${t.key.toUpperCase()})`}
              disabled={props.view === "3d"}
              onClick={() => {
                setTool(t.tool);
                setPending(null);
              }}
            >
              <Icon name={t.tool === "select" ? "pointer" : t.tool} />
              {t.label}
            </button>
          ))}
        </div>
        <span className="divider" aria-hidden="true" />
        <div className="group" role="group" aria-label="Drafting aids">
          <button
            type="button"
            aria-pressed={ortho}
            title="Ortho: sides go only straight across or straight up (F8; hold Shift to flip it for a moment)"
            disabled={props.view === "3d"}
            onClick={() => setOrtho((o) => !o)}
          >
            Ortho
          </button>
          <label className="angle-step" title="Sides click to these angles when the pointer is close">
            <span>Angles</span>
            <select
              aria-label="Angle steps"
              value={angleStep}
              disabled={props.view === "3d"}
              onChange={(e) => setAngleStep(Number(e.target.value))}
            >
              {ANGLE_STEPS.map((a) => (
                <option key={a} value={a}>
                  {a ? `${a}°` : "Free"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="divider" aria-hidden="true" />
        <button type="button" onClick={fit} disabled={props.view === "3d"} title="Fit the drawing to the screen">
          Fit
        </button>
        <div className="segmented-small" role="group" aria-label="Sketch view">
          <button type="button" aria-pressed={props.view === "2d"} onClick={() => props.onView("2d")}>
            2D
          </button>
          <button type="button" aria-pressed={props.view === "3d"} onClick={() => props.onView("3d")}>
            3D
          </button>
        </div>
        <span className="spacer" />
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={props.onDone}
          disabled={errors}
          title={errors ? "Fix the problems below first" : undefined}
        >
          <Icon name="check" />
          Done
        </button>
      </div>

      {props.view === "2d" && (
        <svg
          ref={svgRef}
          className={`sketch-canvas tool-${tool}`}
          data-testid="sketch-canvas"
          data-scale={k}
          data-origin={cam ? toScreen([0, 0]).map(round).join(",") : ""}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setCursor(null);
            setHold({ snap: null, angle: null });
          }}
          onDoubleClick={() => pending?.kind === "polygon" && closePolygon(pending.points)}
          onWheel={onWheel}
          onAuxClick={(e) => e.button === 1 && e.detail === 2 && fit()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {cam && (
            <>
              <Grid cam={cam} size={size} />
              {spun ? (
                <SpinLine toScreen={toScreen} size={size} />
              ) : onPlate ? (
                <>
                  <line className="axis x" x1={0} x2={size.w} y1={toScreen([0, 0])[1]} y2={toScreen([0, 0])[1]} />
                  <line className="axis y" y1={0} y2={size.h} x1={toScreen([0, 0])[0]} x2={toScreen([0, 0])[0]} />
                </>
              ) : (
                draft.face && <Face face={draft.face} toScreen={toScreen} />
              )}
              {s.profiles.map((p, i) => (
                <ProfileShape
                  key={i}
                  profile={p}
                  mode={s.mode}
                  hole={(depths[i] ?? 0) % 2 === 1}
                  selected={i === selected}
                  toScreen={toScreen}
                />
              ))}
              <PendingShape
                pending={pending}
                cursor={pending && (cursor || anyTyped(typed)) ? aim(pending, cursor) : cursor}
                toScreen={toScreen}
              />
              {pending && typed && (
                <TypedBoxes
                  pending={pending}
                  typed={typed}
                  from={from(pending)}
                  to={aim(pending, cursor)}
                  at={toScreen(cursor ?? from(pending))}
                />
              )}
              {cursor && pending?.kind === "polygon" && pending.points.length > 0 && hold.angle !== null && (
                <AngleGuide from={from(pending)} angle={hold.angle} size={size} toScreen={toScreen} ortho={ortho} />
              )}
              {cursor && hold.snap && <SnapMarker snap={hold.snap} toScreen={toScreen} />}
              {cursor && <circle className="cursor" cx={toScreen(cursor)[0]} cy={toScreen(cursor)[1]} r={4} />}
            </>
          )}
        </svg>
      )}

      {sel && props.view === "2d" && (
        <div className="sketch-side glass" aria-label="Selected shape">
          <div className="hole-head">
            <span className="hole-name">
              {PROFILE_LABELS[sel.kind]} {selected! + 1}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${PROFILE_LABELS[sel.kind]} ${selected! + 1}`}
              onClick={removeSelected}
            >
              <Icon name="trash" />
            </button>
          </div>
          <ProfileFields
            profile={sel}
            onPlate={onPlate}
            onChange={(p) => setProfiles(s.profiles.map((q, i) => (i === selected ? p : q)))}
          />
          <div className="offset-row">
            <NumberField label="Offset by" name="Offset distance" value={offsetBy} onCommit={setOffsetBy} compact />
            <button
              type="button"
              className="add"
              onClick={makeOffset}
              title="Add a copy of this shape, grown or shrunk on every side"
            >
              Make offset copy
            </button>
          </div>
          {offsetError && (
            <p className="issue error" role="alert">
              {offsetError}
            </p>
          )}
          <p className="help">
            Minus shrinks, plus grows. A shape drawn inside another one becomes a hole
            {(depths[selected!] ?? 0) % 2 === 1 ? " (this one is a hole)" : ""}.
          </p>
          <p className="help">
            {onPlate
              ? "Measured from the centre of the build plate."
              : spun
                ? "Measured out from the spin line and up from the plate."
                : `Measured from the bottom-left corner of the ${s.surface}.`}
          </p>
        </div>
      )}

      <div className="sketch-bottom glass">
        <div className="sketch-readout">
          <span className="sketch-hint">
            {props.view === "3d" ? "Switch to 2D to draw. Drag to look around." : hint}
          </span>
          <span data-testid="sketch-cursor">
            {cursor
              ? `${across} ${mm(cursor[0])} · ${up} ${mm(cursor[1])}${hold.snap ? ` · ${SNAP_LABELS[hold.snap.kind]}` : ""}`
              : `${s.profiles.length} shape${s.profiles.length === 1 ? "" : "s"} drawn`}
          </span>
        </div>
        <div className="sketch-then">
          <div className="segmented-small" role="group" aria-label="What the sketch does">
            <button
              type="button"
              aria-pressed={s.mode === "add"}
              onClick={() => onChange({ ...s, mode: "add", depth: s.depth || 5 })}
            >
              Push out
            </button>
            <button
              type="button"
              aria-pressed={s.mode === "cut"}
              disabled={!props.canCut}
              title={props.canCut ? "Cut the shapes into the part" : "Sketch on a face of the part to cut into it"}
              onClick={() => onChange({ ...s, mode: "cut" })}
            >
              Cut in
            </button>
          </div>
          {spun && (
            <NumberField
              label="Angle"
              name="Revolve angle"
              unit="°"
              value={s.revolve!}
              onCommit={(v) => onChange({ ...s, revolve: v })}
              compact
            />
          )}
          {!spun && !(s.mode === "cut" && s.depth === 0) && (
            <NumberField
              label={s.mode === "add" ? "Height" : "Depth"}
              name={s.mode === "add" ? "Sketch height" : "Sketch depth"}
              value={s.depth}
              onCommit={(v) => onChange({ ...s, depth: v })}
              compact
            />
          )}
          {!spun && s.mode === "cut" && (
            <label className="check">
              <input
                type="checkbox"
                checked={s.depth === 0}
                onChange={(e) => onChange({ ...s, depth: e.target.checked ? 0 : 5 })}
              />
              All the way through
            </label>
          )}
        </div>
        {props.issues.length > 0 && (
          <div className="sketch-issues">
            {dedupeMessages(props.issues).map((i) => (
              <p key={i.message} className={`issue ${i.severity}`} role={i.severity === "error" ? "alert" : undefined}>
                {i.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const dedupeMessages = (issues: Issue[]) =>
  issues.filter((i, n) => issues.findIndex((j) => j.message === i.message) === n);

function moveProfile(p: Profile, dx: number, dy: number): Profile {
  if (p.kind === "polygon")
    return {
      ...p,
      points: p.points.map(([x, y]) => [round(x + dx), round(y + dy)]),
    };
  return { ...p, x: round(p.x + dx), y: round(p.y + dy) };
}

function insidePolygon(q: Point2, pts: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearOutline(q: Point2, pts: Point2[], tolerance: number): boolean {
  return pts.some((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) <= tolerance;
  });
}

function Grid({ cam, size }: { cam: { cx: number; cy: number; k: number }; size: { w: number; h: number } }) {
  const minor = [1, 5, 10, 50, 100].find((g) => g * cam.k >= 8) ?? 100;
  const major = minor * 10;
  const x0 = cam.cx - size.w / 2 / cam.k;
  const x1 = cam.cx + size.w / 2 / cam.k;
  const y0 = cam.cy - size.h / 2 / cam.k;
  const y1 = cam.cy + size.h / 2 / cam.k;
  const lines: { d: string; cls: string }[] = [];
  const sx = (u: number) => size.w / 2 + (u - cam.cx) * cam.k;
  const sy = (v: number) => size.h / 2 - (v - cam.cy) * cam.k;
  let minorPath = "";
  let majorPath = "";
  for (let u = Math.ceil(x0 / minor) * minor; u <= x1; u += minor) {
    const seg = `M${sx(u)},0V${size.h}`;
    if (Math.abs(u / major - Math.round(u / major)) < 1e-9) majorPath += seg;
    else minorPath += seg;
  }
  for (let v = Math.ceil(y0 / minor) * minor; v <= y1; v += minor) {
    const seg = `M0,${sy(v)}H${size.w}`;
    if (Math.abs(v / major - Math.round(v / major)) < 1e-9) majorPath += seg;
    else minorPath += seg;
  }
  lines.push({ d: minorPath, cls: "grid minor" }, { d: majorPath, cls: "grid major" });
  return (
    <g data-grid={minor}>
      {lines.map((l) => (
        <path key={l.cls} className={l.cls} d={l.d} />
      ))}
    </g>
  );
}

type ToScreen = (p: Point2) => Point2;

/** A revolve's spin line (x = 0), with the plate's surface (y = 0) under it. */
function SpinLine({ toScreen, size }: { toScreen: ToScreen; size: { w: number; h: number } }) {
  const [ox, oy] = toScreen([0, 0]);
  return (
    <g className="spin" data-testid="spin-line">
      <line className="plate-line" x1={0} x2={size.w} y1={oy} y2={oy} />
      <text className="plate-label" x={size.w - 8} y={oy + 16} textAnchor="end">
        Plate
      </text>
      <line className="spin-line" x1={ox} x2={ox} y1={0} y2={size.h} />
      <text className="spin-label" x={ox + 6} y={14}>
        Spin line
      </text>
    </g>
  );
}

function Face({ face, toScreen }: { face: NonNullable<SketchDraft["face"]>; toScreen: ToScreen }) {
  let d = "";
  for (let i = 0; i + 2 < face.triangles.length; i += 3) {
    const [a, b, c] = [face.triangles[i]!, face.triangles[i + 1]!, face.triangles[i + 2]!].map(toScreen);
    d += `M${a![0]},${a![1]}L${b![0]},${b![1]}L${c![0]},${c![1]}Z`;
  }
  const [ox, oy] = toScreen([0, 0]);
  const [wx, hy] = toScreen([face.width, face.height]);
  return (
    <g className="face">
      <path d={d} />
      <Dimension a={[ox, oy + 26]} b={[wx, oy + 26]} text={mm(face.width)} />
      <Dimension a={[ox - 26, oy]} b={[ox - 26, hy]} text={mm(face.height)} vertical />
      <circle className="origin" cx={ox} cy={oy} r={4} />
    </g>
  );
}

/** A measurement: a thin line with ticks and the size written in the middle. */
function Dimension({
  a,
  b,
  text,
  vertical,
  dashed,
}: {
  a: Point2;
  b: Point2;
  text: string;
  vertical?: boolean;
  dashed?: boolean;
}) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return (
    <g className={`dim${dashed ? " dashed" : ""}`}>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      {!dashed && (
        <>
          <line
            x1={a[0] - (vertical ? 4 : 0)}
            y1={a[1] - (vertical ? 0 : 4)}
            x2={a[0] + (vertical ? 4 : 0)}
            y2={a[1] + (vertical ? 0 : 4)}
          />
          <line
            x1={b[0] - (vertical ? 4 : 0)}
            y1={b[1] - (vertical ? 0 : 4)}
            x2={b[0] + (vertical ? 4 : 0)}
            y2={b[1] + (vertical ? 0 : 4)}
          />
        </>
      )}
      <text x={mx} y={my} transform={vertical ? `rotate(-90 ${mx} ${my})` : undefined} dy="-5" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function outlinePath(p: Profile, toScreen: ToScreen): string {
  if (p.kind === "rectangle") {
    const pts: Point2[] = [
      [p.x, p.y],
      [p.x + p.width, p.y],
      [p.x + p.width, p.y + p.height],
      [p.x, p.y + p.height],
    ];
    return "M" + pts.map((q) => toScreen(q).join(",")).join("L") + "Z";
  }
  if (p.kind === "polygon") return "M" + p.points.map((q) => toScreen(q).join(",")).join("L") + "Z";
  return "";
}

function ProfileShape(props: { profile: Profile; mode: Mode; hole: boolean; selected: boolean; toScreen: ToScreen }) {
  const { profile: p, toScreen } = props;
  const cls = `profile ${props.mode}${props.hole ? " hole" : ""}${props.selected ? " selected" : ""}`;
  const [x0, y0, x1, y1] = profileBounds(p);
  const bl = toScreen([x0, y0]);
  const tr = toScreen([x1, y1]);
  return (
    <g className={cls} data-testid="sketch-profile" data-hole={props.hole}>
      {p.kind === "circle" ? (
        <circle cx={toScreen([p.x, p.y])[0]} cy={toScreen([p.x, p.y])[1]} r={(tr[0] - bl[0]) / 2} />
      ) : (
        <path d={outlinePath(p, toScreen)} />
      )}
      {p.kind === "rectangle" && (
        <>
          <Dimension a={[bl[0], bl[1] + 16]} b={[tr[0], bl[1] + 16]} text={mm(p.width)} />
          <Dimension a={[tr[0] + 16, bl[1]]} b={[tr[0] + 16, tr[1]]} text={mm(p.height)} vertical />
        </>
      )}
      {p.kind === "circle" && (
        <text className="dim-label" x={toScreen([p.x, p.y])[0]} y={toScreen([p.x, p.y])[1]} dy="4" textAnchor="middle">
          Ø {mm(p.diameter)}
        </text>
      )}
      {p.kind === "polygon" && props.selected && <SegmentLengths points={p.points} closed toScreen={toScreen} />}
      {props.selected && <Offsets bounds={[x0, y0, x1, y1]} toScreen={toScreen} />}
    </g>
  );
}

/** Dashed lines from the edges of the face (or the plate's centre lines) to the shape, with the distances. */
function Offsets({ bounds, toScreen }: { bounds: [number, number, number, number]; toScreen: ToScreen }) {
  const [x0, y0] = bounds;
  const cy = (bounds[1] + bounds[3]) / 2;
  const cx = (bounds[0] + bounds[2]) / 2;
  return (
    <g className="offsets">
      {Math.abs(x0) > 1e-9 && <Dimension a={toScreen([0, cy])} b={toScreen([x0, cy])} text={mm(x0)} dashed />}
      {Math.abs(y0) > 1e-9 && <Dimension a={toScreen([cx, 0])} b={toScreen([cx, y0])} text={mm(y0)} vertical dashed />}
    </g>
  );
}

function SegmentLengths({ points, closed, toScreen }: { points: Point2[]; closed: boolean; toScreen: ToScreen }) {
  const n = closed ? points.length : points.length - 1;
  return (
    <g className="segments">
      {Array.from({ length: Math.max(n, 0) }, (_, i) => {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-9) return null;
        const [mx, my] = toScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        return (
          <text key={i} className="dim-label" x={mx} y={my} dy="-6" textAnchor="middle">
            {mm(len)}
          </text>
        );
      })}
    </g>
  );
}

function PendingShape({ pending, cursor, toScreen }: { pending: Pending; cursor: Point2 | null; toScreen: ToScreen }) {
  if (!pending || !cursor) {
    if (pending?.kind === "polygon")
      return (
        <g className="pending">
          <path d={"M" + pending.points.map((q) => toScreen(q).join(",")).join("L")} />
        </g>
      );
    return null;
  }
  if (pending.kind === "rectangle") {
    const a = pending.start;
    const p: Profile = {
      kind: "rectangle",
      x: Math.min(a[0], cursor[0]),
      y: Math.min(a[1], cursor[1]),
      width: Math.abs(cursor[0] - a[0]),
      height: Math.abs(cursor[1] - a[1]),
    };
    const bl = toScreen([p.x, p.y]);
    const tr = toScreen([p.x + p.width, p.y + p.height]);
    return (
      <g className="pending">
        <path d={outlinePath(p, toScreen)} />
        <Dimension a={[bl[0], bl[1] + 16]} b={[tr[0], bl[1] + 16]} text={mm(p.width)} />
        <Dimension a={[tr[0] + 16, bl[1]]} b={[tr[0] + 16, tr[1]]} text={mm(p.height)} vertical />
      </g>
    );
  }
  if (pending.kind === "circle") {
    const [cx, cy] = toScreen(pending.start);
    const [ex, ey] = toScreen(cursor);
    const d = 2 * Math.hypot(cursor[0] - pending.start[0], cursor[1] - pending.start[1]);
    return (
      <g className="pending">
        <circle cx={cx} cy={cy} r={Math.hypot(ex - cx, ey - cy)} />
        <line x1={cx} y1={cy} x2={ex} y2={ey} />
        <text className="dim-label" x={cx} y={cy} dy="-8" textAnchor="middle">
          Ø {mm(d)}
        </text>
      </g>
    );
  }
  if (pending.kind !== "polygon") return null;
  const pts = [...pending.points, cursor];
  return (
    <g className="pending">
      <path d={"M" + pts.map((q) => toScreen(q).join(",")).join("L")} />
      {pending.points.length >= 3 && (
        <circle
          className="close-target"
          cx={toScreen(pending.points[0]!)[0]}
          cy={toScreen(pending.points[0]!)[1]}
          r={7}
        />
      )}
      <SegmentLengths points={pts} closed={false} toScreen={toScreen} />
    </g>
  );
}

/** Exact numbers for the selected shape. */
function ProfileFields({
  profile: p,
  onPlate,
  onChange,
}: {
  profile: Profile;
  onPlate: boolean;
  onChange: (p: Profile) => void;
}) {
  const fromLeft = onPlate ? "Left / right" : "From left edge";
  const fromBottom = onPlate ? "Front / back" : "From bottom edge";
  if (p.kind === "rectangle")
    return (
      <div className="hole-grid">
        <NumberField
          label={fromLeft}
          name="Rectangle left edge"
          value={p.x}
          onCommit={(x) => onChange({ ...p, x })}
          compact
        />
        <NumberField
          label={fromBottom}
          name="Rectangle bottom edge"
          value={p.y}
          onCommit={(y) => onChange({ ...p, y })}
          compact
        />
        <NumberField
          label="Width"
          name="Rectangle width"
          value={p.width}
          onCommit={(width) => onChange({ ...p, width })}
          compact
        />
        <NumberField
          label="Height"
          name="Rectangle height"
          value={p.height}
          onCommit={(height) => onChange({ ...p, height })}
          compact
        />
      </div>
    );
  if (p.kind === "circle")
    return (
      <div className="hole-grid">
        <NumberField
          label={`Centre: ${fromLeft.toLowerCase()}`}
          name="Circle centre across"
          value={p.x}
          onCommit={(x) => onChange({ ...p, x })}
          compact
        />
        <NumberField
          label={`Centre: ${fromBottom.toLowerCase()}`}
          name="Circle centre up"
          value={p.y}
          onCommit={(y) => onChange({ ...p, y })}
          compact
        />
        <NumberField
          label="Diameter"
          name="Circle diameter"
          value={p.diameter}
          onCommit={(diameter) => onChange({ ...p, diameter })}
          compact
        />
      </div>
    );
  return (
    <div className="corners">
      <SideFields points={p.points} onChange={(points) => onChange({ ...p, points })} />
      <details className="more">
        <summary>Corner positions</summary>
        {p.points.map((q, i) => (
          <div className="hole-grid" key={i}>
            <NumberField
              label={`Corner ${i + 1} ${onPlate ? "x" : "across"}`}
              value={q[0]}
              onCommit={(x) =>
                onChange({
                  ...p,
                  points: p.points.map((r, j) => (j === i ? [x, r[1]] : r)),
                })
              }
              compact
            />
            <NumberField
              label={`Corner ${i + 1} ${onPlate ? "y" : "up"}`}
              value={q[1]}
              onCommit={(y) =>
                onChange({
                  ...p,
                  points: p.points.map((r, j) => (j === i ? [r[0], y] : r)),
                })
              }
              compact
            />
          </div>
        ))}
      </details>
    </div>
  );
}

/**
 * Each side's length and angle. Changing one moves the corners after it, keeping their sides as they are; the closing
 * side follows. A size that can't work is explained, never quietly changed.
 */
function SideFields({ points, onChange }: { points: Point2[]; onChange: (points: Point2[]) => void }) {
  const [problem, setProblem] = useState<{ side: number; message: string } | null>(null);
  const n = points.length;
  const closing = sideOf(points, n - 1);
  const issue = (i: number) =>
    problem?.side === i
      ? { featureId: "", field: "", severity: "error" as const, message: problem.message }
      : undefined;
  return (
    <div className="sides" role="group" aria-label="Sides">
      {points.slice(0, -1).map((_, i) => {
        const side = sideOf(points, i);
        return (
          <div className="hole-grid" key={i}>
            <NumberField
              label={`Side ${i + 1}`}
              name={`Side ${i + 1} length`}
              value={round(side.length)}
              issue={issue(i)}
              onCommit={(length) => {
                if (length <= 0) return setProblem({ side: i, message: `Side ${i + 1} needs a length above 0 mm.` });
                setProblem(null);
                onChange(editSide(points, i, { length }));
              }}
            />
            <NumberField
              label="Angle"
              name={`Side ${i + 1} angle`}
              unit="°"
              value={round(side.angle)}
              onCommit={(angle) => {
                setProblem(null);
                onChange(editSide(points, i, { angle }));
              }}
              compact
            />
          </div>
        );
      })}
      <p className="props-note" data-testid="closing-side">
        Side {n} closes the outline: {mm(closing.length)} at {round(closing.angle)}°
      </p>
    </div>
  );
}

/** The marker for an object snap: a square for an end, a triangle for a middle, a circle for a centre and so on. */
function SnapMarker({ snap, toScreen }: { snap: Snap; toScreen: ToScreen }) {
  const [x, y] = toScreen(snap.point);
  const r = 6;
  const shape =
    snap.kind === "end" ? (
      <rect x={x - r} y={y - r} width={2 * r} height={2 * r} />
    ) : snap.kind === "middle" ? (
      <path d={`M${x},${y - r}L${x + r},${y + r}L${x - r},${y + r}Z`} />
    ) : snap.kind === "centre" ? (
      <circle cx={x} cy={y} r={r} />
    ) : snap.kind === "intersection" ? (
      <path d={`M${x - r},${y - r}L${x + r},${y + r}M${x - r},${y + r}L${x + r},${y - r}`} />
    ) : (
      <path d={`M${x - r},${y + r}H${x + r}M${x},${y + r}V${y - r}`} />
    );
  return (
    <g className="snap-marker" data-testid="snap" data-snap={snap.kind}>
      {shape}
      <text x={x + 10} y={y - 10}>
        {SNAP_LABELS[snap.kind]}
      </text>
    </g>
  );
}

/** A dashed line through the last corner at the angle the side is held to, labelled with the angle. */
function AngleGuide(props: {
  from: Point2;
  angle: number;
  ortho: boolean;
  size: { w: number; h: number };
  toScreen: ToScreen;
}) {
  const a = (props.angle * Math.PI) / 180;
  const [x, y] = props.toScreen(props.from);
  const far = props.size.w + props.size.h;
  return (
    <g className="angle-guide" data-testid="angle-guide" data-angle={props.angle}>
      <line x1={x} y1={y} x2={x + far * Math.cos(a)} y2={y - far * Math.sin(a)} />
      <text x={x + 40 * Math.cos(a) + 6} y={y - 40 * Math.sin(a) - 6}>
        {props.ortho ? "Ortho " : ""}
        {props.angle}°
      </text>
    </g>
  );
}

/** The boxes at the pointer that show (and take) typed sizes while drawing, like AutoCAD's dynamic input. */
function TypedBoxes(props: { pending: NonNullable<Pending>; typed: Typed; from: Point2; to: Point2; at: Point2 }) {
  const labels = TYPED_FIELDS[props.pending.kind];
  const live = liveValues(props.pending.kind, props.from, props.to);
  const [x, y] = [props.at[0] + 18, props.at[1] + 18];
  if (props.typed.point !== undefined)
    return (
      <g className="typed-boxes" role="group" aria-label="Typed point" data-testid="typed-sizes">
        <g className="typed-box active typed" transform={`translate(${x} ${y})`} data-testid="typed-point">
          <rect width={170} height={24} rx={6} />
          <text x={8} y={16} className="typed-label">
            Point
          </text>
          <text x={162} y={16} textAnchor="end" className="typed-value">
            {props.typed.point || "x,y  @dx,dy  @len<angle"}
          </text>
        </g>
      </g>
    );
  return (
    <g className="typed-boxes" role="group" aria-label="Typed sizes" data-testid="typed-sizes">
      {labels.map((label, i) => {
        const value = props.typed.values[i] ?? "";
        const active = i === props.typed.active;
        const unit = label === "Angle" ? "°" : " mm";
        return (
          <g
            key={label}
            className={`typed-box${active ? " active" : ""}${value ? " typed" : ""}`}
            transform={`translate(${x} ${y + i * 28})`}
            data-testid={`typed-${label.toLowerCase()}`}
            data-active={active}
          >
            <rect width={122} height={24} rx={6} />
            <text x={8} y={16} className="typed-label">
              {label}
            </text>
            <text x={114} y={16} textAnchor="end" className="typed-value">
              {(value || live[i] || "") + unit}
            </text>
          </g>
        );
      })}
    </g>
  );
}
