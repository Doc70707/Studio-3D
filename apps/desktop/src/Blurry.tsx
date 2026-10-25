// Blurry, the built-in helper: a little glowing ghost in the status bar. Click him (or press Ctrl+K) and ask in your own words. On his own he answers from the app's own how-tos and offers the real commands as
// buttons, with no internet. With Claude turned on (the person's own Anthropic key, in his settings) he answers
// anything about the part and can add shapes, holes, threads and finishes himself. Either way, what he does is an
// ordinary step, undone with Ctrl+Z.
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import { answer, type Answer } from "./helperAnswers";
import { askClaude, problemText, type BuildReport, type HelperContext } from "./helperAI";
import { planTool, type HelperChange } from "./helperTools";
import { planLocal, type LocalPlan } from "./helperLocal";
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
  'Hi, I\'m Blurry. Tell me what to make, like "add a 20 mm cube" or "an M5 hole 10 deep", or ask me how to do something.';
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
  /** Makes a checked change to the part; changes sharing a group are one undo step. */
  apply: (change: HelperChange, group: string) => void;
  /** Waits for the part to be rebuilt, and says how it came out. */
  whenBuilt: () => Promise<BuildReport>;
  /** Takes back a group of changes that didn't work, leaving no undo step behind. */
  takeBack: (group: string) => void;
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
      const now = props.context();
      const plan = planLocal(question, { top: now.top ?? null, picked: now.picked.length });
      if (plan) {
        void makeLocally(plan);
        return;
      }
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
      whenBuilt: props.whenBuilt,
      group: `blurry-${Date.now()}-${id}`,
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

  /**
   * Makes what a request read on this computer asks for, through the same checks as Claude's changes. Nothing is
   * said to be done until the part has been rebuilt; a change that doesn't build is taken back and explained.
   */
  const makeLocally = async (plan: LocalPlan) => {
    const id = add({ from: "blurry", text: "", pending: true, actions: [] });
    setBusy(true);
    const group = `blurry-${Date.now()}-${id}`;
    const made: string[] = [];
    let refused: string | null = null;
    for (const call of plan.calls) {
      const c = props.context();
      const outcome = planTool(c.doc, call.tool, call.input, { picked: c.picked, commands: c.commands });
      if (!outcome.ok) {
        refused = outcome.error;
        break;
      }
      props.apply(outcome.change, group);
      made.push(outcome.said);
      await new Promise((r) => setTimeout(r, 40));
    }
    const report = made.length ? await props.whenBuilt() : null;
    let reply: string;
    let actions = made.map((said) => ({ said, ok: true }));
    if (report && !report.ok) {
      // Leave the part as it was, and say why.
      props.takeBack(group);
      actions = [{ said: `It didn't build: ${report.problems.join(" ")}`, ok: false }];
      reply = "I tried, but the part didn't build with that, so I took it back. Try other sizes or another place.";
    } else if (refused) {
      reply = `I couldn't do that: ${refused}`;
    } else {
      const sizes = plan.assumed.length ? ` You didn't say a size, so I used ${plan.assumed.join(" and ")}.` : "";
      const size = report?.size ? ` The part is now ${report.size}.` : "";
      const heads = report?.warnings?.length ? ` But note: ${report.warnings.join(" ")}` : "";
      reply = `Done.${sizes}${size}${heads} Ctrl+Z takes it back.`;
    }
    change(id, (m) => ({ ...m, pending: false, text: reply, actions }));
    setBusy(false);
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
                    <BlurryFace size={88} waving />
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
                          <li key={i} className={a.ok ? undefined : "failed"}>
                            <Icon name={a.ok ? "check" : "alert"} />
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
 * Blurry's outline, copied exactly from shane's own design ("Blurry Logo", the final app icon of his Blurry task app):
 * a hand-drawn ghost waving with his left arm, the right arm curled at his side. Drawn in a 200 x 200 box.
 */
const GHOST_BODY =
  "M106.0 44.7 C104.6 44.9 101.7 45.1 99.5 45.5 C97.3 46.0 95.2 46.7 93.0 47.7 C90.8 48.6 88.6 49.9 86.5 51.3 C84.4 52.8 82.3 54.7 80.3 56.5 C78.4 58.4 76.4 60.5 74.7 62.6 C73.0 64.6 71.6 66.8 70.4 69.0 C69.2 71.1 68.2 73.3 67.3 75.5 C66.5 77.7 65.8 79.8 65.4 82.0 C64.9 84.2 65.1 86.4 64.7 88.5 C64.2 90.5 64.0 93.0 62.7 94.3 C61.4 95.7 58.8 95.8 56.8 96.7 C54.9 97.7 52.3 98.6 51.0 100.2 C49.8 101.9 49.1 104.3 49.5 106.4 C49.8 108.5 51.8 110.7 53.2 112.8 C54.6 114.8 57.0 116.8 58.0 118.9 C58.9 121.0 58.7 123.2 58.7 125.4 C58.6 127.5 57.9 129.7 57.7 131.9 C57.5 134.0 57.5 136.2 57.5 138.4 C57.5 140.5 57.1 143.0 57.7 144.8 C58.2 146.7 59.3 149.1 60.9 149.6 C62.4 150.1 65.0 148.4 67.2 148.0 C69.3 147.7 71.5 147.0 73.6 147.5 C75.8 148.0 77.9 150.0 80.0 151.2 C82.1 152.4 84.2 154.4 86.4 154.7 C88.5 154.9 90.7 153.8 92.8 152.8 C95.0 151.9 97.1 149.5 99.2 148.8 C101.4 148.1 103.6 148.4 105.7 148.7 C107.9 149.0 110.1 150.4 112.2 150.5 C114.4 150.7 116.7 150.5 118.7 149.5 C120.7 148.5 122.5 146.0 124.3 144.3 C126.1 142.5 127.6 139.9 129.5 139.0 C131.4 138.1 133.7 138.5 135.8 138.9 C138.0 139.3 140.2 141.1 142.3 141.4 C144.4 141.7 146.9 141.6 148.4 140.5 C149.8 139.5 150.4 137.0 150.8 135.0 C151.2 132.9 150.9 130.6 150.9 128.5 C150.9 126.3 151.1 124.1 150.9 122.0 C150.7 119.8 150.2 117.6 149.9 115.5 C149.6 113.3 149.3 111.1 148.9 109.0 C148.6 106.8 148.1 104.6 147.7 102.5 C147.2 100.3 146.8 98.1 146.3 96.0 C145.9 93.8 145.5 91.6 145.0 89.5 C144.6 87.3 144.2 85.1 143.8 83.0 C143.3 80.8 143.0 78.6 142.5 76.5 C142.0 74.3 141.5 72.1 140.7 70.0 C140.0 67.8 139.3 65.6 138.0 63.5 C136.8 61.4 135.0 59.2 133.2 57.3 C131.4 55.4 129.2 53.4 127.2 51.9 C125.1 50.4 122.9 49.2 120.7 48.2 C118.5 47.1 116.4 46.2 114.2 45.6 C112.0 45.1 109.1 44.9 107.7 44.7 C106.3 44.6 107.4 44.6 106.0 44.7 Z";
const GHOST_ARM =
  "M132.2 94.5 C131.4 94.6 128.8 94.6 127.1 95.3 C125.4 95.9 122.8 96.9 122.0 98.4 C121.2 99.8 121.4 102.0 122.0 103.9 C122.7 105.7 124.5 108.0 126.1 109.5 C127.6 110.9 130.5 112.2 131.4 112.8";

/**
 * Blurry himself, drawn the way his app draws him: a white line with a soft glow and a wide halo round it, dot eyes
 * and a smile. The glow is the accent colour picked in Settings (--blurry), so he changes with it; inside he is dark,
 * so he looks the same on light themes as on his own black screen.
 */
export function BlurryFace({ size, waving }: { size: number; waving?: boolean }) {
  const id = useId();
  const halo = `${id}-halo`;
  const glow = `${id}-glow`;
  // His whole drawing in one colour: outline, curled arm, smile and eyes. The glow layers are this, blurred.
  const drawing = (colour: string, eyes?: string) => (
    <g style={{ stroke: colour }} strokeWidth="5.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={GHOST_BODY} />
      <path d={GHOST_ARM} />
      <path d="M89 79 Q97.5 86.5 106 78" strokeWidth="4.4" />
      <g className={eyes} style={{ fill: colour, stroke: "none" }}>
        <circle cx="85.3" cy="71" r="2.7" />
        <circle cx="110.3" cy="69" r="2.7" />
      </g>
    </g>
  );
  return (
    <svg
      className={`blurry-face${waving ? " waving" : ""}`}
      width={size}
      height={size}
      viewBox="40 40 120 120"
      aria-hidden="true"
    >
      <defs>
        <filter id={halo} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <g className="blurry-body">
        <path d={GHOST_BODY} style={{ fill: "var(--blurry-inside)" }} />
        <path d={GHOST_BODY} style={{ fill: "var(--blurry)" }} opacity="0.13" />
        <g opacity="0.45" filter={`url(#${halo})`}>
          {drawing("var(--blurry)")}
        </g>
        <g opacity="0.75" filter={`url(#${glow})`}>
          {drawing("var(--blurry)")}
        </g>
        {drawing("#fff", "blurry-eyes")}
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
