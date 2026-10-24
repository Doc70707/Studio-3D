import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  LENGTH_STYLES,
  getLengthStyle,
  lengthEditText,
  lengthFigure,
  parseLength,
  toDisplay,
  unitSuffix,
  type Issue,
} from "@studio3d/document";
import { useFormatKey } from "./unitsSetting";

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
  /** A position along this axis: labelled with the axis letter in its colour (as on the arrows in the 3D view), with
   * the full name in its tooltip and read out with the box, so three fit side by side in a narrow palette. */
  axis?: "x" | "y" | "z";
}) {
  const id = useId();
  const units = useFormatKey();
  const style = getLengthStyle();
  const length = props.unit === undefined;
  const read = (t: string) => (length ? parseLength(t) : parse(t));
  // A size as text in the shown units: exact in millimetres, to a millionth otherwise (well past any printer), and
  // as a fraction of an inch when the length is exactly one.
  const write = (v: number) => (length ? lengthEditText(v) : String(v));
  const same = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const [text, setText] = useState(write(props.value));
  const [typingError, setTypingError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Away from the box, a long number is shown to 3 decimals so it fits; the exact value is kept, shown in its
  // tooltip, and comes back for editing as soon as the box is clicked.
  const exact = same(read(text), props.value);
  const fraction = length && LENGTH_STYLES[style].fraction;
  const shownValue = length ? toDisplay(props.value) : props.value;
  // Fractions are rounded to the precision picked (2 3/8), the exact size staying in the tooltip and the box.
  const short = fraction ? lengthFigure(props.value) : String(Math.round(shownValue * 1000) / 1000 + 0);
  const shown = focused || !exact ? text : short;
  const unitLabel = props.unit ?? unitSuffix();
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
      {props.axis ? (
        <label htmlFor={id} title={props.help ? `${props.label}: ${props.help}` : props.label}>
          <span className={`axis-letter ${props.axis}`}>{props.axis.toUpperCase()}</span>
          <span className="axis-name">{props.label}</span>
        </label>
      ) : (
        <label htmlFor={id} title={props.help}>
          {props.label}
        </label>
      )}
      <div className="input-row">
        <input
          ref={input}
          id={id}
          inputMode="decimal"
          value={shown}
          title={shown !== text ? `${text} ${unitLabel}`.trim() : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={props.name ?? (props.axis ? props.label : undefined)}
          aria-invalid={severity === "error"}
          aria-description={props.help}
          onChange={(e) => {
            setText(e.target.value);
            const v = read(e.target.value);
            if (v === null)
              setTypingError(
                `${props.label} needs to be ${length ? SIZE_EXAMPLE[style] : "a number, like 12 or 2.5"}.`,
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

/** What a size can look like, for the message when what's typed isn't one. */
const SIZE_EXAMPLE: Record<ReturnType<typeof getLengthStyle>, string> = {
  mm: "a size, like 12 or 2.5",
  cm: "a size, like 1.2 or 25 mm",
  m: "a size, like 0.25 or 60 mm",
  in: "a size, like 0.5 or 1/4",
  "in-frac": "a size, like 1/4 or 2 3/8",
  ft: "a size, like 0.5 or 6 in",
  "ft-in": `a size, like 5' 3" or 18`,
};

function parse(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
