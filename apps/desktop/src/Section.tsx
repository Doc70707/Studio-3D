// A panel section that folds away to its title and a one-line summary ("All 4 checks pass", "0.20 mm · 2 walls"), so a
// long panel reads at a glance and opens only where you need the detail. Each section remembers being opened or folded
// on this computer; until it has been, `open` decides (a section with something to fix starts open).
import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

const KEY = "studio3d.sections";

function remembered(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function remember(id: string, open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [id]: open }));
  } catch {
    // Storage can be refused (a private window); the section then just opens as it starts.
  }
}

interface Props {
  /** Names the section for remembering it; keep it the same across versions. */
  id: string;
  title: string;
  /** A few words on how it stands, shown beside the title, folded or not. */
  summary?: ReactNode;
  tone?: "ok" | "warning" | "error";
  /** Open when nothing is remembered for it. */
  open?: boolean;
  /** Open whatever was remembered: something in it needs attention now. */
  forceOpen?: boolean;
  /** Show the summary only while folded, when it repeats what the open section shows anyway. */
  summaryWhenFolded?: boolean;
  children: ReactNode;
}

export function Section(props: Props) {
  const {
    id,
    title,
    summary,
    tone,
    open: start = true,
    forceOpen = false,
    summaryWhenFolded = false,
    children,
  } = props;
  const [open, setOpen] = useState(() => remembered()[id] ?? start);
  const body = useId();
  const shown = open || forceOpen;
  return (
    <section className={`panel-section${shown ? " open" : ""}`} data-section={id}>
      <h2 className="panel-section-title">
        <button
          type="button"
          aria-expanded={shown}
          aria-controls={body}
          onClick={() => {
            setOpen(!shown);
            remember(id, !shown);
          }}
        >
          <Icon name="chevronRight" />
          <span className="name">{title}</span>
          {summary && !(summaryWhenFolded && shown) && (
            <span className={`summary${tone ? ` ${tone}` : ""}`}>{summary}</span>
          )}
        </button>
      </h2>
      <div className="panel-section-body" id={body} hidden={!shown}>
        {children}
      </div>
    </section>
  );
}
