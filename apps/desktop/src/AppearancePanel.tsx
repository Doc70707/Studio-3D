// Appearance: pick a theme, an accent colour and the part's colour, and see each change on the app straight away.
// It floats beside the work instead of dimming it, so the effect is visible while choosing.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
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

      <div className="actions">
        <button type="button" onClick={() => onChange(DEFAULT_APPEARANCE)}>
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
}) {
  const { options, value, onPick } = props;
  // Arrow keys move between the choices, as in any radio group.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = options[(i + step + options.length) % options.length]!;
    onPick(next.id);
    requestAnimationFrame(() =>
      (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus(),
    );
  };
  return (
    <section className="appearance-group">
      <h3 id={`appearance-${props.label}`}>{props.label}</h3>
      {props.hint && <p className="muted">{props.hint}</p>}
      <div
        className={`choices${props.wide ? " wide" : ""}`}
        role="radiogroup"
        aria-labelledby={`appearance-${props.label}`}
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
            tabIndex={o.id === value ? 0 : -1}
            onClick={() => onPick(o.id)}
          >
            {o.swatch}
            {props.wide && <span>{o.name}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
