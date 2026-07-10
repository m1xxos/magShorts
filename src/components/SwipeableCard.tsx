"use client";

import { useRef, useState } from "react";

const THRESHOLD = 90;
const MAX_DRAG = 160;

type Intent = "none" | "horizontal" | "vertical";

export function SwipeableCard({
  onSwipeRight,
  onSwipeLeft,
  rightLabel,
  leftLabel,
  className,
  children,
}: {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  rightLabel: string;
  leftLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const intent = useRef<Intent>("none");
  const suppressClick = useRef(false);

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    intent.current = "none";
    suppressClick.current = false;
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;

    if (intent.current === "none") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      intent.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (intent.current === "horizontal") {
        (event.currentTarget as HTMLElement).setPointerCapture(
          event.pointerId
        );
        setDragging(true);
      }
    }
    if (intent.current !== "horizontal") return;

    suppressClick.current = true;
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
    setOffset(clamped);
    if (event.cancelable) event.preventDefault();
  }

  function finishDrag() {
    if (intent.current === "horizontal") {
      if (offset >= THRESHOLD) onSwipeRight();
      else if (offset <= -THRESHOLD) onSwipeLeft();
    }
    start.current = null;
    intent.current = "none";
    setDragging(false);
    setOffset(0);
  }

  const revealRight = offset > 8;
  const revealLeft = offset < -8;
  const strength = Math.min(Math.abs(offset) / THRESHOLD, 1);

  return (
    <div className={`relative ${className ?? ""}`}>
      {/* Action layer revealed under the card */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-between overflow-hidden rounded-2xl"
        aria-hidden
      >
        {revealRight ? (
          <div
            className="flex h-full w-full items-center rounded-2xl bg-clay-soft pl-6 text-clay transition-opacity"
            style={{ opacity: 0.4 + strength * 0.6 }}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <BookmarkIcon /> {rightLabel}
            </span>
          </div>
        ) : revealLeft ? (
          <div
            className="flex h-full w-full items-center justify-end rounded-2xl bg-[#e3ebe9] pr-6 text-[#42706a] transition-opacity"
            style={{ opacity: 0.4 + strength * 0.6 }}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {leftLabel} <OmnivoreIcon />
            </span>
          </div>
        ) : null}
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        className="touch-pan-y"
        style={{
          transform: `translateX(${offset}px) rotate(${offset / 60}deg)`,
          transition: dragging ? "none" : "transform 250ms ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function BookmarkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// Stylized open "O" with a dot, nodding to the Omnivore logo.
export function OmnivoreIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M20.2 15.3A9 9 0 1 1 21 12" />
      <circle cx="20" cy="11.2" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UnlockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}
