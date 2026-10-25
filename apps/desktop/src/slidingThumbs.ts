// Segmented controls get one thumb that slides to the picked option, the way a physical switch moves, instead of
// the highlight blinking from one button to the next. The buttons stay ordinary toggle buttons (aria-pressed); this
// only measures the pressed one and tells the CSS where to draw the thumb.

const GROUPS = ".segmented-small, .segmented";

/** Where the thumb goes inside a group: the pressed button's box, relative to the group, or null for none pressed. */
export function thumbFor(group: HTMLElement): { x: number; y: number; w: number; h: number } | null {
  const on = group.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
  if (!on || on.offsetParent === null) return null;
  return { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
}

function place(group: HTMLElement): void {
  const t = thumbFor(group);
  if (!t) {
    group.classList.remove("has-thumb");
    return;
  }
  const first = !group.classList.contains("has-thumb");
  if (first) group.classList.add("thumb-still"); // appear in place, don't slide in from the corner
  group.style.setProperty("--thumb-x", `${t.x}px`);
  group.style.setProperty("--thumb-y", `${t.y}px`);
  group.style.setProperty("--thumb-w", `${t.w}px`);
  group.style.setProperty("--thumb-h", `${t.h}px`);
  group.classList.add("has-thumb");
  if (first) requestAnimationFrame(() => group.classList.remove("thumb-still"));
}

/** Keeps every segmented control under `root` showing a sliding thumb. Returns a function that stops it. */
export function attachSlidingThumbs(root: HTMLElement): () => void {
  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.querySelectorAll<HTMLElement>(GROUPS).forEach((g) => {
        sizes.observe(g); // a palette being resized moves the buttons; observing twice is harmless
        place(g);
      });
    });
  };
  // Only presses and added or removed controls: the thumb's own class and style changes must not wake this again.
  const watch = new MutationObserver(update);
  watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"] });
  const sizes = new ResizeObserver(update);
  sizes.observe(root);
  update();
  return () => {
    watch.disconnect();
    sizes.disconnect();
    cancelAnimationFrame(frame);
  };
}
