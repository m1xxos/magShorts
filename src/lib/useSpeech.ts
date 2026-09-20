"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Frame } from "./anchor";
import {
  DEFAULT_VOICE_SETTING,
  estimateSecondsLeft,
  parseVoiceSetting,
  pickVoice,
  type SpeechLang,
  type Span,
  type VoiceSetting,
} from "./speech";

// Reading the article out loud.
//
// The queue is one utterance per sentence rather than one for the whole
// article, which is what makes ⏮ and ⏭ mean anything, keeps Chrome from
// truncating a long body, and gives the reader a position to paint. This hook
// owns the engine and the remembered settings; it knows nothing about where
// the controls are drawn or what the sentence being spoken looks like.

export const VOICE_KEY = "ms_reader_voice";

// What the engine is asked to say, and where it came from. `span` is null for
// the headline and the standfirst: they are React's text, not the body's, so
// there is no frame offset to paint.
export interface SpeechSentence {
  text: string;
  span: Span | null;
}

export type SpeechStatus = "idle" | "speaking" | "paused";

// Elements that end a sentence by existing. The frame collapses the whole body
// to one run of text with single spaces, so without these a heading with no
// full stop after it is read straight into the paragraph underneath.
const BLOCKS =
  "p, h1, h2, h3, h4, h5, h6, li, blockquote, figure, figcaption, pre, tr, td, th, dd, dt, div";

// Where one block ends and the next begins, as offsets into the frame's text.
export function blockBreaks(frame: Frame): number[] {
  const breaks: number[] = [];
  let previous: Element | null = null;
  let node = -1;
  for (let at = 0; at < frame.nodeIndex.length; at++) {
    // Offsets are in document order, so the node index only ever moves
    // forward: this recomputes once per text node, not once per character.
    if (frame.nodeIndex[at] === node) continue;
    node = frame.nodeIndex[at];
    const block = frame.nodes[node]?.parentElement?.closest(BLOCKS) ?? null;
    if (previous && block !== previous) breaks.push(at);
    previous = block;
  }
  return breaks;
}

export interface SpeechState {
  supported: boolean;
  status: SpeechStatus;
  index: number;
  count: number;
  secondsLeft: number | null;
  voices: SpeechSynthesisVoice[];
  voice: SpeechSynthesisVoice | null;
  rate: number;
  play: () => void;
  toggle: () => void;
  stop: () => void;
  skip: (by: number) => void;
  chooseVoice: (voice: SpeechSynthesisVoice) => void;
  chooseRate: (rate: number) => void;
}

