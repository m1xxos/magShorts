"use client";

import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { KeyboardHelp } from "./KeyboardHelp";

type Direction = "left" | "right" | "up" | "down";

function articleBounds(link: HTMLAnchorElement, horizontal: boolean) {
  // Measure the card's layout box, outside the hover and swipe transforms.
  const rect = (link.closest("[data-article-card]") ?? link).getBoundingClientRect();
  return horizontal
    ? { start: rect.left, end: rect.right, crossStart: rect.top, crossEnd: rect.bottom }
    : { start: rect.top, end: rect.bottom, crossStart: rect.left, crossEnd: rect.right };
}

function neighbor(
  links: HTMLAnchorElement[],
  focused: HTMLAnchorElement,
  direction: Direction
) {
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "down";
  const origin = articleBounds(focused, horizontal);
  const candidates = links.filter((link) => link !== focused).map((link) => {
    const bounds = articleBounds(link, horizontal);
    const gap = forward ? bounds.start - origin.end : origin.start - bounds.end;
    const aligned = bounds.crossStart < origin.crossEnd && bounds.crossEnd > origin.crossStart;
    const offset = Math.abs(bounds.crossStart + bounds.crossEnd - origin.crossStart - origin.crossEnd);
    return { link, gap, aligned, offset };
  });

  // Keep horizontal moves in the current row. Vertical moves prefer the same
  // column and can reach a card in an incomplete last row.
  const [nearest] = candidates
    .filter(({ gap, aligned }) => gap >= -1 && (!horizontal || aligned))
    .sort((a, b) => Number(b.aligned) - Number(a.aligned) || a.gap - b.gap || a.offset - b.offset);
  return nearest?.link ?? focused;
}

export function ArticleKeyboard() {
  const { help, vim } = useKeyboardShortcuts("articles", (command) => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("main [data-article-link]"))
      .filter((link) => link.getClientRects().length > 0);
    if (!links.length) return false;

    const focused = links.find((link) => link === document.activeElement);
    let target = focused ?? links[0];
    switch (command) {
      case "left":
      case "right":
      case "up":
      case "down":
        if (focused) target = neighbor(links, focused, command);
        break;
      case "first":
        target = links[0];
        break;
      case "last":
        target = links[links.length - 1];
        break;
      case "open":
        target.focus({ preventScroll: true });
        target.click();
        return;
      default:
        return false;
    }

    if (target !== focused) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    }
  });

  return <KeyboardHelp dialogRef={help} scope="articles" vim={vim} />;
}
