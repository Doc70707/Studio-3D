// Settings: everything about how Studio 3D looks and behaves, in a few categories (appearance, the 3D view, units,
// snaps and navigation, the workspace). Every change shows at once on the app behind, so it can be judged in place;
// Cancel puts back everything as it was when the window opened, Done keeps it, and Reset puts one category back to how
// it starts. None of it is part of a design: no setting here changes a part's shape or its file.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ACCENTS,
  BACKGROUNDS,
  DEFAULT_APPEARANCE,
  PART_COLORS,
  PLATE_SIZES,
  THEMES,
  type AccentId,
  type Appearance,
  type PartColorId,
  type ThemeId,
} from "./appearance";
import { Icon, type IconName } from "./Icon";
import { DEFAULT_SNAPS, SNAP_HINTS, SNAP_KINDS, SNAP_LABELS, type SnapKind } from "./precision";
import type { SnapSettings } from "./snapSettings";
import type { DisplayUnits } from "@studio3d/document";
import { DEFAULT_WORKSPACE, type Workspace } from "./workspace";

export type SettingsCategory = "appearance" | "view" | "units" | "navigation" | "workspace";

const CATEGORIES: { id: SettingsCategory; label: string; icon: IconName; hint: string }[] = [
  { id: "appearance", label: "Appearance", icon: "palette", hint: "Theme, accent colour and the part's colour" },
  { id: "view", label: "Viewport and grid", icon: "grid", hint: "The build plate, the grid and the background" },
  { id: "units", label: "Units", icon: "ruler", hint: "How sizes are shown and typed" },
  { id: "navigation", label: "Snaps and navigation", icon: "pointer", hint: "Object snaps, mouse and keys" },
  { id: "workspace", label: "Workspace", icon: "sidePanel", hint: "Palettes, ribbon, command line and density" },
];

export interface SettingsValues {
  appearance: Appearance;
  units: DisplayUnits;
  workspace: Workspace;
  snaps: SnapSettings;
}

interface Props {
  value: SettingsValues;
  category: SettingsCategory;
  onCategory: (c: SettingsCategory) => void;
  onAppearance: (a: Appearance) => void;
  onUnits: (u: DisplayUnits) => void;
  onWorkspace: (w: Workspace) => void;
  onSnaps: (s: SnapSettings) => void;
  /** The mouse and keyboard reference, as shown in Help. */
  shortcuts: [string, string][];
  onClose: () => void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const sizeName = (mm: number) => (mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`);

export function SettingsWindow(props: Props) {
  const { value, category } = props;
  const ref = useRef<HTMLDivElement>(null);
  // Everything as it was when the window opened, for Cancel.
  const [before] = useState(value);
  const cancel = () => {
    props.onAppearance(before.appearance);
    props.onUnits(before.units);
    props.onWorkspace(before.workspace);
    props.onSnaps(before.snaps);
    props.onClose();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const a = value.appearance;
  const setA = (patch: Partial<Appearance>) => props.onAppearance({ ...a, ...patch });
  const w = value.workspace;
  const setW = (patch: Partial<Workspace>) => props.onWorkspace({ ...w, ...patch });
  const reset = () => {
    if (category === "appearance")
      setA({ theme: DEFAULT_APPEARANCE.theme, accent: DEFAULT_APPEARANCE.accent, part: DEFAULT_APPEARANCE.part });
    if (category === "view")
      setA({
        plate: DEFAULT_APPEARANCE.plate,
        plateSize: DEFAULT_APPEARANCE.plateSize,
        grid: DEFAULT_APPEARANCE.grid,
        background: DEFAULT_APPEARANCE.background,
      });
    if (category === "units") props.onUnits("mm");
    if (category === "navigation") props.onSnaps({ on: true, kinds: [...DEFAULT_SNAPS] });
    if (category === "workspace") {
      props.onWorkspace({
        ...w,
        style: DEFAULT_WORKSPACE.style,
        ribbonMinimized: DEFAULT_WORKSPACE.ribbonMinimized,
        commandLine: DEFAULT_WORKSPACE.commandLine,
      });
      setA({ density: DEFAULT_APPEARANCE.density });
    }
  };
  const current = CATEGORIES.find((c) => c.id === category)!;
  const dark = THEMES[a.theme].dark;

  // Up and down move between the categories, as in any list of tabs.
  const onTabKey = (e: ReactKeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = CATEGORIES.findIndex((c) => c.id === category);
    const next = CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!;
    props.onCategory(next.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`#settings-tab-${next.id}`)?.focus());
  };

