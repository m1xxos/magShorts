"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// The row menu.
//
// A row used to carry every action it could perform at one weight — Manage
// sources had eight — and the ones that did not fit were hidden behind a hover
// fade, where a mis-aimed click unsubscribed you. One trigger per row, verbs
// for labels, and the destructive item last and set apart.
//
// Dismissal is on `pointerdown`, not `click`: a click fires after React may
// already have re-rendered the thing under the cursor, so a menu item that
// removes its own row can close on an element that no longer exists.

export interface MenuAction {
  label: string;
  onSelect: () => void;
  // Sits last, after a hairline, in the accent. State the consequence in the
  // label — this is the only place a row can say what deleting it costs.
  destructive?: boolean;
  disabled?: boolean;
  hint?: string;
}

export type MenuNode =
  | ({ kind?: "action" } & MenuAction)
  // A row that is a control rather than a command: the route segments in
  // Manage sources live here.
  | { kind: "custom"; key: string; label?: string; render: ReactNode }
  | { kind: "separator"; key: string };

export function Menu({
  items,
  title = "More",
  align = "right",
  trigger,
}: {
  items: MenuNode[];
  title?: string;
  align?: "left" | "right";
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    // Capture, so closing the menu wins over the reader's own Escape handler:
    // Escape with a menu open should close the menu, not the article behind it.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        onClick={() => setOpen((was) => !was)}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-paper-sunken hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11 ${
          open ? "bg-paper-sunken text-ink" : ""
        }`}
      >
        {trigger ?? <span className="text-[17px] leading-none">⋯</span>}
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          className={`absolute top-full z-30 mt-1.5 w-[220px] overflow-hidden rounded-2xl border border-line bg-paper-raised py-1 shadow-[0_14px_40px_-16px_rgba(31,30,27,0.45)] pointer-coarse:w-[300px] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, index) => {
            if (item.kind === "separator") {
              return (
                <div key={item.key} className="my-1 h-px bg-line" />
              );
            }
            if (item.kind === "custom") {
              return (
                <div key={item.key} className="px-3 py-2">
                  {item.label && (
                    <p className="mb-1.5 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
                      {item.label}
                    </p>
                  )}
                  {item.render}
                </div>
              );
            }
            return (
              <button
                key={`${item.label}-${index}`}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full flex-col items-start px-3 py-2 text-left text-[13.5px] transition disabled:opacity-40 pointer-coarse:min-h-12 pointer-coarse:justify-center pointer-coarse:text-[15.5px] ${
                  item.destructive
                    ? "text-clay hover:bg-clay-soft"
                    : "text-ink-soft hover:bg-paper-sunken hover:text-ink"
                }`}
              >
                {item.label}
                {item.hint && (
                  <span className="text-[11.5px] text-ink-faint pointer-coarse:text-[13px]">
                    {item.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The hairline before a destructive tail, as a value — every menu that has one
// writes it the same way.
export function separator(key: string): MenuNode {
  return { kind: "separator", key };
}
