// Blurry, the built-in helper: a little glowing ghost in the status bar. Click him (or press Ctrl+K) and ask in your own words. On his own he answers from the app's own how-tos and offers the real commands as
// buttons, with no internet. With Claude turned on (the person's own Anthropic key, in his settings) he answers
// anything about the part and can add shapes, holes, threads and finishes himself. Either way, what he does is an
// ordinary step, undone with Ctrl+Z.
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import { answer, type Answer } from "./helperAnswers";
import { askClaude, problemText, type HelperContext } from "./helperAI";
import type { HelperChange } from "./helperTools";
import type { Command } from "./commands";
import { whereIs } from "./CommandLine";
import { Icon } from "./Icon";
import { platform } from "./platform";

interface Said {
  id: number;
  from: "you" | "blurry";
  text: string;
  answer?: Answer;
  /** Claude is still answering. */
  pending?: boolean;
  /** What Claude did to the part while answering. */
  actions?: { said: string; ok: boolean }[];
  /** Rough cost of a Claude answer, in US dollars. */
  cost?: number;
}

const HELLO =
  "Hi, I'm Blurry. Ask me how to do something, or tell me what to add: a hole, rounded edges, a thread. I'll find it for you.";
const HELLO_CLAUDE =
  'Hi, I\'m Blurry, with Claude turned on. Ask me anything about your part, or tell me what to make: "add a 20 mm cube", "put an M5 thread in the hole".';
const STARTERS = ["How do I thread a hole?", "Round just one edge", "Work in inches", "Get it ready to print"];

const money = (dollars: number) => (dollars < 0.01 ? "under 1¢" : `about ${Math.round(dollars * 100)}¢`);

export interface BlurryProps {
  commands: Command[];
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Out of the way (while sketching, or in Focus canvas): nothing is shown, but the conversation is kept. */
  hidden: boolean;
  /** The part and the app as they are now, for Claude. */
  context: () => HelperContext;
  /** Makes one checked change to the part (one undo step). */
  apply: (change: HelperChange) => void;
  /** Told when Claude starts and stops answering, so his button can glow meanwhile. */
  onBusy: (busy: boolean) => void;
  /** His open panel, which the 3D view keeps the part clear of. */
  panelRef: RefObject<HTMLElement | null>;
}

