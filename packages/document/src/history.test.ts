import { describe, expect, it } from "vitest";
import {
  GROUP_KEY,
  MAX_STEPS,
  MERGE_WINDOW_MS,
  canRedo,
  canUndo,
  record,
  redo,
  startHistory,
  undo,
  withdraw,
} from "./history";
import { newDocument, type ProjectDocument } from "./model";

const withWidth = (doc: ProjectDocument, width: number): ProjectDocument => ({
  ...doc,
  features: doc.features.map((f, i) => (i === 0 && f.type === "box" ? { ...f, width } : f)),
});
const width = (doc: ProjectDocument) => (doc.features[0]!.type === "box" ? doc.features[0]!.width : NaN);

describe("undo / redo", () => {
  it("undoes and redoes separate changes in order", () => {
    const d0 = newDocument();
    let h = startHistory(d0);
    expect(canUndo(h)).toBe(false);
    h = record(h, withWidth(d0, 70), "box.width", 0);
    h = record(h, withWidth(h.present, 80), "box.height", 10);
    h = undo(h);
    expect(width(h.present)).toBe(70);
    h = undo(h);
    expect(h.present).toBe(d0);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(width(h.present)).toBe(80);
    expect(canRedo(h)).toBe(false);
  });

  it("typing several characters into one field is one undo step", () => {
    const d0 = newDocument();
    let h = startHistory(d0);
    for (const [i, w] of [1, 12, 120].entries()) h = record(h, withWidth(h.present, w), "box.width", i * 200);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(d0);
  });

  it("the parts of one action are one step however long it takes, until something else happens", () => {
    const d0 = newDocument();
    let h = startHistory(d0);
    const key = `${GROUP_KEY}blurry-1`;
    h = record(h, withWidth(h.present, 70), key, 0);
    h = record(h, withWidth(h.present, 80), key, 30_000);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(d0);
    h = record(h, withWidth(h.present, 90), null, 30_001);
    h = record(h, withWidth(h.present, 100), key, 30_002);
    expect(h.past).toHaveLength(3);
  });

  it("a group that didn't work can be withdrawn without a trace, but only while it is the last step", () => {
    const d0 = newDocument();
    let h = startHistory(d0);
    const key = `${GROUP_KEY}blurry-2`;
    h = record(h, withWidth(h.present, 70), key, 0);
    h = record(h, withWidth(h.present, 80), key, 10);
    const back = withdraw(h, key);
    expect(back.present).toBe(d0);
    expect(canUndo(back)).toBe(false);
    expect(canRedo(back)).toBe(false);
    const after = record(h, withWidth(h.present, 90), null, 20);
    expect(withdraw(after, key)).toBe(after);
  });

  it("a pause, or a different field, starts a new step", () => {
    let h = startHistory(newDocument());
    h = record(h, withWidth(h.present, 70), "box.width", 0);
    h = record(h, withWidth(h.present, 71), "box.width", MERGE_WINDOW_MS + 1);
    expect(h.past).toHaveLength(2);
    h = record(h, withWidth(h.present, 72), null, MERGE_WINDOW_MS + 2);
    h = record(h, withWidth(h.present, 73), null, MERGE_WINDOW_MS + 3);
    expect(h.past).toHaveLength(4);
  });

  it("a new change after undo clears redo, and an undo never merges with the next edit", () => {
    let h = startHistory(newDocument());
    h = record(h, withWidth(h.present, 70), "box.width", 0);
    h = undo(h);
    h = record(h, withWidth(h.present, 90), "box.width", 1);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toHaveLength(1);
    expect(width(undo(h).present)).toBe(60);
  });

  it("keeps at most MAX_STEPS steps", () => {
    let h = startHistory(newDocument());
    for (let i = 0; i < MAX_STEPS + 50; i++) h = record(h, withWidth(h.present, 10 + i), null, i);
    expect(h.past).toHaveLength(MAX_STEPS);
  });

  it("undo and redo with nothing to do change nothing", () => {
    const h = startHistory(newDocument());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
