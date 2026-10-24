// The command line, as in AutoCAD and Civil 3D: a bar under the 3D view to type any command by name (FILLET, F,
// RECTANGLE, REC) or by what it does ("round the edges"). Matches are listed above it with where the command lives
// on the ribbon; Enter runs one, and an empty Enter runs the last one again. A command that needs a value (a
// fillet's radius) asks for it here, with its default in angle brackets as AutoCAD does: Enter keeps it.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { lengthFigure, lengthText, parseLength, unitSuffix } from "@studio3d/document";
import { commandsFor, type Command } from "./commands";
import { Icon } from "./Icon";
import { useUnits } from "./unitsSetting";

/**
 * A value the last command asks for, as AutoCAD asks at its command line. A size is a length above 0; a distance
 * may be below 0 (an offset inward); an angle is in degrees; a factor is a plain number above 0; a move is
 * "x,y" or "x,y,z" in the shown units.
 */
export type CommandPrompt = {
  /** "Fillet radius" */
  label: string;
  /** Sets it (in mm, degrees or a plain number); returns why it can't be used, or nothing. */
} & (
  | { kind?: "size" | "distance" | "angle" | "factor"; value: number; apply: (v: number) => string | void }
  | { kind: "move"; value: [number, number, number]; apply: (v: [number, number, number]) => string | void }
);

export interface CommandLineHandle {
  /** Puts the cursor in the line, with these letters typed (a key pressed over the 3D view). */
  focus: (typed?: string) => void;
}

interface Props {
  commands: Command[];
  prompt: CommandPrompt | null;
  onPromptDone: () => void;
  /** Ran a command; the app may then ask for its value. */
  onRan: (c: Command) => void;
  /** What the line says while nothing is typed: what is picked and what can be done with it. */
  placeholder: string;
  onClose: () => void;
}

const SHOWN = 6;