  return (
    <div className="settings glass-solid" role="dialog" aria-label="Settings" ref={ref}>
      <nav
        className="settings-nav"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Categories"
        onKeyDown={onTabKey}
      >
        <h2>Settings</h2>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            id={`settings-tab-${c.id}`}
            aria-selected={c.id === category}
            aria-label={c.label}
            title={c.hint}
            aria-controls="settings-panel"
            tabIndex={c.id === category ? 0 : -1}
            onClick={() => props.onCategory(c.id)}
          >
            <Icon name={c.icon} />
            <span>{c.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-main">
        <header>
          <div>
            <h3>{current.label}</h3>
            <p>{current.hint}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div
          className="settings-panel"
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${category}`}
        >
          {category === "appearance" && (
            <>
              <Choices
                label="Theme"
                options={(Object.keys(THEMES) as ThemeId[]).map((id) => ({
                  id,
                  name: THEMES[id].label,
                  swatch: (
                    <span
                      className="theme-swatch"
                      style={{ background: THEMES[id].colors.chrome, borderColor: THEMES[id].colors["chrome-edge"] }}
                    >
                      <span style={{ background: THEMES[id].colors["bg-2"] }} />
                      <span style={{ background: THEMES[id].colors.text }} />
                    </span>
                  ),
                }))}
                value={a.theme}
                onPick={(theme) => setA({ theme })}
                wide
              />
              <Choices
                label="Accent colour"
                options={(Object.keys(ACCENTS) as AccentId[]).map((id) => ({
                  id,
                  name: ACCENTS[id].label,
                  swatch: (
                    <span className="dot-swatch" style={{ background: ACCENTS[id][dark ? "dark" : "light"].button }} />
                  ),
                }))}
                value={a.accent}
                onPick={(accent) => setA({ accent })}
              />
              <Choices
                label="Part colour"
                hint="Pick your filament's colour to see the part as it will print."
                options={(Object.keys(PART_COLORS) as PartColorId[]).map((id) => ({
                  id,
                  name: PART_COLORS[id].label,
                  swatch: <span className="dot-swatch" style={{ background: hex(PART_COLORS[id].color) }} />,
                }))}
                value={a.part}
                onPick={(part) => setA({ part })}
              />
            </>
          )}

          {category === "view" && (
            <>
              <Choices
                label="Build plate"
                hint="Off, the part floats on the background with just a grid, as in Civil 3D's model space (PLATE)."
                options={[
                  { id: "on", name: "Plate", swatch: null },
                  { id: "off", name: "No plate", swatch: null },
                ]}
                value={a.plate ? "on" : "off"}
                onPick={(v) => setA({ plate: v === "on" })}
                pills
              />
              {a.plate && (
                <Choices
                  label="Plate size"
                  hint="Print Studio always shows your printer's own plate."
                  options={PLATE_SIZES.map((mm) => ({ id: String(mm), name: sizeName(mm), swatch: null }))}
                  value={String(a.plateSize)}
                  onPick={(v) => setA({ plateSize: Number(v) })}
                  pills
                />
              )}
              <Choices
                label="Grid"
                hint="Finer squares show as you zoom in, coarser ones as you zoom out (F7)."
                options={[
                  { id: "on", name: "Show grid", swatch: null },
                  { id: "off", name: "No grid", swatch: null },
                ]}
                value={a.grid ? "on" : "off"}
                onPick={(v) => setA({ grid: v === "on" })}
                pills
              />
              <section className="settings-group">
                <Choices
                  label="Background"
                  bare
                  options={BACKGROUNDS.map((b) => ({
                    id: b.id,
                    name: b.label,
                    swatch:
                      b.id === "theme" ? (
                        <span
                          className="dot-swatch"
                          style={{
                            background: `linear-gradient(180deg, ${THEMES[a.theme].colors["bg-2"]}, ${THEMES[a.theme].colors["bg-1"]})`,
                          }}
                        />
                      ) : (
                        <span className="dot-swatch" style={{ background: b.id }} />
                      ),
                  }))}
                  value={BACKGROUNDS.some((b) => b.id === a.background) ? a.background : "custom"}
                  onPick={(background) => setA({ background })}
                />
                <label className="any-colour">
                  <input
                    type="color"
                    aria-label="Any background colour"
                    value={a.background === "theme" ? "#212830" : a.background}
                    onChange={(e) => setA({ background: e.target.value.toLowerCase() })}
                  />
                  <span>
                    {BACKGROUNDS.some((b) => b.id === a.background) ? "Any colour…" : `Your colour ${a.background}`}
                  </span>
                </label>
              </section>
            </>
          )}

          {category === "units" && (
            <Choices
              label="Sizes in"
              hint="Only how sizes are shown and typed. The part stays exactly the same size; a size can always be typed with its own unit (6 mm, 1/4 in)."
              options={[
                { id: "mm", name: "Millimetres", swatch: null },
                { id: "in", name: "Inches", swatch: null },
              ]}
              value={value.units}
              onPick={(u) => props.onUnits(u as DisplayUnits)}
              pills
            />
          )}

          {category === "navigation" && (
            <>
              <Choices
                label="Object snaps"
                hint="Points the pointer jumps to while drawing and measuring (F3 turns them all off and on)."
                options={[
                  { id: "on", name: "Snaps on", swatch: null },
                  { id: "off", name: "Snaps off", swatch: null },
                ]}
                value={value.snaps.on ? "on" : "off"}
                onPick={(v) => props.onSnaps({ ...value.snaps, on: v === "on" })}
                pills
              />
              <section className="settings-group">
                <h4 id="settings-snap-kinds">Snap to</h4>
                <div className="check-grid" role="group" aria-labelledby="settings-snap-kinds">
                  {SNAP_KINDS.map((k: SnapKind) => (
                    <label key={k} title={SNAP_HINTS[k]}>
                      <input
                        type="checkbox"
                        checked={value.snaps.kinds.includes(k)}
                        disabled={!value.snaps.on}
                        onChange={(e) =>
                          props.onSnaps({
                            ...value.snaps,
                            kinds: e.target.checked
                              ? SNAP_KINDS.filter((x) => x === k || value.snaps.kinds.includes(x))
                              : value.snaps.kinds.filter((x) => x !== k),
                          })
                        }
                      />
                      <span>{SNAP_LABELS[k]}</span>
                    </label>
                  ))}
                </div>
              </section>
              <section className="settings-group">
                <h4>Mouse and keys</h4>
                <dl className="shortcut-list">
                  {props.shortcuts.map(([what, how]) => (
                    <div key={what}>
                      <dt>{what}</dt>
                      <dd>{how}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}

          {category === "workspace" && (
            <>
              <Choices
                label="Palettes"
                hint="Docked palettes sit against the window's edges; floating ones are frosted glass over the 3D view."
                options={[
                  { id: "docked", name: "Docked", swatch: null },
                  { id: "floating", name: "Floating", swatch: null },
                ]}
                value={w.style}
                onPick={(style) => setW({ style: style as Workspace["style"] })}
                pills
              />
              <Choices
                label="Density"
                hint="Compact fits more on the screen; comfortable gives every control more room."
                options={[
                  { id: "comfortable", name: "Comfortable", swatch: null },
                  { id: "compact", name: "Compact", swatch: null },
                ]}
                value={a.density}
                onPick={(density) => setA({ density: density as Appearance["density"] })}
                pills
              />
              <Choices
                label="Ribbon"
                options={[
                  { id: "full", name: "Full", swatch: null },
                  { id: "tabs", name: "Tab names only", swatch: null },
                ]}
                value={w.ribbonMinimized ? "tabs" : "full"}
                onPick={(v) => setW({ ribbonMinimized: v === "tabs" })}
                pills
              />
              <Choices
                label="Command line"
                hint="Type commands by name, as in AutoCAD (Ctrl+9)."
                options={[
                  { id: "on", name: "Shown", swatch: null },
                  { id: "off", name: "Hidden", swatch: null },
                ]}
                value={w.commandLine ? "on" : "off"}
                onPick={(v) => setW({ commandLine: v === "on" })}
                pills
              />
            </>
          )}
        </div>
        <footer className="settings-actions">
          <button type="button" onClick={reset} title={`Put ${current.label.toLowerCase()} back as it starts`}>
            Reset {current.label.toLowerCase()}
          </button>
          <span className="spacer" />
          <button type="button" onClick={cancel} title="Put back everything as it was when Settings opened (Esc)">
            Cancel
          </button>
          <button type="button" className="primary" onClick={props.onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Choices<T extends string>(props: {
  label: string;
  hint?: string;
  options: { id: T; name: string; swatch: ReactNode }[];
  value: T;
  onPick: (id: T) => void;
  wide?: boolean;
  /** Words in a row, like a segmented control, instead of round swatches. */
  pills?: boolean;
  /** Inside a section of its own already. */
  bare?: boolean;
}) {
  const { options, value, onPick } = props;
  // Arrow keys move between the choices, as in any radio group.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const group = e.currentTarget as HTMLElement;
    const i = Math.max(
      0,
      options.findIndex((o) => o.id === value),
    );
    const next = options[(i + step + options.length) % options.length]!;
    onPick(next.id);
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus());
  };
  const id = `settings-${props.label.replace(/\s+/g, "-")}`;
  // Nothing picked (a colour of your own): the first choice takes the Tab stop.
  const stop = options.some((o) => o.id === value) ? value : options[0]?.id;
  const body = (
    <>
      <h4 id={id}>{props.label}</h4>
      {props.hint && <p className="hint-line">{props.hint}</p>}
      <div
        className={`choices${props.wide ? " wide" : ""}${props.pills ? " pills" : ""}`}
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={onKeyDown}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            data-id={o.id}
            aria-checked={o.id === value}
            aria-label={o.name}
            title={o.name}
            tabIndex={o.id === stop ? 0 : -1}
            onClick={() => onPick(o.id)}
          >
            {o.swatch}
            {(props.wide || props.pills) && <span>{o.name}</span>}
          </button>
        ))}
      </div>
    </>
  );
  return props.bare ? body : <section className="settings-group">{body}</section>;
}
