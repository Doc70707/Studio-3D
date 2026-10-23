// Appearance: pick a theme, an accent colour, the part's colour and what lies around it (the build plate and its size,
// or a plain background of any colour as in Civil 3D's model space), and see each change straight away. It floats
// beside the work instead of dimming it, so the effect is visible while choosing.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ACCENTS,
  BACKGROUNDS,
  DEFAULT_APPEARANCE,
  PLATE_SIZES,
  PART_COLORS,
  THEMES,
  type AccentId,
  type Appearance,
  type PartColorId,
  type ThemeId,
} from "./appearance";
import { Icon } from "./Icon";

interface Props {
  value: Appearance;
  onChange: (a: Appearance) => void;
  onClose: () => void;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const sizeName = (mm: number) => (mm >= 1000 ? `${mm / 1000} m` : `${mm} mm`);

export function AppearancePanel({ value, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current && !ref.current.contains(t) && !t.closest?.("[data-opens='appearance']")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const dark = THEMES[value.theme].dark;
  return (
    <div className="appearance glass" role="dialog" aria-label="Appearance" ref={ref}>
      <header>
        <h2>Appearance</h2>
        <button type="button" className="icon-button" aria-label="Close appearance" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

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
        value={value.theme}
        onPick={(theme) => onChange({ ...value, theme })}
        wide
      />

      <Choices
        label="Accent colour"
        options={(Object.keys(ACCENTS) as AccentId[]).map((id) => ({
          id,
          name: ACCENTS[id].label,
          swatch: <span className="dot-swatch" style={{ background: ACCENTS[id][dark ? "dark" : "light"].button }} />,
        }))}
        value={value.accent}
        onPick={(accent) => onChange({ ...value, accent })}
      />

      <Choices
        label="Part colour"
        hint="Pick your filament's colour to see the part as it will print."
        options={(Object.keys(PART_COLORS) as PartColorId[]).map((id) => ({
          id,
          name: PART_COLORS[id].label,
          swatch: <span className="dot-swatch" style={{ background: hex(PART_COLORS[id].color) }} />,
        }))}
        value={value.part}
        onPick={(part) => onChange({ ...value, part })}
      />

      <Choices
        label="Build plate"
        hint="Off, the part floats on the background with just a grid, as in Civil 3D's model space (PLATE)."
        options={[
          { id: "on", name: "Plate", swatch: null },
          { id: "off", name: "No plate", swatch: null },
        ]}
        value={value.plate ? "on" : "off"}
        onPick={(v) => onChange({ ...value, plate: v === "on" })}
        pills
      />

      {value.plate && (
        <Choices
          label="Plate size"
          hint="Print Studio always shows your printer's own plate."
          options={PLATE_SIZES.map((mm) => ({ id: String(mm), name: sizeName(mm), swatch: null }))}
          value={String(value.plateSize)}
          onPick={(v) => onChange({ ...value, plateSize: Number(v) })}
          pills
        />
      )}

      <Choices
        label="Grid"
        options={[
          { id: "on", name: "Show grid", swatch: null },
          { id: "off", name: "No grid", swatch: null },
        ]}
        value={value.grid ? "on" : "off"}
        onPick={(v) => onChange({ ...value, grid: v === "on" })}
        pills
      />

      <section className="appearance-group">
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
                    background: `linear-gradient(180deg, ${THEMES[value.theme].colors["bg-2"]}, ${THEMES[value.theme].colors["bg-1"]})`,
                  }}
                />
              ) : (
                <span className="dot-swatch" style={{ background: b.id }} />
              ),
          }))}
          value={BACKGROUNDS.some((b) => b.id === value.background) ? value.background : "custom"}
          onPick={(background) => onChange({ ...value, background })}
        />
        <label className="any-colour">
          <input
            type="color"
            aria-label="Any background colour"
            value={value.background === "theme" ? "#212830" : value.background}
            onChange={(e) => onChange({ ...value, background: e.target.value.toLowerCase() })}
          />
          <span>
            {BACKGROUNDS.some((b) => b.id === value.background) ? "Any colour…" : `Your colour ${value.background}`}
          </span>
        </label>
      </section>

      <div className="actions">
        <button
          type="button"
          onClick={() =>
            onChange({ ...DEFAULT_APPEARANCE, plate: value.plate, plateSize: value.plateSize, grid: value.grid })
          }
        >
          Default colours
        </button>
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
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
    const i = Math.max(
      0,
      options.findIndex((o) => o.id === value),
    );
    const next = options[(i + step + options.length) % options.length]!;
    onPick(next.id);
    requestAnimationFrame(() =>
      (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus(),
    );
  };
  const id = `appearance-${props.label.replace(/\s+/g, "-")}`;
  // Nothing picked (a colour of your own): the first choice takes the Tab stop.
  const stop = options.some((o) => o.id === value) ? value : options[0]?.id;
  const body = (
    <>
      <h3 id={id}>{props.label}</h3>
      {props.hint && <p className="muted">{props.hint}</p>}
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
  return props.bare ? body : <section className="appearance-group">{body}</section>;
}
