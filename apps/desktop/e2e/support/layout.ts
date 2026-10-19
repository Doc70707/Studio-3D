import type { Page } from "@playwright/test";

/** A place where the interface's text doesn't fit: clipped, escaping its box, or on top of other text. */
export interface LayoutProblem {
  kind: "clipped" | "escapes" | "overlaps" | "off-screen";
  what: string;
  detail: string;
}

/**
 * Looks over every visible piece of text and every control in the page, the way a person squinting at the screen
 * would: text cut off inside its own box, text sticking out of the panel or bar that holds it, two pieces of text
 * drawn over each other, and anything hanging off the window. Floating layers (menus, popovers, dialogs) may cover
 * what is under them; only things in the same layer are compared.
 */
export function findLayoutProblems(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate(() => {
    const problems: { kind: "clipped" | "escapes" | "overlaps" | "off-screen"; what: string; detail: string }[] = [];
    const describe = (el: Element) => {
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("data-testid") ||
        (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cls = typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : "";
      return `${el.tagName.toLowerCase()}${cls} "${name}"`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !!(el as HTMLElement).offsetParent !== false;
    };
    const hiddenByAncestor = (el: Element) => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        // Inside a closed <details>, only its summary is shown.
        const d = a.parentElement;
        if (d instanceof HTMLDetailsElement && !d.open && a.tagName !== "SUMMARY") return true;
        const s = getComputedStyle(a);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return true;
        if (a.hasAttribute("hidden") || a.getAttribute("aria-hidden") === "true") return true;
      }
      return false;
    };
    // The layer an element is drawn in: the nearest ancestor that floats over the rest.
    const layerOf = (el: Element): Element => {
      for (let a: Element | null = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if ((s.position === "absolute" || s.position === "fixed") && s.zIndex !== "auto") return a;
        if (a.matches('[role="dialog"],[role="menu"],[role="listbox"],.popover,.menu')) return a;
      }
      return document.body;
    };
    const textOf = (el: Element) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
    // Pieces of text: elements that hold text themselves, plus form fields, plus SVG text.
    const all = Array.from(document.querySelectorAll("body *")).filter(
      (el) => !hiddenByAncestor(el) && (textOf(el) || el.matches("input, select, textarea") || el.tagName === "text"),
    );
    const W = window.innerWidth;
    const H = window.innerHeight;
    const boxes: { el: Element; r: DOMRect; layer: Element; clip: { l: number; t: number; r: number; b: number } }[] =
      [];
    // What of an element can be seen through the scroll areas and clipped boxes round it.
    const clipOf = (el: Element) => {
      let [l, t, rr, b] = [-Infinity, -Infinity, Infinity, Infinity];
      // An element that cuts its own text off with an ellipsis shows only what fits in it.
      const own = getComputedStyle(el);
      const start = own.textOverflow === "ellipsis" && own.overflowX !== "visible" ? el : el.parentElement;
      for (let a = start; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX === "visible" && as.overflowY === "visible") continue;
        const c = a.getBoundingClientRect();
        [l, t, rr, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rr, c.right), Math.min(b, c.bottom)];
      }
      return { l, t, r: rr, b };
    };
    const inScrollArea = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowY === "auto" || as.overflowY === "scroll") return true;
      }
      return false;
    };
    for (const el of all) {
      if (!visible(el) && el.tagName !== "text") continue;
      const r0 = el.getBoundingClientRect();
      if (r0.width === 0 || r0.height === 0) continue;
      const clip = clipOf(el);
      // Scrolled out of sight: nothing to see, so nothing to judge.
      if (r0.right <= clip.l || r0.left >= clip.r || r0.bottom <= clip.t || r0.top >= clip.b) continue;
      const scrolled = inScrollArea(el);
      const r = scrolled
        ? new DOMRect(
            Math.max(r0.left, clip.l),
            Math.max(r0.top, clip.t),
            Math.min(r0.right, clip.r) - Math.max(r0.left, clip.l),
            Math.min(r0.bottom, clip.b) - Math.max(r0.top, clip.t),
          )
        : r0;
      const s = getComputedStyle(el);
      // Text cut off inside its own box, without an ellipsis to show that it was.
      if (
        el instanceof HTMLElement &&
        !el.matches("input, select, textarea") &&
        s.overflowX !== "visible" &&
        s.textOverflow !== "ellipsis" &&
        el.scrollWidth > el.clientWidth + 1
      )
        problems.push({ kind: "clipped", what: describe(el), detail: `${el.scrollWidth} > ${el.clientWidth}` });
      // Numbers too long for their box (while typing, a box scrolls as usual).
      if (
        el instanceof HTMLInputElement &&
        el.type !== "range" &&
        el !== document.activeElement &&
        el.scrollWidth > el.clientWidth + 1
      )
        problems.push({ kind: "clipped", what: describe(el), detail: `value "${el.value}" is wider than the box` });
      if (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)
        problems.push({
          kind: "off-screen",
          what: describe(el),
          detail: `${Math.round(r.left)},${Math.round(r.top)} – ${Math.round(r.right)},${Math.round(r.bottom)}`,
        });
      // Text sticking out of whatever clips it (a panel, a bar, a scroll area).
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX === "visible" && as.overflowY === "visible") continue;
        const c = a.getBoundingClientRect();
        const scrolls = as.overflowY === "auto" || as.overflowY === "scroll";
        // Inside a scroll area, only sideways escape is a problem: up and down is what scrolling is for.
        if (
          r.right > c.right + 1 ||
          r.left < c.left - 1 ||
          (!scrolls && (r.bottom > c.bottom + 1 || r.top < c.top - 1))
        )
          problems.push({ kind: "escapes", what: describe(el), detail: `out of ${describe(a)}` });
        break;
      }
      boxes.push({ el, r, layer: layerOf(el), clip });
    }
    // Text drawn over other text in the same layer.
    const inkOf = (b: { el: Element; r: DOMRect; clip: { l: number; t: number; r: number; b: number } }) => {
      const cut = (q: DOMRect) => {
        const [l, t] = [Math.max(q.left, b.clip.l), Math.max(q.top, b.clip.t)];
        return new DOMRect(
          l,
          t,
          Math.max(0, Math.min(q.right, b.clip.r) - l),
          Math.max(0, Math.min(q.bottom, b.clip.b) - t),
        );
      };
      // The text itself, not the padding round it, and only the part that can be seen.
      if (b.el.matches("input, select, textarea") || b.el.tagName === "text") return cut(b.r);
      const range = document.createRange();
      range.selectNodeContents(b.el);
      const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0);
      return cut(
        rects.length
          ? rects.reduce(
              (u, q) =>
                new DOMRect(
                  Math.min(u.x, q.x),
                  Math.min(u.y, q.y),
                  Math.max(u.right, q.right) - Math.min(u.x, q.x),
                  Math.max(u.bottom, q.bottom) - Math.min(u.y, q.y),
                ),
            )
          : b.r,
      );
    };
    const ink = boxes.map((b) => ({ ...b, ink: inkOf(b) }));
    for (let i = 0; i < ink.length; i++)
      for (let j = i + 1; j < ink.length; j++) {
        const [a, b] = [ink[i]!, ink[j]!];
        if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.ink.right, b.ink.right) - Math.max(a.ink.left, b.ink.left);
        const h = Math.min(a.ink.bottom, b.ink.bottom) - Math.max(a.ink.top, b.ink.top);
        if (w > 2 && h > 2)
          problems.push({
            kind: "overlaps",
            what: describe(a.el),
            detail: `on top of ${describe(b.el)} (${Math.round(w)}×${Math.round(h)} px)`,
          });
      }
    return problems;
  });
}
