// Where an article is cut for a voice to read it.
//
// This is the one part of listening that has no browser in it, and the one
// part where being wrong is silent: a bad break does not throw, it just makes
// the voice say "точка т д" or run a heading into the paragraph under it.
// Neither shows up anywhere except in your ear, which is exactly why they are
// written down here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLanguage,
  estimateSecondsLeft,
  formatLeft,
  nearestRate,
  parseVoiceSetting,
  pickVoice,
  sortVoices,
  splitSentences,
  type VoiceLike,
} from "../src/lib/speech";

// The spans back as strings, which is what the assertions are actually about.
function cut(text: string, breaks: number[] = []): string[] {
  return splitSentences(text, breaks).map((span) =>
    text.slice(span.start, span.end)
  );
}

describe("cutting an article into sentences", () => {
  it("breaks on the ordinary endings", () => {
    assert.deepEqual(cut("Первое. Второе! Третье? Четвёртое."), [
      "Первое.",
      "Второе!",
      "Третье?",
      "Четвёртое.",
    ]);
  });

  it("keeps a title with the name it introduces", () => {
    assert.deepEqual(cut("Дом стоит на ул. Ленина уже сто лет."), [
      "Дом стоит на ул. Ленина уже сто лет.",
    ]);
    assert.deepEqual(cut("It was signed by Dr. Adams last spring."), [
      "It was signed by Dr. Adams last spring.",
    ]);
    assert.deepEqual(cut("Смотрите e.g. Кафку, если сомневаетесь."), [
      "Смотрите e.g. Кафку, если сомневаетесь.",
    ]);
  });

  it("lets an abbreviation that does end a sentence end it", () => {
    // The list used to hold "т.д." and "гг.", and both of them genuinely
    // finish sentences — blocking the break ran two of them together with no
    // pause at all, which is the one thing a listener cannot recover from.
    assert.deepEqual(cut("Книги, тетради и т.д. Потом всё сложили."), [
      "Книги, тетради и т.д.",
      "Потом всё сложили.",
    ]);
    assert.deepEqual(cut("Открыт в 1918 г. Здание снесли позже."), [
      "Открыт в 1918 г.",
      "Здание снесли позже.",
    ]);
  });

  it("tells the two meanings of «г.» apart", () => {
    // After a number it is "год" and the sentence is over; in front of a name
    // it is "город" and it has barely started.
    assert.deepEqual(cut("Он живёт в г. Москва с детства."), [
      "Он живёт в г. Москва с детства.",
    ]);
  });

  it("does not mistake initials for four sentences", () => {
    assert.deepEqual(cut("Памятник А. С. Пушкину стоит здесь."), [
      "Памятник А. С. Пушкину стоит здесь.",
    ]);
    assert.deepEqual(cut("Edited by J. R. R. Tolkien himself."), [
      "Edited by J. R. R. Tolkien himself.",
    ]);
  });

  it("keeps a decimal and a numbered item whole", () => {
    assert.deepEqual(cut("Значение 3.14 округлили."), ["Значение 3.14 округлили."]);
    assert.deepEqual(cut("1. Первый пункт. 2. Второй пункт."), [
      "1. Первый пункт.",
      "2. Второй пункт.",
    ]);
  });

  it("still breaks after a year that ends a sentence", () => {
    // The numbered-list guard only applies at the head of a sentence; here the
    // digits are the end of one.
    assert.deepEqual(cut("Завод построили в 1918. Затем его закрыли."), [
      "Завод построили в 1918.",
      "Затем его закрыли.",
    ]);
  });

  it("treats an ellipsis and a double ending as one ending", () => {
    assert.deepEqual(cut("Он замолчал... Потом продолжил."), [
      "Он замолчал...",
      "Потом продолжил.",
    ]);
    assert.deepEqual(cut("Правда?! Не может быть."), [
      "Правда?!",
      "Не может быть.",
    ]);
  });

  it("keeps a closing quote with the sentence it closes", () => {
    assert.deepEqual(cut("«Мы закончили.» Так он сказал."), [
      "«Мы закончили.»",
      "Так он сказал.",
    ]);
  });

  it("does not break before a lower-case word", () => {
    // A full stop followed by lower case is the middle of a sentence far more
    // often than it is a new one badly typed.
    assert.deepEqual(cut("Версия 2.0 вышла."), ["Версия 2.0 вышла."]);
  });

  it("breaks where a block does, with no punctuation to go on", () => {
    // A heading. Without the block boundary this is one sentence, and the
    // voice reads the title into the first paragraph.
    const text = "Что случилось дальше Ответ оказался простым.";
    assert.deepEqual(cut(text, [20]), [
      "Что случилось дальше",
      "Ответ оказался простым.",
    ]);
  });

  it("splits a paragraph that never ends", () => {
    const text = `${"слово ".repeat(120).trim()}.`;
    const pieces = cut(text);
    assert.ok(pieces.length > 1, "a 700-character run must become several utterances");
    for (const piece of pieces) {
      assert.ok(piece.length <= 300, `too long to speak reliably: ${piece.length}`);
    }
    // Nothing is lost and nothing is invented.
    assert.equal(pieces.join(" "), text);
  });

  it("gives an empty body no turns at all", () => {
    assert.deepEqual(cut(""), []);
    assert.deepEqual(cut("   "), []);
  });
});

