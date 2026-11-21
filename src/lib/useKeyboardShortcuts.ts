"use client";

import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";

const VIM_KEY = "ms_vim_shortcuts";
const vimChange = new Event("ms-vim-shortcuts-change");
const overlays = '[aria-modal="true"], [role="menu"], dialog[open]';

function subscribe(onChange: () => void) {
  window.addEventListener(vimChange.type, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(vimChange.type, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readVim() {
  try {
    return localStorage.getItem(VIM_KEY) === "on";
  } catch {
    return false;
  }
}

export function useVimShortcuts() {
  return useSyncExternalStore(subscribe, readVim, () => false);
}

export function setVimShortcuts(enabled: boolean) {
  try {
    localStorage.setItem(VIM_KEY, enabled ? "on" : "off");
  } catch {
    return;
  }
  window.dispatchEvent(vimChange);
}

export function shortcutBlocked(event: KeyboardEvent, owner?: HTMLElement | null) {
  const target = event.target;
  return (
    event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
    event.altKey || event.ctrlKey || event.metaKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest('input, textarea, select, [role="textbox"]'))) ||
    Array.from(document.querySelectorAll(overlays)).some(
      (overlay) => !owner || !overlay.contains(owner)
    )
  );
}

export type KeyboardScope = "articles" | "shorts" | "reader" | "gallery";
type Command =
  | "up" | "down" | "left" | "right"
  | "previous" | "next" | "pageUp" | "pageDown" | "first" | "last"
  | "open" | "save" | "close" | "listen";

type Binding = {
  command: Command;
  label: string;
  keys: string[];
  vim?: string[];
};

const edges = (label: string): Binding[] => [
  { command: "first", label: `First ${label}`, keys: ["Home"], vim: ["gg"] },
  { command: "last", label: `Last ${label}`, keys: ["End"], vim: ["G"] },
];
const open: Binding = { command: "open", label: "Open article", keys: ["Enter"], vim: ["o"] };

export const shortcuts: Record<KeyboardScope, Binding[]> = {
  articles: [
    { command: "left", label: "Article to the left", keys: ["←"], vim: ["h"] },
    { command: "right", label: "Article to the right", keys: ["→"], vim: ["l"] },
    { command: "down", label: "Article below", keys: ["↓"], vim: ["j"] },
    { command: "up", label: "Article above", keys: ["↑"], vim: ["k"] },
    open,
    ...edges("loaded article"),
  ],
  shorts: [
    { command: "previous", label: "Previous card", keys: ["↑"], vim: ["k"] },
    { command: "next", label: "Next card", keys: ["↓", "Space"], vim: ["j"] },
    open,
    ...edges("loaded card"),
    { command: "save", label: "Save and move on", keys: ["→"] },
    { command: "close", label: "Back to the feed", keys: ["Esc"] },
  ],
  reader: [
    { command: "previous", label: "Scroll up", keys: ["↑"], vim: ["k"] },
    { command: "next", label: "Scroll down", keys: ["↓"], vim: ["j"] },
    { command: "pageUp", label: "Scroll up a page", keys: ["Page Up", "Shift+Space"] },
    { command: "pageDown", label: "Scroll down a page", keys: ["Page Down", "Space"] },
    { command: "first", label: "Start of article", keys: ["Home"], vim: ["gg"] },
    { command: "last", label: "End of article", keys: ["End"], vim: ["G"] },
    { command: "listen", label: "Toggle listening", keys: ["L"] },
    { command: "close", label: "Close article", keys: ["Esc"] },
  ],
  gallery: [
    { command: "previous", label: "Previous image", keys: ["←"] },
    { command: "next", label: "Next image", keys: ["→"] },
    { command: "close", label: "Close image", keys: ["Esc"] },
  ],
};

const keyLabels: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  PageUp: "Page Up", PageDown: "Page Down", Escape: "Esc",
};

function shortcutKey(event: KeyboardEvent, scope: KeyboardScope) {
  if (event.key === "?") return "?";
  // The unshifted physical slash still belongs to SearchField.
  if (event.shiftKey && event.code === "Slash") return "?";
  if (event.key === " ") return event.shiftKey ? "Shift+Space" : "Space";
  if (event.code === "KeyG" && event.shiftKey) return "G";
  if (event.code === "KeyL" && scope === "reader") return "L";
  if (event.shiftKey) return "";
  if (/^Key[GHJKLO]$/.test(event.code)) return event.code[3].toLowerCase();
  return keyLabels[event.key] ?? (event.key.length > 1 ? event.key : "");
}

const activationControl =
  'a[href], button, summary, [role="button"], [role="link"], [role="switch"], [role="tab"]';
const articleAction = "[data-article-link], [data-short-read]";

export function useKeyboardShortcuts(
  scope: KeyboardScope,
  handle: (command: Command) => boolean | void,
  owner?: { current: HTMLElement | null },
  blocked = false
) {
  const vim = useVimShortcuts();
  const help = useRef<HTMLDialogElement>(null);
  const lastG = useRef<number | null>(null);
  const showHelp = () => help.current?.showModal();

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (blocked || shortcutBlocked(event, owner?.current)) {
      lastG.current = null;
      return;
    }

    let key = shortcutKey(event, scope);
    if (key === "g" && vim && scope !== "gallery") {
      event.preventDefault();
      if (event.repeat) return;
      if (lastG.current === null || event.timeStamp - lastG.current > 700) {
        lastG.current = event.timeStamp;
        return;
      }
      key = "gg";
    }
    lastG.current = null;

    if (key === "?") {
      event.preventDefault();
      if (!event.repeat) showHelp();
      return;
    }

    const target = event.target;
    const control = target instanceof Element && target.closest(activationControl);
    if (key === "Enter" && control) {
      if (event.repeat && control.matches(articleAction)) event.preventDefault();
      return;
    }
    if ((key === "Space" || key === "Shift+Space") && control &&
        !control.matches('a[href], [role="link"]')) return;

    const binding = shortcuts[scope].find(
      ({ keys, vim: aliases }) => keys.includes(key) || (vim && aliases?.includes(key))
    );
    if (!binding) return;
    if (event.repeat && ["open", "close", "save", "listen"].includes(binding.command)) {
      event.preventDefault();
      return;
    }
    if (handle(binding.command) !== false) event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return { help, showHelp, vim };
}
