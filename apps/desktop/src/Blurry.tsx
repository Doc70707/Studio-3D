// Blurry, the built-in helper: a small round character in the corner of the 3D view. Click him (or press Ctrl+K)
// and ask in your own words; he answers from the app's own how-tos and offers the real commands as buttons, so
// what he does is what the menus do: an ordinary step, undone with Ctrl+Z. He works with no internet.
import { useEffect, useRef, useState } from "react";
import { answer, type Answer } from "./helperAnswers";
import type { Command } from "./commands";
import { whereIs } from "./CommandLine";
import { Icon } from "./Icon";

interface Said {
  id: number;
  from: "you" | "blurry";
  text: string;
  answer?: Answer;
}

const HELLO =
  "Hi, I'm Blurry. Ask me how to do something, or tell me what to add: a hole, rounded edges, a thread. I'll find it for you.";
const STARTERS = ["How do I thread a hole?", "Round just one edge", "Work in inches", "Get it ready to print"];

export function Blurry(props: { commands: Command[]; open: boolean; onOpen: (open: boolean) => void }) {
  const { open, onOpen } = props;
  const [said, setSaid] = useState<Said[]>([{ id: 0, from: "blurry", text: HELLO }]);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const next = useRef(1);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  // The newest message stays in sight.
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [said]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question) return;
    const a = answer(question, props.commands);
    setSaid((s) => [
      ...s,
      { id: next.current++, from: "you", text: question },
      { id: next.current++, from: "blurry", text: a.text, answer: a },
    ]);
    setText("");
  };
  const run = (c: Command) => {
    if (c.disabled) {
      setSaid((s) => [
        ...s,
        { id: next.current++, from: "blurry", text: `${c.title} can't be used yet: ${c.reason ?? "not right now"}.` },
      ]);
      return;
    }
    c.run();
    setSaid((s) => [...s, { id: next.current++, from: "blurry", text: `Done: ${c.title}. Ctrl+Z takes it back.` }]);
  };

  return (
    <div className={`blurry${open ? " open" : ""}`} data-testid="blurry">
      {open && (
        <section className="blurry-panel glass" role="dialog" aria-label="Blurry" aria-modal="false">
          <header className="blurry-head">
            <BlurryFace size={28} />
            <h2>Blurry</h2>
            <span className="blurry-sub">Helper · works offline</span>
            <button
              type="button"
              className="icon-only"
              aria-label="Close Blurry"
              title="Close (Esc)"
              onClick={() => onOpen(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="blurry-messages" ref={list} role="log" aria-live="polite">
            {said.map((m) => (
              <div key={m.id} className={`blurry-message from-${m.from}`}>
                <p>{m.text}</p>
                {m.answer?.howTo && (
                  <ol className="blurry-steps">
                    {m.answer.howTo.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                )}
                {!!m.answer?.commands.length && (
                  <div className="blurry-actions">
                    {m.answer.commands.map((f) => (
                      <button
                        key={f.command.title}
                        type="button"
                        disabled={f.command.disabled}
                        title={f.command.disabled ? f.command.reason : `In ${f.command.where.join(" and ")}`}
                        onClick={() => run(f.command)}
                      >
                        {f.command.title}
                        <span className="blurry-where">{whereIs(f.command)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {said.length === 1 && (
              <div className="blurry-starters">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            className="blurry-ask"
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
          >
            <input
              ref={input}
              aria-label="Ask Blurry"
              placeholder="Ask, or say what to add…"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  onOpen(false);
                }
              }}
            />
            <button type="submit" className="primary" disabled={!text.trim()}>
              Ask
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        className="blurry-button"
        aria-label={open ? "Close Blurry" : "Ask Blurry"}
        aria-expanded={open}
        title="Blurry, your helper (Ctrl+K)"
        onClick={() => onOpen(!open)}
      >
        <BlurryFace size={40} />
      </button>
    </div>
  );
}

/**
 * Blurry himself: a soft round body with two eyes. A stand-in drawn here until his own design (shane's "Blurry
 * Prototype v11") is brought in.
 */
export function BlurryFace({ size }: { size: number }) {
  return (
    <svg className="blurry-face" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <radialGradient id="blurry-body" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#bfe0ff" />
          <stop offset="55%" stopColor="#6cb4ff" />
          <stop offset="100%" stopColor="#3d7fe0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#blurry-body)" />
      <ellipse className="blurry-eye" cx="14.5" cy="19" rx="2.4" ry="3.2" fill="#0d1b33" />
      <ellipse className="blurry-eye" cx="25.5" cy="19" rx="2.4" ry="3.2" fill="#0d1b33" />
      <path d="M15.5 26c2.6 2.2 6.4 2.2 9 0" fill="none" stroke="#0d1b33" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
