// Turning an article into something a voice can say.
//
// Everything here is a pure function of its arguments — no DOM, no
// speechSynthesis, no localStorage — because every one of these decisions is a
// judgement call about language that is worth pinning down in a test rather
// than discovering from a voice reading "т.д." as the end of a paragraph.
// The browser half lives in useSpeech.ts.

export type SpeechLang = "ru" | "en";

// A run of the article, as offsets into the frame's normalised text (see
// buildFrame in anchor.ts). Offsets rather than strings because the same pair
// resolves back into a live Range, which is what paints the sentence being
// spoken.
export interface Span {
  start: number;
  end: number;
}

// The speeds the panel offers. Below 0.75 a voice sounds drugged rather than
// slow, and above 2 the OS voices stop pronouncing word endings.
export const RATES = [0.75, 1, 1.25, 1.5, 2];

// One utterance may not be the whole article. Chrome truncates long ones, and
// a listener who presses skip expects to lose a sentence, not a page.
const MAX_SPOKEN = 300;

const ENDERS = new Set([".", "!", "?", "…"]);
// Punctuation that belongs to the sentence that just ended rather than to the
// one starting: закрывающая кавычка, a closing bracket, the second half of "?!".
const CLOSERS = new Set(['"', "»", "”", "’", "'", ")", "]", "}", "›"]);

// Abbreviations that end in a full stop without ending a sentence.
//
// Far shorter than the first attempt at this list, and deliberately. The rule
// about a lower-case word after the stop already settles nearly every case:
// "в 1918 г. было построено" never breaks, whatever is in here. What is left
// is only the abbreviations followed by a capital — the ones that introduce a
// name — so that is all this holds. Putting "т.д." or "гг." in it was worse
// than leaving them out: both genuinely do end sentences, and blocking a real
// break runs two sentences together with no pause at all.

// Written with dots inside them, so the letter before the final stop says
// nothing on its own and the whole form has to be matched.
const DOTTED = ["e.g.", "i.e.", "и.о.", "т.к."];

const TITLES = new Set([
  // Russian: an address or a person, always followed by the name itself.
  "ул", "просп", "пер", "пл", "наб", "кв", "корп", "им", "тов", "проф",
  "акад", "св", "оз", "пос", "тел",
  // English
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "rev", "gen", "sen",
  "vs", "fig", "vol", "col",
]);

const LETTER = /\p{L}/u;
const WORD = /[\p{L}\p{N}]/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

// A character that is cased and in its lower case. Digits, punctuation and
// «» are none of those, so they read as "a sentence could start here".
function isLower(char: string): boolean {
  return char !== char.toUpperCase() && char === char.toLowerCase();
}

// Which language to ask for, decided from the text itself.
//
// There is no language column on `articles`, and adding one would mean a
// migration to store a guess. The text is the only honest source, and the
// worst a wrong answer can do is offer the wrong default voice — which is one
// tap to correct, and remembered afterwards.
export function detectLanguage(text: string): SpeechLang {
  // The opening is enough. A Russian article quoting three English paragraphs
  // is still a Russian article, and counting all 60,000 characters to learn
  // that costs a frame.
  const sample = text.slice(0, 4000);
  let letters = 0;
  let cyrillic = 0;
  for (const char of sample) {
    if (!LETTER.test(char)) continue;
    letters++;
    if (CYRILLIC.test(char)) cyrillic++;
  }
  if (letters === 0) return "en";
  // Not half: a Russian piece is full of Latin names, product names and
  // quoted English, and none of that makes it English.
  return cyrillic / letters > 0.2 ? "ru" : "en";
}

