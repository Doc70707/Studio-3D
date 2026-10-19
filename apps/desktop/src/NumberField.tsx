import { useEffect, useId, useState } from "react";
import type { Issue } from "@studio3d/document";

/** A millimetre number box that checks what's typed and commits every valid change straight away. */
export function NumberField(props: {
  label: string;
  /** Accessible name when the visible label alone is ambiguous, e.g. "Hole 1 diameter". */
  name?: string;
  /** Shown when the pointer rests on the label (and read out with the box), not as text under it. */
  help?: string;
  value: number;
  issue?: Issue;
  onCommit: (v: number) => void;
  /** Compact fields show no message underneath; the caller shows messages instead. */
  compact?: boolean;
  /** Unit shown after the box; "" for none. */
  unit?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  const [typingError, setTypingError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Away from the box, a long number is shown to 3 decimals so it fits; the exact value is kept, shown in its
  // tooltip, and comes back for editing as soon as the box is clicked.
  const exact = parse(text) === props.value;
  const shown = focused || !exact ? text : String(Math.round(props.value * 1000) / 1000 + 0);

  // Follow outside changes (open, new project, undo) without fighting the user's typing.
  useEffect(() => {
    if (parse(text) !== props.value) {
      setText(String(props.value));
      setTypingError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const message = typingError ?? props.issue?.message;
  const severity = typingError ? "error" : props.issue?.severity;
  return (
    <div className={props.compact ? "field compact" : "field"}>
      <label htmlFor={id} title={props.help}>
        {props.label}
      </label>
      <div className="input-row">
        <input
          id={id}
          inputMode="decimal"
          value={shown}
          title={shown !== text ? `${text} ${props.unit ?? "mm"}`.trim() : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={props.name}
          aria-invalid={severity === "error"}
          aria-description={props.help}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (v === null) setTypingError(`${props.label} needs to be a number, like 12 or 2.5.`);
            else {
              setTypingError(null);
              props.onCommit(v);
            }
          }}
        />
        {props.unit !== "" && <span className="unit">{props.unit ?? "mm"}</span>}
      </div>
      {props.compact
        ? typingError && (
            <p className="issue error" role="alert">
              {typingError}
            </p>
          )
        : message && (
            <p className={`issue ${severity}`} role={severity === "error" ? "alert" : undefined}>
              {message}
            </p>
          )}
    </div>
  );
}

function parse(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
