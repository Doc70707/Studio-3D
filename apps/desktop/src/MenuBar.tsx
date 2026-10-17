// The menu bar (File, Edit, View, Create, Modify, Help), laid out like a Windows desktop app: click a menu or press
// Alt to reach it, arrow keys move around, Enter picks, Escape closes. Every item runs a real command; items that
// can't run right now are shown greyed out with the reason in their tooltip.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  /** Why the item is greyed out, shown as its tooltip. */
  reason?: string;
  /** For on/off items, like showing sizes. */
  checked?: boolean;
}
export type MenuEntry = MenuItem | "separator";
export interface Menu {
  label: string;
  items: MenuEntry[];
}

const isItem = (e: MenuEntry): e is MenuItem => e !== "separator";

export function MenuBar({ menus }: { menus: Menu[] }) {
  /** Which menu is open, and which of its items has the keyboard. */
  const [open, setOpen] = useState<{ menu: number; item: number } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tops = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const enabledIndexes = (m: number) =>
    menus[m]!.items.flatMap((e, i) => (isItem(e) && !e.disabled ? [i] : []));
  const openMenu = (menu: number, first = false) => {
    const enabled = enabledIndexes(menu);
    setOpen({ menu, item: first ? (enabled[0] ?? -1) : -1 });
  };
  const close = (focusTop?: number) => {
    setOpen(null);
    if (focusTop !== undefined) tops.current[focusTop]?.focus();
  };

  // Clicking anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // The keyboard follows the highlighted item.
  useEffect(() => {
    if (open && open.item >= 0) items.current[open.item]?.focus();
  }, [open]);

  // Alt on its own reaches the menu bar; Alt + a menu's first letter opens it (Windows convention).
  useEffect(() => {
    let altAlone = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altAlone = !e.repeat;
        return;
      }
      altAlone = false;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const m = menus.findIndex((x) => x.label[0]!.toLowerCase() === e.key.toLowerCase());
      if (m >= 0) {
        e.preventDefault();
        openMenu(m, true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      if (open) close();
      else tops.current[0]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    setOpen(null);
    item.onSelect();
  };

  const onTopKey = (e: ReactKeyboardEvent, m: number) => {
    const n = menus.length;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (m + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
      tops.current[next]?.focus();
      if (open) openMenu(next, true);
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(m, true);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      close(m);
    }
  };

  const onItemKey = (e: ReactKeyboardEvent) => {
    if (!open) return;
    const enabled = enabledIndexes(open.menu);
    const at = enabled.indexOf(open.item);
    const n = menus.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!enabled.length) return;
      const next = e.key === "ArrowDown" ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length;
      setOpen({ ...open, item: enabled[next]! });
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (open.menu + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
      openMenu(next, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(open.menu);
    } else if (e.key === "Tab") close();
  };

  return (
    <div className="menubar" role="menubar" aria-label="Menu" ref={bar}>
      {menus.map((menu, m) => (
        <div className="menu" key={menu.label}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open?.menu === m}
            className="menu-top"
            ref={(el) => {
              tops.current[m] = el;
            }}
            onClick={() => (open?.menu === m ? close() : openMenu(m))}
            onPointerEnter={() => open && open.menu !== m && openMenu(m)}
            onKeyDown={(e) => onTopKey(e, m)}
          >
            {menu.label}
          </button>
          {open?.menu === m && (
            <div className="menu-list glass" role="menu" aria-label={menu.label}>
              {menu.items.map((entry, i) =>
                isItem(entry) ? (
                  <button
                    key={entry.label}
                    type="button"
                    role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={entry.checked}
                    aria-disabled={entry.disabled || undefined}
                    className={`menu-item${entry.disabled ? " disabled" : ""}`}
                    title={entry.disabled ? entry.reason : undefined}
                    aria-description={entry.shortcut ? `Shortcut: ${entry.shortcut}` : undefined}
                    tabIndex={-1}
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    onClick={() => choose(entry)}
                    onPointerEnter={() => !entry.disabled && setOpen({ menu: m, item: i })}
                    onKeyDown={onItemKey}
                  >
                    <span className="menu-check" aria-hidden="true">
                      {entry.checked ? "✓" : ""}
                    </span>
                    <span className="menu-label">{entry.label}</span>
                    {entry.shortcut && <kbd aria-hidden="true">{entry.shortcut}</kbd>}
                  </button>
                ) : (
                  <div key={`sep${i}`} role="separator" className="menu-sep" />
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
