// Reference pictures: adding one, its settings in the side panel, and calibrating its size against a distance the
// user knows. Pictures are only shown; they are never built into the part or exported.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  MAX_REFERENCE_PIXELS,
  MIN_OPACITY,
  REFERENCE_PLANES,
  calibratedScale,
  referenceSize,
  type Issue,
  type Point2,
  type ReferenceImage,
  type ReferencePlane,
} from "@studio3d/document";
import { NumberField } from "./NumberField";

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places + 0;

/** Asks for a picture file (PNG, JPEG, WebP or GIF). Null when nothing was chosen. */
export function choosePicture(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Reads a picture file and returns it as a data: URL, shrunk to at most MAX_REFERENCE_PIXELS across so the project
 * file stays a sensible size. Photos are stored as JPEG; drawings with see-through parts keep PNG.
 */
export async function readPicture(file: File): Promise<{ src: string; pixels: [number, number]; name: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error(`${file.name} isn't a picture this app can read. Use a PNG, JPEG, WebP or GIF file.`);
    });
    const shrink = Math.min(1, MAX_REFERENCE_PIXELS / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * shrink));
    const h = Math.max(1, Math.round(img.naturalHeight * shrink));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const png = file.type === "image/png" || file.type === "image/gif";
    const src = png ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
    return { src, pixels: [w, h], name: file.name.replace(/\.[^.]+$/, "") || "Picture" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const OFFSET_LABELS: Record<ReferencePlane, { label: string; help: string }> = {
  top: { label: "Height", help: "How far above the plate it lies. 0 is on the plate." },
  front: { label: "Forward", help: "How far towards the front it stands, from the middle of the plate." },
  right: { label: "Right", help: "How far to the right it stands, from the middle of the plate." },
};

/** A picture's settings: which way it faces, its size (and calibration), place, turn and how see-through it is. */
export function ReferenceProps(props: {
  reference: ReferenceImage;
  issues: Issue[];
  onChange: (patch: Partial<ReferenceImage>) => void;
  onCalibrate: () => void;
}) {
  const { reference: r, onChange } = props;
  const issueFor = (field: string) => props.issues.find((i) => i.field === field);
  const [w, h] = referenceSize(r);
  return (
    <>
      <p className="props-note" data-testid="reference-size">
        {round(w)} × {round(h)} mm ({round(r.scale, 4)} mm per pixel).{" "}
        {r.calibrated ? "Sized from a known distance." : "Not calibrated yet: the size is a guess."}
      </p>
      <button type="button" className="link calibrate-link" onClick={props.onCalibrate}>
        Calibrate from a known distance…
      </button>
      <div className="hole-grid">
        <div className="field compact">
          <label htmlFor={`${r.id}-plane`}>Faces</label>
          <div className="input-row select-row">
            <select
              id={`${r.id}-plane`}
              aria-label={`${r.name} faces`}
              value={r.plane}
              onChange={(e) => onChange({ plane: e.target.value as ReferencePlane })}
            >
              {REFERENCE_PLANES.map((p) => (
                <option key={p.plane} value={p.plane}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <NumberField
          label="Width"
          name={`${r.name} width`}
          help="Typing the real width sets the picture's size, like calibrating across the whole picture."
          value={round(w)}
          issue={issueFor("scale")}
          onCommit={(v) => onChange({ scale: v / r.pixels[0], calibrated: true })}
          compact
        />
      </div>
      <div className="hole-grid three">
        <NumberField
          label="Across"
          name={`${r.name} across`}
          help="Where its middle is, left or right of the middle of the plate as you look at it."
          value={r.x}
          issue={issueFor("x")}
          onCommit={(x) => onChange({ x })}
          compact
        />
        <NumberField
          label="Up"
          name={`${r.name} up`}
          help="Where its middle is, up or down from the middle of the plate as you look at it."
          value={r.y}
          issue={issueFor("y")}
          onCommit={(y) => onChange({ y })}
          compact
        />
        <NumberField
          label={OFFSET_LABELS[r.plane].label}
          name={`${r.name} ${OFFSET_LABELS[r.plane].label.toLowerCase()}`}
          help={OFFSET_LABELS[r.plane].help}
          value={r.offset}
          issue={issueFor("offset")}
          onCommit={(offset) => onChange({ offset })}
          compact
        />
      </div>
      <div className="hole-grid">
        <NumberField
          label="Turn"
          name={`${r.name} turn`}
          help="Degrees anticlockwise, as you look at it."
          unit="°"
          value={r.rotation}
          issue={issueFor("rotation")}
          onCommit={(rotation) => onChange({ rotation })}
          compact
        />
        <div className="field compact">
          <label htmlFor={`${r.id}-opacity`}>Solid</label>
          <div className="input-row range-row">
            <input
              id={`${r.id}-opacity`}
              type="range"
              aria-label={`${r.name} solid`}
              min={MIN_OPACITY * 100}
              max={100}
              step={5}
              value={Math.round(r.opacity * 100)}
              onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
            />
            <span className="unit">{Math.round(r.opacity * 100)}%</span>
          </div>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={r.visible} onChange={(e) => onChange({ visible: e.target.checked })} />
        Show
      </label>
      <label className="check">
        <input type="checkbox" checked={r.onTop} onChange={(e) => onChange({ onTop: e.target.checked })} />
        Show over the part
      </label>
      <p className="props-note">Pictures are only for reference: they aren't part of the model or the STL.</p>
    </>
  );
}

/**
 * Calibrate: click two points on the picture a known distance apart, type that distance, and the picture is sized so
 * the two points are exactly that far apart.
 */
export function CalibrateDialog(props: {
  reference: ReferenceImage;
  onApply: (scale: number) => void;
  onClose: () => void;
}) {
  const r = props.reference;
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState<Point2[]>([]);
  const [text, setText] = useState("");
  const { onClose } = props;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** The picture pixel under the pointer. */
  const pixelAt = (e: ReactPointerEvent<SVGSVGElement>): Point2 => {
    const box = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * r.pixels[0], ((e.clientY - box.top) / box.height) * r.pixels[1]];
  };
  const distance = Number(text.replace(",", "."));
  const typed = text.trim() !== "";
  const scale = points.length === 2 ? calibratedScale(points[0]!, points[1]!, distance) : null;
  const pixels = points.length === 2 ? Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]) : 0;
  const problem =
    points.length < 2
      ? null
      : pixels <= 0.5
        ? "The two points are on top of each other. Pick two points further apart."
        : typed && !(distance > 0)
          ? "Type the real distance between the points, more than 0 mm."
          : null;
  const mark = Math.max(r.pixels[0], r.pixels[1]) / 120;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog glass calibrate"
        role="dialog"
        aria-modal="true"
        aria-label={`Calibrate ${r.name}`}
        tabIndex={-1}
        ref={ref}
      >
        <h2>Calibrate {r.name}</h2>
        <p className="muted">
          {points.length === 0
            ? "Click the start of something whose real length you know (a ruler, a hole spacing, a part's edge)."
            : points.length === 1
              ? "Now click its end."
              : "Type the real distance between the two points. Click again to start over."}
        </p>
        <div className="calibrate-picture">
          <svg
            ref={svgRef}
            data-testid="calibrate-picture"
            viewBox={`0 0 ${r.pixels[0]} ${r.pixels[1]}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              const p = pixelAt(e);
              setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]));
            }}
          >
            <image href={r.src} width={r.pixels[0]} height={r.pixels[1]} preserveAspectRatio="none" />
            {points.length === 2 && (
              <line
                className="calibrate-line"
                x1={points[0]![0]}
                y1={points[0]![1]}
                x2={points[1]![0]}
                y2={points[1]![1]}
                strokeWidth={mark / 3}
              />
            )}
            {points.map((p, i) => (
              <circle key={i} className="calibrate-point" cx={p[0]} cy={p[1]} r={mark} strokeWidth={mark / 3} />
            ))}
          </svg>
        </div>
        <div className="field compact">
          <label htmlFor="calibrate-distance">Real distance between the points</label>
          <div className="input-row">
            <input
              id="calibrate-distance"
              inputMode="decimal"
              value={text}
              disabled={points.length < 2}
              aria-invalid={problem ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scale && props.onApply(scale)}
            />
            <span className="unit">mm</span>
          </div>
        </div>
        {problem && (
          <p className="issue error" role="alert">
            {problem}
          </p>
        )}
        {scale && (
          <p className="props-note" data-testid="calibrate-result">
            {round(pixels, 1)} pixels = {round(distance)} mm, so the picture is {round(r.pixels[0] * scale)} ×{" "}
            {round(r.pixels[1] * scale)} mm.
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!scale} onClick={() => scale && props.onApply(scale)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
