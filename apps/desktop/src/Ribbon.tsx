// The ribbon: tabs of labelled buttons in named groups, like Autodesk's. Minimised, only the tab names show and a
// tab opens over the 3D view when clicked; double-clicking a tab name minimises or restores it, as in Civil 3D.
import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export interface RibbonItem {
  icon: IconName;
  /** The short name under the button. */
  label: string;
  /** What a screen reader says, when it should say more than the label ("Add box"). */
  name?: string;
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** Why it can't be used right now, added to its tooltip. */
  reason?: string;
  /** Large buttons are the group's main commands; small ones stack three high. */
  size?: "large" | "small";
}

export interface RibbonGroup {
  label: string;
  items: RibbonItem[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

interface Props {
  tabs: RibbonTab[];
  minimized: boolean;
  onMinimized: (minimized: boolean) => void;
  /** Where the tab names go: in the top bar, so the ribbon takes one row less of the screen. */
  tabsHost?: HTMLElement | null;
}

export const Ribbon = forwardRef<HTMLElement, Props>(function Ribbon({ tabs, minimized, onMinimized, tabsHost }, ref) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  // Minimised, a tab opens over the view until something is used or the pointer clicks elsewhere.
  const [open, setOpen] = useState(false);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  const panelRef = useRef<HTMLDivElement>(null);
  const showPanel = !minimized || open;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!panelRef.current?.contains(t) && !t.closest?.(".ribbon-tabs")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // A different set of tabs (Design and Print Studio have their own) opens on its first one, like Home.
  const tabSet = tabs.map((t) => t.id).join(",");
  useEffect(() => {
    if (tabs[0]) setActive(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSet]);

  if (!tab) return null;
  const tablist = (
    <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`ribbon-tab-${t.id}`}
          aria-selected={showPanel && t.id === tab.id}
          aria-controls="ribbon-panel"
          title={minimized ? "Click to open; double-click to keep the ribbon open" : "Double-click to minimise"}
          onClick={() => {
            setActive(t.id);
            if (minimized) setOpen((o) => !(o && t.id === tab.id));
          }}
          onDoubleClick={() => {
            setOpen(false);
            onMinimized(!minimized);
          }}
        >
          {t.label}
        </button>
      ))}
      <button
        type="button"
        className="ribbon-minimize"
        aria-label={minimized ? "Show the ribbon" : "Minimise the ribbon"}
        aria-pressed={minimized}
        title={minimized ? "Show the ribbon" : "Minimise the ribbon to its tab names"}
        onClick={() => {
          setOpen(false);
          onMinimized(!minimized);
        }}
      >
        <Icon name={minimized ? "chevronDown" : "chevronUp"} />
      </button>
    </div>
  );
  return (
    <section
      className={`ribbon${minimized ? " minimized" : ""}${open ? " open" : ""}`}
      aria-label="Ribbon"
      ref={ref}
      data-testid="ribbon"
    >
      {tabsHost ? createPortal(tablist, tabsHost) : tablist}
      {showPanel && (
        <div
          className="ribbon-panel"
          id="ribbon-panel"
          role="tabpanel"
          aria-labelledby={`ribbon-tab-${tab.id}`}
          ref={panelRef}
        >
          {tab.groups.map((g) => (
            <div className="ribbon-group" key={g.label} role="group" aria-label={g.label} title={g.label}>
              <div className="ribbon-items">
                {g.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`ribbon-button ${item.size ?? "large"}`}
                    aria-label={item.name ?? item.label}
                    aria-pressed={item.pressed}
                    title={item.disabled && item.reason ? `${item.title ?? item.label} (${item.reason})` : item.title}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick();
                      setOpen(false);
                    }}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
