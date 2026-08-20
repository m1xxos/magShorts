"use client";

import { useRef, useState } from "react";

// A slideshow inside an article.
//
// The extractor emits galleries as a plain block of figures (collectGalleries
// in src/lib/extract.ts); Reader.tsx cuts those blocks out of the article HTML
// and renders this in their place. Doing it as a component rather than by
// wiring up nodes inside dangerouslySetInnerHTML is the difference between a
// carousel whose controls are React's problem and one whose controls depend on
// a handshake between hand-written CSS and a DOM-building effect — the second
// version worked until it didn't, and then said nothing about why.

export interface Slide {
  // What to show inline, already routed through the image cache.
  src: string;
  // The publisher's full-size file, for the lightbox. May be empty.
  full: string;
  caption: string;
  // The shape the page stated, so the track reserves its height before the
  // first picture arrives. 0 when the page said nothing.
  width: number;
  height: number;
}

export function ReaderGallery({
  slides,
  onOpen,
}: {
  slides: Slide[];
  onOpen: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function go(to: number) {
    const track = trackRef.current;
    const next = Math.min(slides.length - 1, Math.max(0, to));
    setIndex(next);
    track?.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
  }

  // The track scrolls and snaps on its own — swiping a phone has to work
  // without touching the arrows — so the arrows follow the scroll position
  // rather than owning it.
  function onScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const at = Math.round(track.scrollLeft / track.clientWidth);
    if (at !== index) setIndex(Math.min(slides.length - 1, Math.max(0, at)));
  }

  const current = slides[Math.min(index, slides.length - 1)];

  return (
    // The prose around it spaces itself; a gallery is its own segment and has
    // to hold both sides of the gap open.
    <div data-gallery className="relative my-7">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-[10px] bg-paper-sunken"
      >
        {slides.map((slide, at) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.caption}
            width={slide.width || undefined}
            height={slide.height || undefined}
            loading="lazy"
            onClick={() => onOpen(at)}
            className="h-auto w-full shrink-0 grow-0 basis-full cursor-zoom-in snap-center rounded-[10px]"
          />
        ))}
      </div>

      <Arrow side="left" disabled={index === 0} onClick={() => go(index - 1)} />
      <Arrow
        side="right"
        disabled={index === slides.length - 1}
        onClick={() => go(index + 1)}
      />

      <div className="mt-2 flex gap-1">
        {slides.map((slide, at) => (
          <button
            key={slide.src}
            onClick={() => go(at)}
            aria-label={`Image ${at + 1}`}
            className={`h-[3px] flex-1 rounded-full transition ${
              at === index ? "bg-ink-soft" : "bg-line"
            }`}
          />
        ))}
      </div>

      <p className="mt-2 flex gap-2.5 font-sans text-[13px] leading-[1.5] text-ink-faint">
        <span className="shrink-0 tabular-nums">
          {index + 1}/{slides.length}
        </span>
        <span>{current.caption}</span>
      </p>
    </div>
  );
}

function Arrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous image" : "Next image"}
      // Sits over the track, vertically centred on the picture rather than on
      // the block, which also carries the bar and the caption.
      className={`absolute top-[calc(50%-30px)] flex h-[34px] w-[34px] -translate-y-1/2 items-center justify-center rounded-full border border-line bg-paper text-ink shadow-[0_4px_14px_-6px_rgba(31,30,27,0.4)] transition hover:text-clay disabled:opacity-35 disabled:hover:text-ink ${
        side === "left" ? "left-2.5" : "right-2.5"
      }`}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={side === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}
