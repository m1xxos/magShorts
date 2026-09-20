"use client";

import { useState } from "react";
import { RATES, formatLeft, sortVoices, voiceLang, type SpeechLang } from "@/lib/speech";
import { type SpeechState } from "@/lib/useSpeech";

// The listening controls, written once and drawn twice — in the popover on a
// mouse and in the Sheet on a finger, for the same reason the Aa controls are:
// a change to the speeds must not land in one of them and not the other.

export function ReaderListen({
  speech,
  lang,
}: {
  speech: SpeechState;
  lang: SpeechLang;
}) {
  const [allLanguages, setAllLanguages] = useState(false);

  if (!speech.supported) {
    return (
      <p className="py-1 text-[12.5px] leading-[1.5] text-ink-faint">
        This browser has no voices to read with. Safari, Chrome and Edge do.
      </p>
    );
  }

  const inLanguage = speech.voices.filter((voice) => voiceLang(voice) === lang);
  // Nothing installed for this language: showing an empty list and a toggle
  // would be a puzzle. Show what there is.
  const forced = inLanguage.length === 0;
  const listed = sortVoices(
    allLanguages || forced ? speech.voices : inLanguage,
    lang
  );
  const playing = speech.status === "speaking";
  const started = speech.count > 0 && speech.status !== "idle";
  const position = started ? (speech.index + 1) / speech.count : 0;

  return (
    <>
      <button
        onClick={speech.toggle}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2 text-[13px] text-paper transition hover:brightness-110 pointer-coarse:min-h-13 pointer-coarse:text-[15px]"
      >
        {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
        {playing ? "Pause" : started ? "Resume" : "Listen to the article"}
      </button>

      {started && (
        <>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <Step label="Previous sentence" onClick={() => speech.skip(-1)} back />
            <span className="text-[11.5px] text-ink-faint tabular-nums">
              {speech.index + 1} of {speech.count}
            </span>
            <Step label="Next sentence" onClick={() => speech.skip(1)} />
          </div>
          {/* The same bar the reader draws for scroll position, saying the
              same thing about a different kind of progress. */}
          <div className="mt-2 h-[3px] rounded-full bg-line">
            <div
              className="h-[3px] origin-left rounded-full bg-clay transition-transform"
              style={{ transform: `scaleX(${position})` }}
            />
          </div>
          {speech.secondsLeft !== null && (
            <p className="mt-1.5 text-[11.5px] text-ink-faint">
              {/* Hedged on purpose: it is measured from how fast this voice
                  has actually been speaking, and it moves. */}
              ≈ {formatLeft(speech.secondsLeft)}
            </p>
          )}
        </>
      )}

      <div className="mt-3 mb-2 flex items-baseline justify-between">
        <p className="text-[11px] tracking-[0.12em] text-ink-faint uppercase">
          Voice
        </p>
        {!forced && speech.voices.length > inLanguage.length && (
          <button
            onClick={() => setAllLanguages((shown) => !shown)}
            className="text-[11px] text-ink-faint transition hover:text-ink"
          >
            {allLanguages ? "This language" : "All voices"}
          </button>
        )}
      </div>
      {listed.length === 0 ? (
        <p className="text-[12.5px] leading-[1.5] text-ink-faint">
          No voices are installed yet. Your system’s speech settings can add
          them.
        </p>
      ) : (
        // A list rather than a strip of pills: a Mac offers upwards of twenty
        // voices, and twenty pills is not a row.
        <div
          role="radiogroup"
          aria-label="Voice"
          className="max-h-44 overflow-y-auto rounded-2xl border border-line p-0.5"
        >
          {listed.map((voice) => {
            const chosen = voice.voiceURI === speech.voice?.voiceURI;
            return (
              <button
                key={voice.voiceURI}
                role="radio"
                aria-checked={chosen}
                onClick={() => speech.chooseVoice(voice)}
                className={`flex w-full items-center justify-between gap-2 rounded-full px-3 py-1.5 text-left text-[12.5px] transition pointer-coarse:min-h-12 pointer-coarse:text-[14px] ${
                  chosen
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:bg-paper-sunken hover:text-ink"
                }`}
              >
                <span className="truncate">{voice.name}</span>
                <span
                  className={`shrink-0 text-[10.5px] ${
                    chosen ? "text-paper/60" : "text-ink-faint"
                  }`}
                >
                  {voice.lang.replace("_", "-")}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-3 mb-2 text-[11px] tracking-[0.12em] text-ink-faint uppercase">
        Speed
      </p>
      <div className="flex rounded-full border border-line p-0.5 text-[12px]">
        {RATES.map((rate) => (
          <button
            key={rate}
            onClick={() => speech.chooseRate(rate)}
            aria-pressed={speech.rate === rate}
            className={`flex-1 rounded-full py-1 tabular-nums transition pointer-coarse:min-h-13 ${
              speech.rate === rate
                ? "bg-ink text-paper"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            {rate}×
          </button>
        ))}
      </div>
    </>
  );
}

function Step({
  label,
  onClick,
  back = false,
}: {
  label: string;
  onClick: () => void;
  back?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-clay hover:text-clay pointer-coarse:h-11 pointer-coarse:w-11"
    >
      <SkipIcon size={13} back={back} />
    </button>
  );
}

// Hand-drawn like every other icon here — there is no icon package in this
// project and this feature is not the reason to add one.

export function ListenIcon({ size = 16 }: { size?: number }) {
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
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5l13 7.5-13 7.5z" />
    </svg>
  );
}

function PauseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function SkipIcon({ size = 16, back = false }: { size?: number; back?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={back ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5 5l11 7-11 7z" />
      <rect x="17" y="5" width="2.5" height="14" rx="1" />
    </svg>
  );
}