// Is this full stop part of a word rather than the end of a sentence?
function abbreviates(text: string, dot: number, sentenceStart: number): boolean {
  // Only the full stop is ambiguous. Nothing abbreviates with "!" or "?".
  if (text[dot] !== ".") return false;
  const tail = text.slice(Math.max(0, dot - 5), dot + 1).toLowerCase();
  if (DOTTED.some((form) => tail.endsWith(form))) return true;

  let from = dot;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  const token = text.slice(from, dot);
  if (!token) return false;
  // An initial: "А. С. Пушкин", "J. R. R. Tolkien". A single capital letter
  // followed by a stop is never a sentence, because no sentence is one letter.
  if (token.length === 1 && LETTER.test(token) && !isLower(token)) return true;
  // A numbered list item — "1. Первый пункт." — but only at the head of what
  // we are already treating as a sentence, so "…в 1918. Затем" still breaks.
  if (/^\d{1,3}$/.test(token) && from === sentenceStart) return true;

  const lower = token.toLowerCase();
  // "г." is two different words. After a number it is "год" and the sentence
  // is over; in front of a name it is "город" and the sentence has barely
  // started. The digit is the only thing that tells them apart.
  if (lower === "г") return !/\d/.test(text[from - 2] ?? "");
  return TITLES.has(lower);
}

// Add a span, trimmed, skipping what is not worth speaking.
function push(spans: Span[], text: string, from: number, to: number): void {
  let start = from;
  let end = to;
  while (start < end && text[start] === " ") start++;
  while (end > start && text[end - 1] === " ") end--;
  if (end <= start) return;
  // A fragment with no word in it — a stray bracket a break left behind —
  // belongs to the sentence before it rather than getting a turn of its own.
  if (spans.length > 0 && !WORD.test(text.slice(start, end))) {
    spans[spans.length - 1].end = end;
    return;
  }
  spans.push({ start, end });
}

// Somewhere to break a sentence that has no ending, looking backwards from the
// cap so the piece still lands on a phrase rather than mid-word.
const FALLBACK_BREAKS = [", ", "; ", ": ", " — ", " "];

function capLength(spans: Span[], text: string): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    let start = span.start;
    while (span.end - start > MAX_SPOKEN) {
      const limit = start + MAX_SPOKEN;
      let cut = -1;
      for (const mark of FALLBACK_BREAKS) {
        const at = text.lastIndexOf(mark, limit);
        // A break in the first third would leave a scrap, which is worse than
        // a long piece; try a weaker separator instead.
        if (at > start + MAX_SPOKEN / 3) {
          cut = at + mark.length;
          break;
        }
      }
      // A single unbroken run of 300 characters. Cut it anyway — a voice that
      // stops speaking is worse than one that breathes in the wrong place.
      if (cut < 0) cut = limit;
      push(out, text, start, cut);
      start = cut;
    }
    push(out, text, start, span.end);
  }
  return out;
}

// Cut the article into the pieces a voice will speak one at a time.
//
// `breaks` are block boundaries — where one paragraph, heading or list item
// ends and the next begins. They have to come from the caller because the
// frame's text is one collapsed run with no paragraphs in it, and without them
// a heading with no full stop runs straight into the paragraph underneath.
export function splitSentences(text: string, breaks: number[] = []): Span[] {
  const hard = new Set(breaks.filter((at) => at > 0 && at < text.length));
  const spans: Span[] = [];
  let start = 0;

  for (let at = 0; at < text.length; at++) {
    if (hard.has(at) && at > start) {
      push(spans, text, start, at);
      start = at;
    }
    if (!ENDERS.has(text[at])) continue;

    // "..." and "?!" end one sentence, not three.
    let end = at + 1;
    while (end < text.length && (ENDERS.has(text[end]) || CLOSERS.has(text[end]))) {
      end++;
    }
    if (end >= text.length) break;
    // No space after it: "3.14", "т.д.", a URL. Not a sentence boundary.
    if (text[end] !== " ") continue;
    const next = end + 1;
    if (next >= text.length) break;
    // A lower-case word after a full stop is the rest of the same sentence far
    // more often than it is a new one badly typed.
    if (isLower(text[next])) continue;
    if (abbreviates(text, at, start)) continue;

    push(spans, text, start, end);
    start = next;
    at = next - 1;
  }
  push(spans, text, start, text.length);

  return capLength(spans, text);
}

// A voice, remembered. The URI identifies it exactly; the name is what to fall
// back on when an OS update renumbers them, and the only one of the two a
// person would recognise.
export interface VoiceRef {
  uri: string;
  name: string;
}

export interface VoiceSetting {
  rate: number;
  // Per language, because one remembered voice means a Russian article read in
  // an English one the first time the reader opens anything from Habr.
  voices: Partial<Record<SpeechLang, VoiceRef>>;
}