export const CommandLine = forwardRef<CommandLineHandle, Props>(function CommandLine(props, ref) {
  const { commands, prompt } = props;
  const units = useUnits();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  /** What happened last, shown above the line: "Fillet  Home › Modify", or why it didn't run. */
  const [said, setSaid] = useState<{ text: string; error?: boolean } | null>(null);

  useImperativeHandle(ref, () => ({
    focus: (typed = "") => {
      setText((t) => t + typed);
      setOpen(true);
      input.current?.focus();
    },
  }));

  // A close match by name keeps loose matches by everyday words ("fil" also starts "file") out of the list.
  const all = prompt ? [] : commandsFor(text, commands, SHOWN);
  const found = all.filter((f) => f.score >= all[0]!.score - 15);
  const shown = open && found.length > 0;

  const run = (c: Command) => {
    setText("");
    setActive(0);
    setOpen(false);
    if (c.disabled) {
      setSaid({ text: `${c.title}: ${c.reason ?? "can't be used right now"}`, error: true });
      return;
    }
    setLast(c.title);
    setSaid({ text: whereIs(c) ? `${c.title}  ·  ${whereIs(c)}` : c.title });
    // The app hears first, so a command that asks for a value (ROTATE's angle) keeps its question.
    props.onRan(c);
    c.run();
  };

  const answer = () => {
    if (!prompt) return;
    const t = text.trim();
    const fail = (text: string) => setSaid({ text, error: true });
    let why: string | void;
    if (prompt.kind === "move") {
      const parts = t === "" ? null : t.split(/\s*[,;]\s*/).map(lengthOf);
      const v = parts ? [parts[0], parts[1], parts[2] ?? 0] : prompt.value;
      const how = "Type how far to move as x,y or x,y,z, like 10,0 or 0,0,5.";
      if (parts && (parts.length < 2 || parts.length > 3)) return fail(how);
      if (v.some((n) => n === null || n === undefined)) return fail(how);
      why = prompt.apply(v as [number, number, number]);
      if (why) return fail(why);
      setSaid({ text: `${prompt.label} ${(v as number[]).map((n) => lengthFigure(n)).join(", ")}${suffix()}` });
    } else {
      const kind = prompt.kind ?? "size";
      const plain = kind === "angle" || kind === "factor";
      const v = t === "" ? prompt.value : plain ? numberOf(t) : lengthOf(t);
      if (v === null) return fail(`${prompt.label} needs to be ${EXAMPLES[kind](units)}.`);
      if ((kind === "size" || kind === "factor") && v <= 0)
        return fail(`${prompt.label} needs to be ${EXAMPLES[kind](units)}.`);
      why = prompt.apply(v);
      if (why) return fail(why);
      setSaid({ text: `${prompt.label} ${showValue(prompt, v)}` });
    }
    setText("");
    props.onPromptDone();
  };

  const enter = () => {
    if (prompt) return answer();
    const q = text.trim();
    if (!q) {
      const again = commands.find((c) => c.title === last);
      if (again) run(again);
      return;
    }
    const pick = found[Math.min(active, found.length - 1)];
    if (!pick) return setSaid({ text: `No command called "${q}". Try a word for what you want to do.`, error: true });
    // One letter runs only a command that is called just that (F, C, L), never a guess.
    if (q.length === 1 && pick.matched !== q.toUpperCase() && active === 0)
      return setSaid({ text: `Type more of the name, or pick one from the list.`, error: true });
    run(pick.command);
  };

  // Space ends what is typed, so a mixed inch size is typed as AutoCAD writes it: 1-1/2.
  const lengthOf = (t: string) => parseLength(t.replace(/(\d)-(?=\d+\s*\/)/g, "$1 "));
  const showValue = (p: CommandPrompt, v: number | number[]) =>
    p.kind === "move"
      ? `${(v as number[]).map((n) => lengthFigure(n)).join(",")}${suffix()}`
      : p.kind === "angle"
        ? `${v}°`
        : p.kind === "factor"
          ? `${v}`
          : lengthText(v as number);
  /**
   * Space runs what is typed, as Enter does, when it is a value being asked for, an empty line (the last command
   * again), or one word that matches a command's short name (L, FIL for FILLET). After everyday words it is a space.
   */
  const spaceEnters = (t: string) =>
    prompt !== null ||
    t.trim() === "" ||
    (!/\s/.test(t.trim()) && !!found[0] && found[0].command.aliases.includes(found[0].matched));
  return (
    <div className="command-line glass" role="group" aria-label="Command line" data-testid="command-line">
      {shown && (
        <ul className="command-suggestions" role="listbox" id="command-suggestions" aria-label="Matching commands">
          {found.map((f, i) => (
            <li
              key={f.command.title}
              id={`command-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={f.command.disabled || undefined}
              title={f.command.disabled ? f.command.reason : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => run(f.command)}
            >
              <span className="command-title">{f.command.title}</span>
              {f.matched !== f.command.title && <span className="command-alias">{f.matched}</span>}
              <span className="command-where">
                {f.command.disabled ? (f.command.reason ?? "Not now") : whereIs(f.command)}
              </span>
              {f.command.shortcut && <kbd>{f.command.shortcut}</kbd>}
            </li>
          ))}
        </ul>
      )}
      {said && (
        <p className={`command-said${said.error ? " error" : ""}`} role="status" data-testid="command-said">
          {said.text}
        </p>
      )}
      <div className="command-row">
        <Icon name="command" />
        {prompt && (
          <label className="command-prompt" htmlFor="command-input">
            {prompt.label} &lt;{showValue(prompt, prompt.value)}&gt;:
          </label>
        )}
        <input
          ref={input}
          id="command-input"
          aria-label={prompt ? prompt.label : "Type a command"}
          role="combobox"
          aria-expanded={shown}
          aria-controls="command-suggestions"
          aria-activedescendant={shown ? `command-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={prompt ? "Enter keeps it" : props.placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || (e.key === " " && spaceEnters(text))) {
              // Space is Enter too, as in AutoCAD: after a short name (L, FILLET), a value, or on an empty line to
              // repeat the last command. Elsewhere it is a space, so everyday words still work ("round the edges").
              e.preventDefault();
              enter();
            } else if (e.key === "ArrowDown" && found.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % found.length);
            } else if (e.key === "ArrowUp" && found.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + found.length) % found.length);
            } else if (e.key === "Tab" && shown) {
              // Tab fills in the highlighted command's name, as AutoCAD's autocomplete does.
              e.preventDefault();
              const f = found[active];
              if (f) setText(f.command.aliases[0] ?? f.command.title);
            } else if (e.key === "Escape") {
              // Escape cancels what is being typed or asked; on an empty line it gives the keys back to the view.
              e.preventDefault();
              e.stopPropagation();
              if (prompt) {
                setText("");
                setSaid({ text: `${prompt.label} kept at ${showValue(prompt, prompt.value)}` });
                props.onPromptDone();
              } else if (text) setText("");
              else input.current?.blur();
            }
          }}
        />
        <button
          type="button"
          className="icon-only"
          aria-label="Hide the command line"
          title="Hide the command line (Ctrl+9)"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
});

/** A plain number typed: "90", "-45", "0.5", "1/2". */
function numberOf(t: string): number | null {
  const m = /^(-?)\s*(\d*\.?\d+)(?:\s*\/\s*(\d*\.?\d+))?\s*°?$/.exec(t.trim().replace(/,/g, "."));
  if (!m) return null;
  const v = Number(m[2]) / (m[3] !== undefined ? Number(m[3]) : 1);
  return Number.isFinite(v) ? (m[1] ? -v : v) : null;
}

/** The unit after a row of sizes, with its space; none for feet and inches, whose marks are in each figure. */
const suffix = () => (unitSuffix() ? ` ${unitSuffix()}` : "");

const EXAMPLES: Record<"size" | "distance" | "angle" | "factor", (units: string) => string> = {
  size: (u) => `a size above 0, like ${u === "in" ? "1/8" : "2"}`,
  distance: (u) => `a distance, like ${u === "in" ? "1/16" : "2"} (minus goes inward)`,
  angle: () => "an angle in degrees, like 90 or -45",
  factor: () => "a number above 0, like 2 or 0.5",
};

/** Where to find a command next time: its ribbon button if it has one ("Home › Modify"), else its menu. */
export function whereIs(c: Command): string {
  const ribbon = c.where.find((w) => w.includes("›"));
  return ribbon ?? (c.where[0] ? `${c.where[0]} menu` : "");
}
