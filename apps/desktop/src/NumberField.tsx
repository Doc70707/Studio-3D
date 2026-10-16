import { useEffect, useId, useState } from "react";
import type { Issue } from "@studio3d/document";

/** A millimetre number box that checks what's typed and commits every valid change straight away. */
export function NumberField(props: {
  label: string;
  /** Accessible name when the visible label alone is ambiguous, e.g. "Hole 1 diameter". */
  name?: string;
  help?: string;
  value: number;
  issue?: Issue;
  onCommit: (v: number) => void;
  /** Compact fields show no help or message underneath; the caller shows messages instead. */
  compact?: boolean;
  /** Unit shown after the box; "" for none. */
  unit?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(props.value));
  const [typingError, setTypingError] = useState<string | null>(null);

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
      <label htmlFor={id}>{props.label}</label>
      <div className="input-row">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          aria-label={props.name}
          aria-invalid={severity === "error"}
          aria-describedby={props.help ? `${id}-help` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (v === null)
              setTypingError(
                `${props.label} needs to be a number, like 12 or 2.5.`,
              );
            else {
              setTypingError(null);
              props.onCommit(v);
            }
          }}
        />
        {props.unit !== "" && (
          <span className="unit">{props.unit ?? "mm"}</span>
        )}
      </div>
      {props.compact ? (
        typingError && (
          <p className="issue error" role="alert">
            {typingError}
          </p>
        )
      ) : message ? (
        <p
          className={`issue ${severity}`}
          role={severity === "error" ? "alert" : undefined}
        >
          {message}
        </p>
      ) : (
        <p id={`${id}-help`} className="help">
          {props.help}
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
