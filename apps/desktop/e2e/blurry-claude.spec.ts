import { expect, test, type Page, type Request } from "@playwright/test";

// Blurry with Claude turned on. Anthropic's API is stood in for here by recorded-style answers (the same stream of
// events the real API sends), so these tests check everything on our side: what is sent, that the key goes only to
// Anthropic, that Claude's tool calls become ordinary checked steps, and what the person sees.
const OUT = new URL("../../../test-output/", import.meta.url).pathname;
const host = (page: Page) => page.locator("main.viewport-host");
const current = (page: Page) => expect(host(page)).toHaveAttribute("data-geometry", "current");
const panel = (page: Page) => page.getByRole("dialog", { name: "Blurry" });
const steps = (page: Page) => page.getByRole("complementary", { name: "Browser" }).getByRole("listitem");
const KEY = "sk-ant-test-0123456789";

type Block = { text: string } | { tool: string; input: unknown };

/** One answer from the Messages API as the server-sent events it streams. */
function streamed(blocks: Block[], n: number) {
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id: `msg_${n}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 2400, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
  ];
  blocks.forEach((b, index) => {
    if ("text" in b) {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const piece of b.text.match(/.{1,12}/gs) ?? [])
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: `toolu_${n}_${index}`, name: b.tool, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  const tools = blocks.some((b) => "tool" in b);
  events.push({
    type: "message_delta",
    delta: { stop_reason: tools ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 120 },
  });
  events.push({ type: "message_stop" });
  return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

/** Answers each request to the Messages API with the next of `answers`, and keeps the requests. */
async function standIn(page: Page, answers: Block[][]) {
  const sent: Request[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const n = sent.length;
    sent.push(route.request());
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" },
      body: streamed(answers[n] ?? [{ text: "That's all." }], n),
    });
  });
  return sent;
}

async function turnOnClaude(page: Page) {
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  await panel(page).getByRole("button", { name: "Blurry settings" }).click();
  await panel(page).getByLabel("Anthropic API key").fill(KEY);
  await panel(page).getByRole("button", { name: "Turn on Claude" }).click();
  await expect(panel(page)).toContainText("Claude is on.");
  await expect(panel(page)).toContainText("Helper · with Claude");
}

async function ask(page: Page, question: string) {
  await panel(page).getByRole("textbox", { name: "Ask Blurry" }).fill(question);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await current(page);
});

test("with Claude on, a request becomes real checked steps: a hole, then threaded, each undoable", async ({ page }) => {
  const sent = await standIn(page, [
    [{ text: "I'll add a 6 mm hole." }, { tool: "add_hole", input: { diameter: 6, x: 15, y: 0, depth: 0 } }],
    [{ tool: "change_step", input: { step: "Hole 1", changes: { thread: "m5", simplified: true } } }],
    [{ text: "Done: Hole 1 is ready for an M5 screw. Ctrl+Z takes it back." }],
  ]);
  await turnOnClaude(page);
  await ask(page, "put an M5 threaded hole 15 mm right of the middle");

  const reply = panel(page).getByTestId("blurry-says").last();
  await expect(reply).toContainText("Hole 1 is ready for an M5 screw");
  await expect(reply.getByRole("list", { name: "What Blurry did" })).toContainText("Added Hole 1");
  await expect(reply.getByRole("list", { name: "What Blurry did" })).toContainText(
    "Changed Hole 1: thread, simplified",
  );
  await expect(reply).toContainText("on your Anthropic account");
  await expect(steps(page).filter({ hasText: "Hole 1" })).toHaveCount(1);
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("M5");
  await current(page);
  await page.screenshot({ path: `${OUT}blurry-claude.png` });

  // What went to Anthropic: the key only in its own header, from the app; the part described; the tools; and the
  // results of the tools sent back in order.
  expect(sent).toHaveLength(3);
  const first = sent[0]!;
  expect(first.url()).toBe("https://api.anthropic.com/v1/messages?beta=true");
  expect(first.headers()["x-api-key"]).toBe(KEY);
  expect(first.headers()["anthropic-dangerous-direct-browser-access"]).toBe("true");
  const body = first.postDataJSON();
  expect(body.model).toBe("claude-opus-5-5");
  expect(body.stream).toBe(true);
  expect(body.tools.map((t: { name: string }) => t.name)).toContain("add_hole");
  expect(JSON.stringify(body.messages[0].content)).toContain("<part>");
  const second = JSON.stringify(sent[1]!.postDataJSON().messages.at(-1));
  expect(second).toContain("tool_result");
  expect(second).toContain("Done: Added Hole 1.");

  // Each change is its own step in the history: two undos take both back.
  await panel(page).getByRole("button", { name: "Close Blurry" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Hole 1 thread")).toHaveValue("");
  await page.keyboard.press("Control+z");
  await expect(steps(page).filter({ hasText: "Hole 1" })).toHaveCount(0);
});

test("a change the checks refuse never reaches the part; Claude is told why and says so", async ({ page }) => {
  const sent = await standIn(page, [
    [{ tool: "add_shape", input: { shape: "cylinder", sizes: { width: 3 } } }],
    [{ text: "A cylinder is sized by its diameter, so I didn't add it. How wide should it be?" }],
  ]);
  await turnOnClaude(page);
  await ask(page, "add a cylinder 3 wide");
  await expect(panel(page).getByTestId("blurry-says").last()).toContainText("How wide should it be?");
  const result = JSON.stringify(sent[1]!.postDataJSON().messages.at(-1));
  expect(result).toContain('"is_error":true');
  expect(result).toContain("no size called width");
  await expect(steps(page)).toHaveCount(1); // still just the box
});

test("a key Claude doesn't accept is explained, and Blurry still answers from his own how-tos", async ({ page }) => {
  await page.route("https://api.anthropic.com/**", (route) =>
    route.fulfill({
      status: 401,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    }),
  );
  await turnOnClaude(page);
  await ask(page, "how do I thread a hole?");
  const reply = panel(page).getByTestId("blurry-says").last();
  await expect(reply).toContainText("Claude didn't accept the key");
  await expect(reply.getByRole("listitem").first()).toContainText("Add a hole");

  // Turning Claude off forgets the key; questions are answered offline again, with nothing sent.
  await panel(page).getByRole("button", { name: "Blurry settings" }).click();
  await panel(page).getByRole("button", { name: "Turn off and forget the key" }).click();
  await panel(page).getByRole("button", { name: "Back to the conversation" }).click();
  await expect(panel(page)).toContainText("Claude is off, and your key is forgotten.");
  await expect(panel(page)).toContainText("Helper · works offline");
});

test("a key that isn't an Anthropic key is refused before anything is sent", async ({ page }) => {
  let calls = 0;
  await page.route("https://api.anthropic.com/**", (route) => {
    calls++;
    return route.abort();
  });
  await page.getByRole("button", { name: "Ask Blurry" }).click();
  await panel(page).getByRole("button", { name: "Blurry settings" }).click();
  await panel(page).getByLabel("Anthropic API key").fill("sk-proj-abc");
  await panel(page).getByRole("button", { name: "Turn on Claude" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Keys start with sk-ant-");
  expect(calls).toBe(0);
});