export const DEFAULT_VOICE_SETTING: VoiceSetting = { rate: 1, voices: {} };

export function nearestRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return RATES.reduce((best, rate) =>
    Math.abs(rate - value) < Math.abs(best - value) ? rate : best
  );
}

function asVoiceRef(value: unknown): VoiceRef | undefined {
  const ref = value as Partial<VoiceRef> | null;
  if (!ref || typeof ref.name !== "string" || !ref.name) return undefined;
  return { uri: typeof ref.uri === "string" ? ref.uri : "", name: ref.name };
}

// Read what was stored, field by field.
//
// The same defensiveness the Aa control already practises: a setting written
// by a build that offered different speeds, or half-written by a hand edit,
// should cost its owner one wrong default rather than a thrown exception on
// the way into the reader.
export function parseVoiceSetting(raw: string | null): VoiceSetting {
  if (!raw) return DEFAULT_VOICE_SETTING;
  let parsed: Partial<VoiceSetting>;
  try {
    parsed = JSON.parse(raw) as Partial<VoiceSetting>;
  } catch {
    return DEFAULT_VOICE_SETTING;
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_VOICE_SETTING;
  const voices: VoiceSetting["voices"] = {};
  const stored = (parsed.voices ?? {}) as Record<string, unknown>;
  for (const lang of ["ru", "en"] as const) {
    const ref = asVoiceRef(stored[lang]);
    if (ref) voices[lang] = ref;
  }
  // Snapped rather than clamped: a speed stored against an older ramp should
  // still light up a button, or the panel shows a setting nobody chose.
  return { rate: nearestRate(parsed.rate), voices };
}

// As much of a SpeechSynthesisVoice as any of this needs, so the choosing can
// be tested without a browser to produce real ones.
export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
}

export function voiceLang(voice: VoiceLike): SpeechLang | "other" {
  const tag = voice.lang.toLowerCase();
  if (tag.startsWith("ru")) return "ru";
  if (tag.startsWith("en")) return "en";
  return "other";
}

// Which voice to speak this article in.
//
// The ladder matters. A voice the reader chose outranks everything, even for
// an article in another language — they asked for it. Only when nothing was
// chosen, or what was chosen is gone, does the language of the text decide.
export function pickVoice<T extends VoiceLike>(
  voices: T[],
  lang: SpeechLang,
  remembered?: VoiceRef
): T | null {
  if (voices.length === 0) return null;
  if (remembered) {
    const exact = voices.find((voice) => voice.voiceURI === remembered.uri);
    if (exact) return exact;
    // An OS update rewrote the URIs. The name is what survived.
    const named = voices.find((voice) => voice.name === remembered.name);
    if (named) return named;
  }
  const speaking = voices.filter((voice) => voiceLang(voice) === lang);
  const pool = speaking.length > 0 ? speaking : voices;
  return pool.find((voice) => voice.default) ?? pool[0];
}

// The list the panel draws: the article's language first, each group by name,
// so the voice you are most likely to want is the one you do not scroll to.
export function sortVoices<T extends VoiceLike>(voices: T[], lang: SpeechLang): T[] {
  const rank = (voice: T) => {
    const of = voiceLang(voice);
    return of === lang ? 0 : of === "other" ? 2 : 1;
  };
  return [...voices].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  );
}

// How long is left, in seconds.
//
// The constant is only the opening guess: `measured` is characters per second
// actually observed on this device with this voice at this speed, and it takes
// over as soon as there is any, because no constant survives the difference
// between a compact OS voice and a network one.
export const BASE_CHARS_PER_SECOND = 14;

export function estimateSecondsLeft(
  charsLeft: number,
  rate: number,
  measured: number | null
): number {
  const perSecond =
    measured && measured > 0 ? measured : BASE_CHARS_PER_SECOND * rate;
  return Math.max(0, Math.round(charsLeft / perSecond));
}

// Said the way the reader already says reading time, so "4 min left" under the
// article and "≈ 4 min left" in the panel are the same sentence.
export function formatLeft(seconds: number): string {
  if (seconds < 45) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}
