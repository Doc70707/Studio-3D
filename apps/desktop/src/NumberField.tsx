import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { parseLength, toDisplay, type Issue } from "@studio3d/document";
import { useUnits } from "./unitsSetting";

/**
 * A number box that checks what's typed and commits every valid change straight away. Sizes (the default) are shown
 * and typed in millimetres or inches, whichever is picked, and committed in millimetres; "1/4 in" or "6 mm" can be
 * typed whichever is shown. Boxes with another unit (degrees, a count) take plain numbers.
 */
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
  /** Unit shown after the box, for a box that isn't a size: "°", or "" for none. */
  unit?: string;
}) {
  const id = useId();
  const units = useUnits();
  const length = props.unit === undefined;
  const read = (t: string) => (length ? parseLength(t, units) : parse(t));
  // A size as text in the shown units: exact in millimetres, to a millionth of an inch (well past any printer).
  const write = (v: number) => String(length && units === "in" ? Math.round(toDisplay(v, units) * 1e6) / 1e6 : v);
  const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const [text, setText] = useState(write(props.value));
  const [typingError, setTypingError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Away from the box, a long number is shown to 3 decimals so it fits; the exact value is kept, shown in its
  // tooltip, and comes back for editing as soon as the box is clicked.
  const exact = same(read(text), props.value);
  const shownValue = length ? toDisplay(props.value, units) : props.value;
  const shown = focused || !exact ? text : String(Math.round(shownValue * 1000) / 1000 + 0);
  const unitLabel = props.unit ?? units;
  // When clicking in swaps the short number for the exact one, the whole number is selected, so typing replaces it
  // (otherwise the swap leaves the cursor at the end, and what is typed is added to the long number).
  const input = useRef<HTMLInputElement>(null);
  const shortShown = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focused && shortShown.current !== null && shortShown.current !== text) input.current?.select();
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    shortShown.current = focused ? null : shown;
  });

  // Follow outside changes (open, new project, undo, a switch of units) without fighting the user's typing.
  const shownIn = useRef(units);
  useEffect(() => {
    const switched = shownIn.current !== units;
    shownIn.current = units;
    if (switched || !same(read(text), props.value)) {
      setText(write(props.value));
      setTypingError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value, units]);

  const message = typingError ?? props.issue?.message;
  const severity = typingError ? "error" : props.issue?.severity;
  return (
    <div className={props.compact ? "field compact" : "field"}>
      <label htmlFor={id} title={props.help}>
        {props.label}
      </label>
      <div className="input-row">
        <input
          ref={input}
          id={id}
          inputMode="decimal"
          value={shown}
          title={shown !== text ? `${text} ${unitLabel}`.trim() : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={props.name}
          aria-invalid={severity === "error"}
          aria-description={props.help}
          onChange={(e) => {
            setText(e.target.value);
            const v = read(e.target.value);
            if (v === null)
              setTypingError(
                `${props.label} needs to be a number, like ${length && units === "in" ? "0.5 or 1/4" : "12 or 2.5"}.`,
              );
            else {
              setTypingError(null);
              props.onCommit(v);
            }
          }}
        />
        {unitLabel !== "" && <span className="unit">{unitLabel}</span>}
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
