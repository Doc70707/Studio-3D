// Blurry with Claude: when the person has turned it on with their own Anthropic key, a question goes to Claude with
// the part as it is now and Blurry's tools (helperTools.ts). Claude answers in plain words and, when asked to, makes
// changes through the tools; each change is checked before it touches the part and is one undo step. The key goes
// only to Anthropic, straight from the app. Without a key, or with no internet, Blurry answers from his own how-tos.
import Anthropic from "@anthropic-ai/sdk";
import type { ProjectDocument, Vec3 } from "@studio3d/document";
import { HOW_TOS } from "./helperAnswers";
import { HELPER_TOOLS, describeModel, planTool, type HelperChange } from "./helperTools";

export const HELPER_MODEL = "claude-opus-5-5";

/** Anthropic's prices for the model in US dollars per million tokens (October 2026), for the rough cost shown. */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

/** At most this many rounds of tool use for one question, so a confused answer can't run on. */
const MAX_ROUNDS = 8;

const SYSTEM = `You are Blurry, the helper built into Studio 3D, a desktop app for designing parts to 3D print. The \
people using it are often new to 3D design. You sit in a small panel beside the 3D view.

How to answer:
- Plain, friendly words a beginner understands. Short: usually one to four sentences. Numbered steps only when \
someone asks how to do something. No headings, tables or bold text.
- Talk about sizes in the units the person sees (given with each question). Your tools always take millimetres, \
so convert inches (25.4 mm each) before using them.
- When the person asks you to add or change something, do it with your tools rather than explaining how, then say \
in one sentence what you did and that Ctrl+Z takes it back. If what they want is unclear (which hole? how big?), \
ask one short question first instead of guessing.
- Only offer what the app really has: its commands are listed with each question, and its how-tos are below. If \
the app can't do something, say so plainly.
- If a tool refuses a change, it says why: fix the request and try again, or tell the person why it can't be done.

About the part: it is built from steps, in order (shapes, holes, sketches, hollows, fillets, chamfers, patterns, \
mirrors). The build plate's centre is x 0, y 0; x runs right, y runs back, z up. The steps as they are now come \
with each question.

How-tos, in the app's own words:
${HOW_TOS.map((h) => `${h.question}\n${h.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`).join("\n\n")}`;

/** What the helper needs to know about the app at the moment, read fresh before each step. */
export interface HelperContext {
  doc: ProjectDocument;
  units: "mm" | "in";
  picked: Vec3[];
  selected: string | null;
  /** Titles of the commands that can run right now. */
  commands: string[];
}

export interface HelperTurn {
  /** The conversation so far, to send back next time (it keeps Claude's own reasoning in order). */
  history: Anthropic.Beta.BetaMessageParam[];
  text: string;
  /** What was done to the part, in order, and what was refused. */
  actions: { said: string; ok: boolean }[];
  /** Rough cost of this answer in US dollars. */
  cost: number;
}

export interface AskOptions {
  key: string;
  question: string;
  history: Anthropic.Beta.BetaMessageParam[];
  context: () => HelperContext;
  apply: (change: HelperChange) => void;
  onText: (text: string) => void;
  onAction: (action: { said: string; ok: boolean }) => void;
  signal: AbortSignal;
}

function contextText(c: HelperContext): string {
  return [
    `<part>\n${describeModel(c.doc)}\n</part>`,
    `Units shown: ${c.units === "in" ? "inches" : "millimetres"}.`,
    `Selected: ${c.selected ?? "nothing"}. Edges picked in the 3D view: ${c.picked.length}.`,
    `Commands available now: ${c.commands.join("; ")}.`,
  ].join("\n");
}

const costOf = (u: Anthropic.Beta.BetaUsage) =>
  ((u.input_tokens ?? 0) * PRICE.input +
    (u.output_tokens ?? 0) * PRICE.output +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
  1_000_000;

/** Why Claude couldn't be asked, in words for the person. */
export function problemText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Claude didn't accept the key. Check it in Blurry's settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "That key isn't allowed to use Claude.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy for this key right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Is the internet on?";
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return "Claude had a problem. Try again shortly.";
  if (e instanceof Anthropic.APIError) return `Claude couldn't answer: ${e.message}`;
  return "Something went wrong asking Claude.";
}

/** Asks Claude one question, letting it use Blurry's tools until it has answered. */
export async function askClaude(o: AskOptions): Promise<HelperTurn> {
  const client = new Anthropic({ apiKey: o.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const history: Anthropic.Beta.BetaMessageParam[] = [
    ...o.history,
    {
      role: "user",
      content: [
        { type: "text", text: contextText(o.context()) },
        { type: "text", text: o.question },
      ],
    },
  ];
  const actions: HelperTurn["actions"] = [];
  let cost = 0;
  let shown = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: HELPER_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      tools: HELPER_TOOLS.map((t) => ({ ...t, eager_input_streaming: true })),
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages: history,
    });
    const stop = () => stream.abort();
    o.signal.addEventListener("abort", stop);
    const before = shown;
    stream.on("text", (_delta, snapshot) => {
      shown = before + (before && snapshot ? "\n\n" : "") + snapshot;
      o.onText(shown);
    });
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } finally {
      o.signal.removeEventListener("abort", stop);
    }
    cost += costOf(message.usage);
    history.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      shown += `${shown ? "\n\n" : ""}Claude can't help with that one.`;
      o.onText(shown);
      break;
    }
    if (message.stop_reason === "max_tokens") {
      shown += `${shown ? "\n\n" : ""}(That answer was cut short.)`;
      o.onText(shown);
      break;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || !calls.length) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const c = o.context();
      const outcome = planTool(c.doc, call.name, call.input, { picked: c.picked, commands: c.commands });
      if (outcome.ok) {
        o.apply(outcome.change);
        // Let the app take the change in before the next tool reads the part.
        await new Promise((r) => setTimeout(r, 40));
        const action = { said: outcome.said, ok: true };
        actions.push(action);
        o.onAction(action);
        results.push({ type: "tool_result", tool_use_id: call.id, content: `Done: ${outcome.said}.` });
      } else {
        results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.error, is_error: true });
      }
    }
    history.push({ role: "user", content: results });
  }
  return { history, text: shown, actions, cost };
}