export function useSpeech({
  source,
  build,
  lang,
  onSentence,
}: {
  // What the queue was cut from. Changing it throws the queue away.
  //
  // Two ways it used to go stale. Pressing Listen while the body was still
  // loading built a queue of the headline and the deck alone — length two, not
  // zero, so the "already built" guard held and every later press read the
  // same two lines and never the article. And Retry re-extracts into a new
  // body without changing the article, which left the voice reading the old
  // extraction's sentences and painting its offsets onto the new text.
  source: string;
  // Called once, the first time play is pressed. Lazy because it walks the
  // whole body, and an article nobody listens to should pay nothing for this.
  build: () => SpeechSentence[];
  lang: SpeechLang;
  // Where the voice has got to, or null when it has stopped.
  onSentence: (sentence: SpeechSentence | null, index: number) => void;
}): SpeechState {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [setting, setSetting] = useState<VoiceSetting>(DEFAULT_VOICE_SETTING);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const queue = useRef<SpeechSentence[]>([]);
  const cursor = useRef(0);
  // Bumped by everything that cancels. An utterance that was cancelled still
  // fires onend in most engines, and without this that stale handler walks the
  // queue forward under whatever is speaking now.
  const run = useRef(0);
  const statusRef = useRef<SpeechStatus>("idle");
  const rateRef = useRef(1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const langRef = useRef<SpeechLang>(lang);
  const onSentenceRef = useRef(onSentence);
  const buildRef = useRef(build);
  // Characters actually spoken and the seconds they took, so the estimate
  // stops being a constant as soon as this device has proved otherwise.
  const spoken = useRef({ chars: 0, seconds: 0 });
  const startedAt = useRef(0);
  // Whether the utterance being spoken has been paused. Its elapsed time is no
  // longer how long it took to say, so it is not a sample of anything.
  const pausedDuring = useRef(false);
  // How the queue moves on. Held in a ref because the handler that advances it
  // is attached to an utterance and outlives the render that created it, so it
  // cannot call the version of speakAt it closed over.
  const speakAtRef = useRef<(at: number) => void>(() => {});

  useEffect(() => {
    onSentenceRef.current = onSentence;
    buildRef.current = build;
    langRef.current = lang;
  }, [onSentence, build, lang]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser capability, unknowable until after hydration
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  useEffect(() => {
    if (!supported) return;
    // getVoices() is empty on the first call in Chrome and on iOS — the list
    // arrives later, and a panel that read it once shows no voices at all.
    const read = () => setVoices(window.speechSynthesis.getVoices());
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, [supported]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage once after hydration, as the Aa control does
    setSetting(parseVoiceSetting(window.localStorage.getItem(VOICE_KEY)));
  }, []);

  const voice = pickVoice(voices, lang, setting.voices[lang]);

  // The utterances are built inside engine callbacks that were created several
  // renders ago, so what they need has to be somewhere they can read now
  // rather than in the props of the render that made them.
  useEffect(() => {
    rateRef.current = setting.rate;
    voiceRef.current = voice;
  }, [setting.rate, voice]);

  const charsLeft = useCallback(() => {
    return queue.current
      .slice(cursor.current)
      .reduce((total, sentence) => total + sentence.text.length, 0);
  }, []);

  const measured = () =>
    spoken.current.seconds > 4 ? spoken.current.chars / spoken.current.seconds : null;

  const halt = useCallback(() => {
    run.current++;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Resume first: cancelling while paused leaves some engines stuck paused,
    // and then nothing this hook says afterwards is ever spoken.
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
  }, []);

  const speakAt = useCallback(
    (at: number) => {
      const list = queue.current;
      if (at < 0) at = 0;
      if (at >= list.length) {
        // Back to the top rather than parked past the end, or pressing play
        // again on a finished article does nothing at all.
        statusRef.current = "idle";
        setStatus("idle");
        setSecondsLeft(null);
        cursor.current = 0;
        setIndex(0);
        onSentenceRef.current(null, 0);
        return;
      }
      const token = run.current;
      cursor.current = at;
      setIndex(at);
      setSecondsLeft(estimateSecondsLeft(charsLeft(), rateRef.current, measured()));
      onSentenceRef.current(list[at], at);

      const utterance = new SpeechSynthesisUtterance(list[at].text);
      utterance.rate = rateRef.current;
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang =
        voiceRef.current?.lang ?? (langRef.current === "ru" ? "ru-RU" : "en-US");
      utterance.onstart = () => {
        startedAt.current = Date.now();
        pausedDuring.current = false;
      };
      utterance.onend = () => {
        if (token !== run.current) return;
        const seconds = (Date.now() - startedAt.current) / 1000;
        // Not `if (seconds > 0.3)` alone: a sentence paused for three minutes
        // would enter the average as three minutes of speech, and since a
        // measured rate outranks the constant, the panel would then promise
        // hours for the rest of the article and never climb back.
        if (seconds > 0.3 && !pausedDuring.current) {
          spoken.current.chars += list[at].text.length;
          spoken.current.seconds += seconds;
        }
        speakAtRef.current(at + 1);
      };
      utterance.onerror = (event) => {
        // Our own cancel, reported as an error. Not something to step over.
        if (event.error === "interrupted" || event.error === "canceled") return;
        if (token !== run.current) return;
        // A voice that cannot say this sentence must not stop the article.
        speakAtRef.current(at + 1);
      };
      window.speechSynthesis.speak(utterance);
      statusRef.current = "speaking";
      setStatus("speaking");
    },
    [charsLeft]
  );
  useEffect(() => {
    speakAtRef.current = speakAt;
  }, [speakAt]);

  // Cancel, then speak on a fresh task.
  //
  // Not cosmetic: on iOS a speak() issued in the same turn as a cancel() is
  // dropped silently, and the reader gets a control that does nothing.
  const restart = useCallback(
    (at: number) => {
      halt();
      const token = run.current;
      window.setTimeout(() => {
        if (token === run.current) speakAt(at);
      }, 0);
    },
    [halt, speakAt]
  );

  // Stop, and forget what was being read. The reader calls this when it
  // swaps articles, so the queue has to go with it — otherwise the next
  // article is read out in the words of the last one.
  const stop = useCallback(() => {
    halt();
    statusRef.current = "idle";
    setStatus("idle");
    setSecondsLeft(null);
    queue.current = [];
    cursor.current = 0;
    setCount(0);
    setIndex(0);
    onSentenceRef.current(null, 0);
  }, [halt]);

  const play = useCallback(() => {
    if (!supported) return;
    if (queue.current.length === 0) {
      queue.current = buildRef.current();
      setCount(queue.current.length);
      spoken.current = { chars: 0, seconds: 0 };
    }
    if (queue.current.length === 0) return;
    restart(cursor.current);
  }, [restart, supported]);

  const toggle = useCallback(() => {
    if (statusRef.current === "speaking") {
      pausedDuring.current = true;
      window.speechSynthesis.pause();
      statusRef.current = "paused";
      setStatus("paused");
      return;
    }
    if (statusRef.current === "paused") {
      window.speechSynthesis.resume();
      statusRef.current = "speaking";
      setStatus("speaking");
      return;
    }
    play();
  }, [play]);

  const skip = useCallback(
    (by: number) => {
      if (queue.current.length === 0) return play();
      restart(Math.min(queue.current.length - 1, Math.max(0, cursor.current + by)));
    },
    [play, restart]
  );

  const write = useCallback((next: VoiceSetting) => {
    setSetting(next);
    window.localStorage.setItem(VOICE_KEY, JSON.stringify(next));
  }, []);

  // A new voice or speed takes the sentence being spoken from the top.
  //
  // The alternative is to wait for the next one, which on a long paragraph is
  // fifteen seconds of a control that looks broken. Repeating one sentence is
  // the cheaper surprise, and it is the only way the change can be heard.
  //
  // Only while it is actually speaking, though. Paused counted as "not idle"
  // once, so setting 1.5× for later — the ordinary reason to open this panel
  // while paused — started the article playing out loud.
  const restartIfSpeaking = useCallback(() => {
    if (statusRef.current !== "speaking") return;
    restart(cursor.current);
  }, [restart]);

  const chooseVoice = useCallback(
    (next: SpeechSynthesisVoice) => {
      voiceRef.current = next;
      write({
        ...setting,
        voices: {
          ...setting.voices,
          [lang]: { uri: next.voiceURI, name: next.name },
        },
      });
      // What this device does at this speed with the old voice says nothing
      // about the new one.
      spoken.current = { chars: 0, seconds: 0 };
      restartIfSpeaking();
    },
    [lang, restartIfSpeaking, setting, write]
  );

  const chooseRate = useCallback(
    (rate: number) => {
      rateRef.current = rate;
      write({ ...setting, rate });
      spoken.current = { chars: 0, seconds: 0 };
      restartIfSpeaking();
    },
    [restartIfSpeaking, setting, write]
  );

  // A different body than the queue was cut from: forget it, and fall silent.
  // Placed after stop() so it can use it, and keyed on nothing else — the
  // reader changes `build` on every render and this must not fire on that.
  useEffect(() => {
    return () => {
      stop();
    };
  }, [source, stop]);

  // Chrome stops speaking of its own accord partway through a long utterance
  // and reports itself paused. Only ever resumed when this hook believes it is
  // speaking, so it can never undo a pause the reader asked for.
  useEffect(() => {
    if (status !== "speaking") return;
    const timer = window.setInterval(() => {
      if (statusRef.current === "speaking" && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status]);

  // Leaving the page does not stop the engine — it carries on talking over
  // whatever you opened next.
  //
  // Through stop(), not a bare cancel(). cancel() fires `end` on the utterance
  // it cancels, and that handler is still holding a token the raw call never
  // invalidated — so it passed the guard and spoke the next sentence, which is
  // the exact thing this effect exists to prevent.
  useEffect(() => {
    if (!supported) return;
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [supported, stop]);

  return {
    supported,
    status,
    index,
    count,
    secondsLeft,
    voices,
    voice,
    rate: setting.rate,
    play,
    toggle,
    stop,
    skip,
    chooseVoice,
    chooseRate,
  };
}
