import { describe, expect, it, vi } from "vitest";
import { answer, findHowTo, HOW_TOS } from "./blurry";
import { indexCommands } from "./commands";
import type { Menu } from "./MenuBar";

const run = vi.fn();
const menus: Menu[] = [
  { label: "File", items: [{ label: "Prepare to print…", onSelect: run }] },
  {
    label: "View",
    items: [
      { label: "Sizes in inches", onSelect: run },
      { label: "Measure distance", onSelect: run },
    ],
  },
  {
    label: "Create",
    items: [
      { label: "Box", onSelect: run },
      { label: "Hole", onSelect: run },
    ],
  },
  { label: "Modify", items: [{ label: "Fillet (round edges)", onSelect: run }] },
];
const commands = indexCommands(menus, []);

describe("Blurry's offline help", () => {
  it("finds the how-to a question is about", () => {
    expect(findHowTo("how do I thread a hole for an M3 screw?")?.id).toBe("thread");
    expect(findHowTo("can I work in inches")?.id).toBe("units");
    expect(findHowTo("how far apart are these two holes")?.id).toBe("measure");
    expect(findHowTo("I want to send it to my Bambu printer")?.id).toBe("print");
    expect(findHowTo("round off this one edge")?.id).toBe("fillet-edge");
    expect(findHowTo("banana")).toBeNull();
  });

  it("every how-to that names a command names a real one", () => {
    const titles = new Set([
      "Hole",
      "Fillet",
      "Sizes in inches",
      "Prepare to print",
      "Measure distance",
      "Sketch on the plate",
      "Hollow out",
      "Undo",
    ]);
    for (const h of HOW_TOS) if (h.command) expect(titles).toContain(h.command);
  });

  it("answers with the steps and offers the command that starts it", () => {
    const a = answer("How do I thread a hole?", commands);
    expect(a.howTo?.id).toBe("thread");
    expect(a.commands[0]!.command.title).toBe("Hole");
  });

  it("an order finds the command to run; nonsense gets an honest answer", () => {
    expect(answer("add a box", commands).commands[0]!.command.title).toBe("Box");
    expect(answer("make a cube", commands).commands[0]!.command.title).toBe("Box");
    const none = answer("zzzz", commands);
    expect(none.commands).toEqual([]);
    expect(none.text).toContain("don't know");
  });
});

describe("what a sentence asks for", () => {
  it("leaves out the little words, and falls back to its words one by one", () => {
    expect(answer("I want a hole in the top", commands).commands[0]!.command.title).toBe("Hole");
    expect(answer("please put a fillet on it", commands).commands[0]!.command.title).toBe("Fillet");
  });
});
