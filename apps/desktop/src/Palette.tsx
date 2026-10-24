// A docked palette, like Civil 3D's Toolspace or Properties: a title bar, a body that scrolls, an inner edge to drag
// for width (or arrow keys on it), and a button that folds it to a thin strip at the window's edge.
import { useRef, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { PALETTE_MAX_WIDTH, PALETTE_MIN_WIDTH, clampWidth, type PaletteLayout, type Side } from "./workspace";

interface Props {
  title: string;
  icon: IconName;
  side: Side;
  layout: PaletteLayout;
  onLayout: (patch: Partial<PaletteLayout>) => void;
  children: ReactNode;
  className?: string;
}

export function Palette({ title, icon, side, layout, onLayout, children, className }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const cls = ["palette", `on-${side}`, layout.collapsed && "collapsed", className].filter(Boolean).join(" ");
  if (layout.collapsed)
    return (
      <aside className={cls} aria-label={title} data-palette={title}>
        <button
          type="button"
          className="palette-strip"
          aria-label={`Open ${title}`}
          title={`Open ${title}`}
          onClick={() => onLayout({ collapsed: false })}
        >
          <Icon name={icon} />
          <span>{title}</span>
        </button>
      </aside>
    );
  // Dragging the inner edge: outwards (away from the window's edge) makes it wider.
  const towardsCentre = side === "left" ? 1 : -1;
  return (
    <aside className={cls} aria-label={title} data-palette={title} style={{ width: layout.width }}>
      <header className="palette-header">
        <Icon name={icon} />
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Collapse ${title}`}
          title={`Fold ${title} to the edge`}
          onClick={() => onLayout({ collapsed: true })}
        >
          <Icon name={side === "left" ? "chevronLeft" : "chevronRight"} />
        </button>
      </header>
      <div className="palette-body">{children}</div>
      <div
        className="palette-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title}`}
        aria-valuenow={layout.width}
        aria-valuemin={PALETTE_MIN_WIDTH}
        aria-valuemax={PALETTE_MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, width: layout.width };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          onLayout({ width: clampWidth(drag.current.width + (e.clientX - drag.current.x) * towardsCentre) });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          if (e.key === "ArrowLeft") onLayout({ width: clampWidth(layout.width - step * towardsCentre) });
          else if (e.key === "ArrowRight") onLayout({ width: clampWidth(layout.width + step * towardsCentre) });
          else return;
          e.preventDefault();
        }}
      />
    </aside>
  );
}
