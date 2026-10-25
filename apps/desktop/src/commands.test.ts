import { describe, expect, it, vi } from "vitest";
import { findCommands, indexCommands } from "./commands";
import type { Menu } from "./MenuBar";
import type { RibbonTab } from "./Ribbon";

const run = vi.fn();
const menus: Menu[] = [
  {
    label: "File",
    items: [{ label: "Export STL…", onSelect: run }, "separator", { label: "Open…", onSelect: run }],
  },
  { label: "Edit", items: [{ label: "Undo", onSelect: run, shortcut: "Ctrl+Z", disabled: true, reason: "Nothing" }] },
  { label: "Modify", items: [{ label: "Fillet", onSelect: run }] },
  { label: "Help", items: [{ label: "Keyboard and mouse", onSelect: run }] },
];
const tabs: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      { label: "Shapes", items: [{ icon: "box", label: "Box", onClick: run }] },
      { label: "Modify", items: [{ icon: "fillet", label: "Fillet", onClick: run }] },
    ],
  },
];
const commands = indexCommands(menus, tabs);
const titles = (q: string) => findCommands(q, commands).map((f) => f.command.title);

describe("the command list", () => {
  it("has every menu and ribbon command once, with where to find it, and no Help items", () => {
    expect(commands.map((c) => c.title).sort()).toEqual(["Box", "Export STL", "Fillet", "Open", "Undo"]);
    expect(commands.find((c) => c.title === "Fillet")!.where).toEqual(["Modify", "Home › Modify"]);
    const undo = commands.find((c) => c.title === "Undo")!;
    expect(undo).toMatchObject({ disabled: true, reason: "Nothing", shortcut: "Ctrl+Z" });
  });

  it("finds a command by its typed name, exactly or by the start of it", () => {
    expect(titles("FILLET")[0]).toBe("Fillet");
    expect(titles("f")[0]).toBe("Fillet"); // F is Fillet's own short name, as in AutoCAD
    expect(titles("fil")[0]).toBe("Fillet");
    expect(titles("stl")[0]).toBe("Export STL");
    expect(findCommands("FILLET", commands)[0]!.matched).toBe("FILLET");
  });

  it("finds a command by what it does, in everyday words", () => {
    expect(titles("round the edges")[0]).toBe("Fillet");
    expect(titles("edges round")[0]).toBe("Fillet");
    expect(titles("cube")[0]).toBe("Box");
    expect(titles("oops")[0]).toBe("Undo");
    expect(titles("load")[0]).toBe("Open");
  });

  it("finds nothing for nonsense", () => {
    expect(titles("zzz")).toEqual([]);
    expect(titles("  ")).toEqual([]);
  });
});

describe("menu and ribbon names for the same command", () => {
  it("are one command: a menu's longer wording, a ribbon's short label and a piece's name are left off", () => {
    const list = indexCommands(
      [
        {
          label: "Modify",
          items: [
            { label: "Fillet (round edges)", onSelect: run },
            { label: "Pattern Box 1", onSelect: run },
            { label: "Hollow out", onSelect: run },
          ],
        },
      ],
      [
        {
          id: "home",
          label: "Home",
          groups: [
            {
              label: "Modify",
              items: [
                { icon: "fillet", label: "Fillet", onClick: run },
                { icon: "hollow", label: "Hollow", onClick: run },
              ],
            },
          ],
        },
      ],
      [{ title: "Rectangle", where: ["Sketch"], run }],
    );
    expect(list.map((c) => c.title).sort()).toEqual(["Fillet", "Hollow out", "Pattern", "Rectangle"]);
    expect(list.find((c) => c.title === "Hollow out")!.where).toEqual(["Modify", "Home › Modify"]);
    expect(findCommands("REC", list)[0]!.command.title).toBe("Rectangle");
    expect(findCommands("shell", list)[0]!.command.title).toBe("Hollow out");
  });
});
