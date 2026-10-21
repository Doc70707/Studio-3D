// Thread an existing hole: picked from its inside face (right-click) or from Properties. The 3D view previews the
// thread while the settings change; Apply keeps it as one undo step, Cancel leaves the hole as it was.
import { useEffect } from "react";
import {
  PRINT_FITS,
  THREADS,
  THREAD_SIZES,
  THREAD_STANDARDS,
  checkThread,
  pitchLabel,
  suggestThread,
  threadLabel,
  type HoleFeature,
  type ThreadSettings,
  type ThreadSize,
  lengthText,
} from "@studio3d/document";
import { STANDARD_LABELS } from "./DesignPanel";
import { NumberField } from "./NumberField";
import { Icon } from "./Icon";

const mm = (n: number) => lengthText(n);

export function ThreadDialog(props: {
  hole: HoleFeature;
  settings: ThreadSettings;
  /** How deep a through hole is: the part's height. */
  partHeight: number;
  onChange: (s: ThreadSettings) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { hole, settings: s, onChange, onCancel } = props;
  const set = (patch: Partial<ThreadSettings>) => onChange({ ...s, ...patch });
  const standard = THREADS[s.thread].standard;
  const checks = checkThread(hole, s, props.partHeight);
  const blocked = checks.some((c) => c.severity === "error");

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel]);

  return (
    <section className="thread-dialog glass" role="dialog" aria-label={`Thread ${hole.name}`}>
      <header>
        <Icon name="hole" />
        <div>
          <h2>Thread {hole.name}</h2>
          <p>
            Ø{mm(hole.diameter)} hole, {hole.depth === 0 ? "through the part" : `${mm(hole.depth)} deep`}
          </p>
        </div>
      </header>

      <div className="thread-body">
        <div className="thread-row">
          <span className="thread-label">Standard</span>
          <div className="segmented-small" role="group" aria-label="Thread standard">
            {THREAD_STANDARDS.map((std) => (
              <button
                key={std}
                type="button"
                aria-pressed={standard === std}
                title={STANDARD_LABELS[std]}
                onClick={() => std !== standard && set({ thread: suggestThread(hole.diameter, std) })}
              >
                {std === "ISO coarse" ? "Metric" : std === "ISO fine" ? "Fine" : std}
              </button>
            ))}
          </div>
        </div>

        <div className="thread-row">
          <label className="thread-label" htmlFor="thread-size">
            Size
          </label>
          <div className="input-row select-row">
            <select id="thread-size" value={s.thread} onChange={(e) => set({ thread: e.target.value as ThreadSize })}>
              {THREAD_SIZES.filter((size) => THREADS[size].standard === standard).map((size) => (
                <option key={size} value={size}>
                  {threadLabel(size)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="thread-note" data-testid="thread-pitch">
          {pitchLabel(s.thread)}, Ø{mm(THREADS[s.thread].diameter)} across the crests
        </p>

        <div className="thread-row">
          <span className="thread-label">Hand</span>
          <div className="segmented-small" role="group" aria-label="Thread hand">
            <button type="button" aria-pressed={s.hand === "right"} onClick={() => set({ hand: "right" })}>
              Right-hand
            </button>
            <button
              type="button"
              aria-pressed={s.hand === "left"}
              title="Tightens turning anticlockwise, as on a bike's left pedal"
              onClick={() => set({ hand: "left" })}
            >
              Left-hand
            </button>
          </div>
        </div>

        <div className="thread-row">
          <span className="thread-label">Hole</span>
          <div className="segmented-small" role="group" aria-label="Hole goes">
            <button type="button" aria-pressed={s.depth === 0} onClick={() => set({ depth: 0 })}>
              Through
            </button>
            <button
              type="button"
              aria-pressed={s.depth !== 0}
              onClick={() => s.depth === 0 && set({ depth: Math.min(props.partHeight, 10) })}
            >
              Blind
            </button>
          </div>
        </div>
        {s.depth !== 0 && (
          <NumberField label="Hole depth" value={s.depth} onCommit={(depth) => set({ depth })} compact />
        )}

        <label className="check">
          <input
            type="checkbox"
            checked={s.length === null}
            onChange={(e) =>
              set({
                length: e.target.checked ? null : Math.min(s.depth || props.partHeight, 3 * THREADS[s.thread].diameter),
              })
            }
          />
          Thread the whole hole
        </label>
        {s.length !== null && (
          <NumberField label="Thread length" value={s.length} onCommit={(length) => set({ length })} compact />
        )}

        <div className="thread-row">
          <span className="thread-label">Fit</span>
          <div className="segmented-small" role="group" aria-label="Fit for printing">
            {PRINT_FITS.map((f) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={Math.abs(s.fit - f.fit) < 1e-9}
                title={`${f.hint}: ${mm(f.fit)} extra across`}
                onClick={() => set({ fit: f.fit })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <p className="thread-note">
          {mm(s.fit)} of room across the thread so it turns once printed. Machined classes like 6H don't apply to
          prints.
        </p>

        <div className="thread-row">
          <span className="thread-label">Shown as</span>
          <div className="segmented-small" role="group" aria-label="Thread shown as">
            <button
              type="button"
              aria-pressed={!s.cosmetic}
              title="The real thread, cut by the geometry kernel"
              onClick={() => set({ cosmetic: false })}
            >
              Modelled
            </button>
            <button
              type="button"
              aria-pressed={s.cosmetic}
              title="A plain tap-drill hole marked with the thread: quick to build, small files"
              onClick={() => set({ cosmetic: true })}
            >
              Cosmetic
            </button>
          </div>
        </div>

        <ul className="thread-checks" aria-label="Checks" data-testid="thread-checks">
          {checks.map((c) => (
            <li key={c.message} className={c.severity}>
              <span>{c.message}</span>
              {c.better && (
                <button type="button" className="thread-fix" onClick={() => set({ thread: c.better! })}>
                  Use {threadLabel(c.better)}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <footer>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={blocked} onClick={props.onApply}>
          Apply
        </button>
      </footer>
    </section>
  );
}