describe("which language to ask for", () => {
  it("reads the script, not the alphabet of a few names", () => {
    assert.equal(
      detectLanguage("Компания Apple представила новый MacBook Pro сегодня."),
      "ru"
    );
    assert.equal(detectLanguage("The quick brown fox jumps over the dog."), "en");
  });

  it("answers for text with no letters in it", () => {
    assert.equal(detectLanguage("123 456 — 789"), "en");
    assert.equal(detectLanguage(""), "en");
  });
});

describe("the remembered voice", () => {
  it("survives nothing stored, and survives a hand edit", () => {
    assert.deepEqual(parseVoiceSetting(null), { rate: 1, voices: {} });
    assert.deepEqual(parseVoiceSetting("{oh no"), { rate: 1, voices: {} });
    assert.deepEqual(parseVoiceSetting("null"), { rate: 1, voices: {} });
  });

  it("snaps a speed from an older ramp to one the panel offers", () => {
    assert.equal(parseVoiceSetting('{"rate":1.2}').rate, 1.25);
    assert.equal(parseVoiceSetting('{"rate":1.1}').rate, 1);
    assert.equal(parseVoiceSetting('{"rate":9}').rate, 2);
    assert.equal(parseVoiceSetting('{"rate":"fast"}').rate, 1);
    assert.equal(nearestRate(1.4), 1.5);
  });

  it("keeps one language's voice when the other's is unreadable", () => {
    const setting = parseVoiceSetting(
      '{"rate":1.5,"voices":{"ru":{"uri":"u","name":"Milena"},"en":{"uri":"x"}}}'
    );
    assert.equal(setting.rate, 1.5);
    assert.deepEqual(setting.voices.ru, { uri: "u", name: "Milena" });
    assert.equal(setting.voices.en, undefined);
  });
});

const VOICES: VoiceLike[] = [
  { name: "Milena", lang: "ru-RU", voiceURI: "milena", default: false },
  { name: "Yuri", lang: "ru_RU", voiceURI: "yuri", default: false },
  { name: "Samantha", lang: "en-US", voiceURI: "samantha", default: true },
  { name: "Kyoko", lang: "ja-JP", voiceURI: "kyoko", default: false },
];

describe("choosing a voice", () => {
  it("uses the language of the article when nothing was chosen", () => {
    assert.equal(pickVoice(VOICES, "ru")?.name, "Milena");
    assert.equal(pickVoice(VOICES, "en")?.name, "Samantha");
  });

  it("honours a choice even for an article in another language", () => {
    const chosen = { uri: "milena", name: "Milena" };
    assert.equal(pickVoice(VOICES, "en", chosen)?.name, "Milena");
  });

  it("falls back to the name when an OS update renumbered the voices", () => {
    const chosen = { uri: "com.apple.voice.milena.v9", name: "Milena" };
    assert.equal(pickVoice(VOICES, "ru", chosen)?.name, "Milena");
  });

  it("speaks in something rather than nothing", () => {
    // No Japanese article will ask for this, but a device with only Kyoko on
    // it must still read aloud rather than sit silent.
    assert.equal(pickVoice([VOICES[3]], "ru")?.name, "Kyoko");
    assert.equal(pickVoice([], "ru"), null);
  });

  it("puts the article's language at the top of the list", () => {
    const listed = sortVoices(VOICES, "ru").map((voice) => voice.name);
    assert.deepEqual(listed, ["Milena", "Yuri", "Samantha", "Kyoko"]);
  });
});

describe("how long is left", () => {
  it("prefers what this device actually did to the constant", () => {
    assert.equal(estimateSecondsLeft(1400, 1, null), 100);
    assert.equal(estimateSecondsLeft(1400, 2, null), 50);
    assert.equal(estimateSecondsLeft(1400, 1, 70), 20);
  });

  it("says it in the reader's own words", () => {
    assert.equal(formatLeft(10), "under a minute left");
    assert.equal(formatLeft(200), "3 min left");
    assert.equal(formatLeft(3900), "1 h 5 min left");
  });
});
