// The first start: pick how much of Studio 3D to see, Kids, Easy or Advanced. Easy is picked to begin with, so Enter
// starts at once. It only decides what is on show and can be changed any time in Settings; a design made in one mode
// opens the same in the others.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { DEFAULT_EXPERIENCE, EXPERIENCES, EXPERIENCE_ORDER, type Experience } from "./experience";
import { Icon } from "./Icon";

export function Welcome({ onPick }: { onPick: (e: Experience) => void }) {
  const [choice, setChoice] = useState<Experience>(DEFAULT_EXPERIENCE);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    group.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Enter") {
      e.preventDefault();
      onPick(choice);
      return;
    }
    if (!step) return;
    e.preventDefault();
    const next = EXPERIENCE_ORDER[(EXPERIENCE_ORDER.indexOf(choice) + step + 3) % 3]!;
    setChoice(next);
    requestAnimationFrame(() => group.current?.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus());
  };

  return (
    <div className="welcome-scrim">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <span className="logo welcome-mark" aria-hidden="true" />
        <h2 id="welcome-title">Welcome to Studio 3D</h2>
        <p className="welcome-lead">How much would you like to see? You can change this any time in Settings.</p>
        <div className="welcome-choices" role="radiogroup" aria-label="Experience" ref={group} onKeyDown={onKeyDown}>
          {EXPERIENCE_ORDER.map((id) => {
            const x = EXPERIENCES[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                data-id={id}
                aria-checked={choice === id}
                aria-label={x.label}
                aria-describedby={`welcome-${id}`}
                tabIndex={choice === id ? 0 : -1}
                onClick={() => setChoice(id)}
                onDoubleClick={() => onPick(id)}
              >
                <span className="welcome-choice-head">
                  <span className="name">{x.label}</span>
                  {id === DEFAULT_EXPERIENCE && <span className="badge">Recommended</span>}
                </span>
                <span className="blurb" id={`welcome-${id}`}>
                  {x.blurb}
                </span>
                <ul>
                  {x.detail.map((d) => (
                    <li key={d}>
                      <Icon name="check" />
                      {d}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        <button type="button" className="primary welcome-start" onClick={() => onPick(choice)}>
          Start in {EXPERIENCES[choice].label}
        </button>
      </div>
    </div>
  );
}