export function Blurry(props: BlurryProps) {
  const { open, onOpen } = props;
  const [key, setKey] = useState<string | null>(null);
  const [said, setSaid] = useState<Said[]>([{ id: 0, from: "blurry", text: HELLO }]);
  const [text, setText] = useState("");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const next = useRef(1);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const stopper = useRef<AbortController | null>(null);
  const { onBusy } = props;
  useEffect(() => onBusy(busy), [busy, onBusy]);

  // The key the person saved last time, from the computer's key store.
  useEffect(() => {
    platform.helperKey
      .read()
      .then((k) => {
        if (!k) return;
        setKey(k);
        setSaid((s) => (s.length === 1 ? [{ ...s[0]!, text: HELLO_CLAUDE }] : s));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (open && !settings) input.current?.focus();
  }, [open, settings]);
  // The newest message stays in sight.
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [said]);

  const add = (m: Omit<Said, "id">) => {
    const id = next.current++;
    setSaid((s) => [...s, { ...m, id }]);
    return id;
  };
  const change = (id: number, f: (m: Said) => Said) => setSaid((s) => s.map((m) => (m.id === id ? f(m) : m)));

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    add({ from: "you", text: question });
    if (!key) {
      const a = answer(question, props.commands);
      add({ from: "blurry", text: a.text, answer: a });
      return;
    }
    const id = add({ from: "blurry", text: "", pending: true, actions: [] });
    const stop = new AbortController();
    stopper.current = stop;
    setBusy(true);
    askClaude({
      key,
      question,
      history: history.current,
      context: props.context,
      apply: props.apply,
      onText: (t) => change(id, (m) => ({ ...m, text: t })),
      onAction: (a) => change(id, (m) => ({ ...m, actions: [...(m.actions ?? []), a] })),
      signal: stop.signal,
    })
      .then((turn) => {
        history.current = turn.history;
        change(id, (m) => ({ ...m, pending: false, text: turn.text || m.text || "Done.", cost: turn.cost }));
      })
      .catch((e: unknown) => {
        if (stop.signal.aborted) {
          change(id, (m) => ({ ...m, pending: false, text: m.text ? `${m.text} (stopped)` : "Stopped." }));
          return;
        }
        // Claude couldn't be reached: say why, and answer from the how-tos instead.
        const a = answer(question, props.commands);
        change(id, (m) => ({ ...m, pending: false, text: `${problemText(e)} ${a.text}`, answer: a }));
      })
      .finally(() => {
        stopper.current = null;
        setBusy(false);
      });
  };

  const run = (c: Command) => {
    if (c.disabled) {
      add({ from: "blurry", text: `${c.title} can't be used yet: ${c.reason ?? "not right now"}.` });
      return;
    }
    c.run();
    add({ from: "blurry", text: `Done: ${c.title}. Ctrl+Z takes it back.` });
  };

  const connect = async (k: string | null) => {
    if (k === null) {
      await platform.helperKey.clear();
      history.current = [];
      setKey(null);
      add({ from: "blurry", text: "Claude is off, and your key is forgotten. I'll answer from my own how-tos." });
      return;
    }
    await platform.helperKey.write(k);
    history.current = [];
    setKey(k);
    setSettings(false);
    add({ from: "blurry", text: "Claude is on. Ask me anything about your part, or tell me what to add." });
  };

  if (props.hidden) return null;
  return (
    <div className={`blurry${open ? " open" : ""}`} data-testid="blurry">
      {open && (
        <section
          ref={props.panelRef}
          className="blurry-panel glass"
          role="dialog"
          aria-label="Blurry"
          aria-modal="false"
        >
          <header className="blurry-head">
            <BlurryFace size={30} />
            <h2>Blurry</h2>
            <span className="blurry-sub">{key ? "Helper · with Claude" : "Helper · works offline"}</span>
            <button
              type="button"
              className="icon-only"
              aria-label="Blurry settings"
              aria-pressed={settings}
              title="Turn Claude on or off"
              onClick={() => setSettings((v) => !v)}
            >
              <Icon name="key" />
            </button>
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
          {settings ? (
            <HelperSettings connected={!!key} onConnect={connect} onDone={() => setSettings(false)} />
          ) : (
            <>
              <div className="blurry-messages" ref={list} role="log" aria-live="polite">
                {said.length === 1 && (
                  <div className="blurry-hero">
                    <BlurryFace size={64} waving />
                  </div>
                )}
                {said.map((m) => (
                  <div
                    key={m.id}
                    className={`blurry-message from-${m.from}${m.pending ? " pending" : ""}`}
                    data-testid={m.from === "blurry" ? "blurry-says" : undefined}
                  >
                    {m.text ? <p>{m.text}</p> : m.pending && <Thinking />}
                    {!!m.actions?.length && (
                      <ul className="blurry-done" aria-label="What Blurry did">
                        {m.actions.map((a, i) => (
                          <li key={i}>
                            <Icon name="check" />
                            {a.said}
                          </li>
                        ))}
                      </ul>
                    )}
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
                    {m.cost !== undefined && (
                      <span
                        className="blurry-cost"
                        title="A rough figure from Anthropic's prices; your account shows the exact cost"
                      >
                        {money(m.cost)} on your Anthropic account
                      </span>
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
                  placeholder={key ? "Ask anything, or say what to make…" : "Ask, or say what to add…"}
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
                {busy ? (
                  <button type="button" aria-label="Stop" title="Stop Claude" onClick={() => stopper.current?.abort()}>
                    <Icon name="stop" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="primary"
                    aria-label="Ask"
                    title="Ask (Enter)"
                    disabled={!text.trim()}
                  >
                    <Icon name="send" />
                  </button>
                )}
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <p className="blurry-thinking" aria-label="Blurry is thinking">
      <span />
      <span />
      <span />
    </p>
  );
}

/** Turning Claude on with the person's own key, or off again. */
function HelperSettings(props: {
  connected: boolean;
  onConnect: (key: string | null) => Promise<void>;
  onDone: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const save = (k: string | null) =>
    props.onConnect(k).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="blurry-settings">
      <p>
        Blurry can answer with <strong>Claude</strong>, Anthropic&apos;s AI, using your own Anthropic API key. Your
        question and a description of your part are then sent to Anthropic, and each answer shows roughly what it cost
        on your account.
      </p>
      <p className="blurry-muted">
        Without a key he still answers from the app&apos;s own how-tos, offline and free. Get a key at
        console.anthropic.com. It is kept in Windows&apos; own key store, never in your files.
      </p>
      {props.connected ? (
        <div className="blurry-settings-row">
          <span className="blurry-on">
            <Icon name="check" /> Claude is on
          </span>
          <button type="button" onClick={() => void save(null)}>
            Turn off and forget the key
          </button>
        </div>
      ) : (
        <form
          className="blurry-settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void save(key.trim());
          }}
        >
          <input
            ref={field}
            type="password"
            aria-label="Anthropic API key"
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!key.trim()}>
            Turn on Claude
          </button>
        </form>
      )}
      {error && (
        <p className="blurry-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="blurry-back" onClick={props.onDone}>
        Back to the conversation
      </button>
    </div>
  );
}

/**
 * Blurry himself, from shane's "Blurry Prototype v11": a little ghost drawn in a glowing white line, smiling, with
 * one arm up in a wave and a warm glow round him. His body is dark, so the line glows on light themes too.
 */
export function BlurryFace({ size, waving }: { size: number; waving?: boolean }) {
  const body = useId();
  return (
    <svg
      className={`blurry-face${waving ? " waving" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={body} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#6e4a32" />
          <stop offset="65%" stopColor="#33261d" />
          <stop offset="100%" stopColor="#1e1814" />
        </radialGradient>
      </defs>
      <g transform="rotate(-6 20 20)" fill="none" stroke="#fffaf4" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M10.5 31V18.5c0-6.3 4.1-11 10-11s10 4.7 10 11V31q-2.5 2.8-5 0-2.5 2.8-5 0-2.5 2.8-5 0-2.5 2.8-5 0z"
          fill={`url(#${body})`}
          strokeWidth="2"
        />
        {/* Drawn over his side: its fill hides the body's line where it joins, so he is one outline, arm and all. */}
        <path
          className="blurry-arm"
          d="M11 24C8.3 23.3 6.2 20.7 6.3 18.2c.1-1.2 1.2-1.6 2.1-.8 1 1 1.7 1.8 2.6 2.3"
          fill={`url(#${body})`}
          strokeWidth="2"
        />
        <path d="M25.6 21.2c1.8.2 2.6 2.3 1 3.7" strokeWidth="1.7" />
        <g className="blurry-eyes" fill="#fffaf4" stroke="none">
          <circle cx="17.3" cy="15.6" r="1.3" />
          <circle cx="23.7" cy="15.6" r="1.3" />
        </g>
        <path d="M17.8 19.2c1.6 1.6 4.2 1.6 5.8 0" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

/** Blurry's place in the status bar: out of the 3D view, beside the command line, and where his panel grows from. */
export function BlurryButton(props: { open: boolean; busy: boolean; onOpen: (open: boolean) => void }) {
  return (
    <button
      type="button"
      className={`statusbar-toggle blurry-button${props.busy ? " busy" : ""}`}
      aria-label={props.open ? "Close Blurry" : "Ask Blurry"}
      aria-expanded={props.open}
      title="Blurry, your helper (Ctrl+K)"
      onClick={() => props.onOpen(!props.open)}
    >
      <BlurryFace size={20} />
      <span className="toggle-label">Blurry</span>
    </button>
  );
}
