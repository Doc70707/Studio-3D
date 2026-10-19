// The right-click menu of the 3D view and the sketch, like Civil 3D's: it opens at the pointer, stays inside the
// view, and offers the object snaps that make sense at that spot, plus a few commands for what is under the pointer.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SNAP_HINTS, SNAP_KEYS, SNAP_LABELS, type SnapKind } from "./precision";

/** Each snap's mark, AutoCAD style: a square for an end, a triangle for a middle, a circle for a centre and so on. */
export function snapShape(kind: SnapKind, x: number, y: number, r = 6) {
  switch (kind) {
    case "end":
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} />;
    case "middle":
      return <path d={`M${x},${y - r}L${x + r},${y + r}L${x - r},${y + r}Z`} />;
    case "centre":
      return <circle cx={x} cy={y} r={r} />;
    case "geometric":
      return (
        <path
          d={`M${x},${y - r}L${x + r},${y - r * 0.3}L${x + r * 0.6},${y + r}L${x - r * 0.6},${y + r}L${x - r},${y - r * 0.3}ZM${x - 1},${y}h2`}
        />
      );
    case "quadrant":
      return <path d={`M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`} />;
    case "intersection":
      return <path d={`M${x - r},${y - r}L${x + r},${y + r}M${x - r},${y + r}L${x + r},${y - r}`} />;
    case "perpendicular":
      return <path d={`M${x - r},${y + r}H${x + r}M${x},${y + r}V${y - r}`} />;
    case "tangent":
      return (
        <path
          d={`M${x - r},${y - r}H${x + r}M${x - r * 0.7},${y + r * 0.15}a${r * 0.7},${r * 0.7} 0 1,0 ${r * 1.4},0a${r * 0.7},${r * 0.7} 0 1,0 ${-r * 1.4},0`}
        />
      );
    case "nearest":
      return <path d={`M${x - r},${y - r}L${x + r},${y + r}L${x - r},${y + r}L${x + r},${y - r}Z`} />;
    case "node":
      return (
        <path
          d={`M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0M${x - r * 0.6},${y - r * 0.6}L${x + r * 0.6},${y + r * 0.6}M${x - r * 0.6},${y + r * 0.6}L${x + r * 0.6},${y - r * 0.6}`}
        />
      );
    case "grid":
      return <path d={`M${x - r},${y}H${x + r}M${x},${y - r}V${y + r}`} />;
  }
}

/** The same marks the view shows for each snap, small, for menus. */
export function SnapGlyph({ kind }: { kind: SnapKind }) {
  return (
    <svg className="snap-glyph" viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true">
      {snapShape(kind, 0, 0)}
    </svg>
  );
}

export interface SnapChoice {
  kind: SnapKind;
  /** Why it can't be used here, or null when it can. */
  unavailable: string | null;
}

export interface MenuCommand {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: string;
  run: () => void;
}

/**
 * The menu itself. `snaps` are offered for the next point (picking one uses it once), each with a box to keep it on;
 * `once` is the snap already chosen for the next point. `commands` follow underneath.
 */
export function ContextMenu(props: {
  /** Where the pointer was, in window pixels. */
  at: { x: number; y: number };
  /** The view the menu must stay inside. */
  bounds: DOMRect;
  /** What is under the pointer, e.g. "Edge (circle Ø10 mm)". */
  title: string;
  snaps: SnapChoice[];
  kept: readonly SnapKind[];
  snapping: boolean;
  once: SnapKind | null;
  onOnce: (kind: SnapKind) => void;
  onKeep: (kind: SnapKind) => void;
  commands: MenuCommand[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const { onClose } = props;

  // Opens at the pointer, flipped left or up where it would run out of the view.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const b = props.bounds;
    const pad = 8;
    let left = props.at.x + 2;
    let top = props.at.y + 2;
    if (left + w > b.right - pad) left = Math.max(b.left + pad, props.at.x - w - 2);
    if (top + h > b.bottom - pad) top = Math.max(b.top + pad, b.bottom - pad - h);
    setPlace({ left, top });
  }, [props.at.x, props.at.y, props.bounds]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>("[data-item]:not([aria-disabled])") ?? [])];
  useEffect(() => {
    ref.current?.focus();
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      return onClose();
    }
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = list.length;
      const next = i < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      list[next]?.focus();
      return;
    }
    // A snap's letter (as in AutoCAD's abbreviations) picks it for the next point.
    const kind = props.snaps.find((s) => !s.unavailable && SNAP_KEYS[s.kind] === e.key.toUpperCase())?.kind;
    if (kind && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      props.onOnce(kind);
      onClose();
    }
  };

  const available = props.snaps.filter((s) => !s.unavailable);
  return (
    <div
      className="context-menu glass"
      role="menu"
      aria-label="Right-click menu"
      tabIndex={-1}
      ref={ref}
      style={place ? { left: place.left, top: place.top } : { left: props.at.x, top: props.at.y, visibility: "hidden" }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-title" data-testid="context-title">
        {props.title}
      </div>
      {props.snaps.length > 0 && (
        <>
          <div className="context-heading" id="snap-next">
            Snap the next point to
            {!props.snapping && <span className="context-off"> (snapping is off)</span>}
          </div>
          <div role="group" aria-labelledby="snap-next">
            {props.snaps.map(({ kind, unavailable }) => {
              const kept = props.kept.includes(kind);
              return (
                <div key={kind} className={`context-snap${unavailable ? " unavailable" : ""}`}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={props.once === kind}
                    aria-disabled={unavailable ? true : undefined}
                    data-item
                    className="menu-item"
                    title={unavailable ?? SNAP_HINTS[kind]}
                    onClick={() => {
                      if (unavailable) return;
                      props.onOnce(kind);
                      onClose();
                    }}
                  >
                    <SnapGlyph kind={kind} />
                    <span className="menu-label">{SNAP_LABELS[kind]}</span>
                    <kbd aria-hidden="true">{SNAP_KEYS[kind]}</kbd>
                  </button>
                  <label className="context-keep" title={`Keep ${SNAP_LABELS[kind]} on for every point`}>
                    <input
                      type="checkbox"
                      checked={kept}
                      aria-label={`Keep ${SNAP_LABELS[kind]} on`}
                      onChange={() => props.onKeep(kind)}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          {available.length === 0 && <p className="context-note">Nothing to snap to near here.</p>}
          <div role="separator" className="menu-sep" />
        </>
      )}
      {props.commands.map((c) => (
        <button
          key={c.label}
          type="button"
          role={c.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={c.checked}
          aria-disabled={c.disabled ? true : undefined}
          data-item
          className={`menu-item${c.disabled ? " disabled" : ""}`}
          title={c.disabled}
          onClick={() => {
            if (c.disabled) return;
            onClose();
            c.run();
          }}
        >
          <span className="menu-check" aria-hidden="true">
            {c.checked ? "✓" : ""}
          </span>
          <span className="menu-label">{c.label}</span>
          {c.shortcut && <kbd aria-hidden="true">{c.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
