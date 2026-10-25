// The camera controls over the 3D view, as one compact group in three parts: where you look from (a live compass of
// the X, Y and Z axes that turns with the view, and the standard views), how it is drawn (perspective or
// orthographic), and what is shown on it (the part's sizes).
import type { CameraState, StandardView } from "@studio3d/viewport";
import { Icon } from "./Icon";

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where the X, Y and Z axes point on screen for a camera: each as [right, up] (from -1 to 1) and how far it points
 * towards you, so the compass can draw the nearer axes over the farther ones.
 */
export function axesOnScreen(camera: Pick<CameraState, "position" | "target">): Record<"x" | "y" | "z", Vec3> {
  const forward = unit(sub(camera.target, camera.position));
  let right = cross(forward, [0, 0, 1]);
  // Looking straight down (or up), "up" on screen is the back of the plate, as in the top view.
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  right = unit(right);
  const up = cross(right, forward);
  const on = (a: Vec3): Vec3 => [dot(a, right), dot(a, up), -dot(a, forward)];
  return { x: on([1, 0, 0]), y: on([0, 1, 0]), z: on([0, 0, 1]) };
}

const AXES = [
  { id: "x", color: "#f0605a" },
  { id: "y", color: "#5fd068" },
  { id: "z", color: "#5b9cff" },
] as const;

export interface ViewButton {
  view: StandardView;
  label: string;
  key: string;
}

interface Props {
  camera: CameraState | null;
  views: ViewButton[];
  ortho: boolean;
  sizes: boolean;
  disabled: boolean;
  projectionKey: string;
  onView: (view: StandardView) => void;
  onOrtho: () => void;
  onSizes: () => void;
}

export function ViewNav({ camera, views, ortho, sizes, disabled, projectionKey, onView, onOrtho, onSizes }: Props) {
  const axes = camera ? axesOnScreen(camera) : null;
  const R = 17; // the axes' length in the compass, in its own units (it is 48 across)
  const drawn = axes ? [...AXES].sort((a, b) => axes[a.id][2] - axes[b.id][2]) : [];
  const [home, ...faces] = views;
  return (
    <nav className="view-nav glass" aria-label="Camera views">
      {home && (
        <button
          type="button"
          className="compass"
          aria-label={home.label}
          aria-pressed={camera?.view === home.view}
          title={`${home.label} view (key ${home.key}). The compass shows which way X, Y and Z point.`}
          onClick={() => onView(home.view)}
          disabled={disabled}
        >
          <svg viewBox="-24 -24 48 48" width="48" height="48" aria-hidden="true">
            <circle className="compass-ring" r="22" />
            {drawn.map(({ id, color }) => {
              const [x, y, toward] = axes![id];
              const [ex, ey] = [x * R, -y * R];
              // An axis pointing away is drawn fainter, so the compass reads as 3D at a glance.
              const o = toward >= 0 ? 1 : 0.45;
              return (
                <g key={id} opacity={o} data-axis={id}>
                  <line x1="0" y1="0" x2={ex} y2={ey} stroke={color} strokeWidth="2" strokeLinecap="round" />
                  <circle cx={ex} cy={ey} r="5.2" fill={color} />
                  <text x={ex} y={ey} dy="2.4" textAnchor="middle">
                    {id.toUpperCase()}
                  </text>
                </g>
              );
            })}
            <circle r="1.8" className="compass-hub" />
          </svg>
          <span className="compass-label">{home.label}</span>
        </button>
      )}
      <div className="view-faces" role="group" aria-label="Standard views">
        {faces.map((b) => (
          <button
            key={b.view}
            type="button"
            aria-pressed={camera?.view === b.view}
            title={`${b.label} view (key ${b.key}; Shift+${b.key} looks from the other side)`}
            onClick={() => onView(b.view)}
            disabled={disabled}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="view-tools" role="group" aria-label="Drawing">
        <button
          type="button"
          aria-pressed={ortho}
          aria-label="Orthographic"
          title={`Orthographic: no perspective, parallel edges stay parallel (key ${projectionKey})`}
          onClick={onOrtho}
          disabled={disabled}
        >
          <Icon name="ortho" />
          <span>Ortho</span>
        </button>
        <button
          type="button"
          aria-pressed={sizes}
          title="Show sizes in the 3D view (DIM)"
          onClick={onSizes}
          disabled={disabled}
        >
          <Icon name="ruler" />
          <span>Sizes</span>
        </button>
      </div>
    </nav>
  );
}
