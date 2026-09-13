// What the city digest refuses to show, and what it leans towards.
//
// A local paper is a general paper: the same three publications that report a
// new park also report a stabbing at a metro station, a fire, a court case and
// the war. Measured over two days of Санкт-Петербург — 300 articles from
// Фонтанка, Деловой Петербург and Телеканал Санкт-Петербург — about a third
// were of that kind.
//
// Deliberately not a setting. It is not a preference to be tuned, it is what
// this digest is for: what is happening in the city that is worth knowing
// about or going to. Anyone who wants the incidents has the publications
// themselves, one click away on every card.
//
// Matched on the title and the summary, which is all that exists for every
// article — bodies are fetched for the few that get opened.

// Words rather than a model, for the reason the rest of this app prefers
// measurement to cleverness: this runs over every candidate, including the
// ones behind "Show all N", and a model pass over several hundred titles is
// three more calls per digest for a job that a list of stems does at the cost
// of nothing. The rerank prompt is the second line of defence over the cards
// that are actually laid out.
//
// Tuned against that same corpus. The first draft caught 76 of 300 and let
// through a stabbing at Проспект Просвещения, a theft from a restaurant and
// every Kremlin story about Ukraine; this one catches 98 and the 200 that
// remain read as a city rather than a police log.
const GRIM_PATTERNS = [
  // The war, and the politics that is the war by another name.
  "дрон", "бпла", "беспилотн", "обстрел", "ракет", "\\bвсу\\b", "\\bсво\\b",
  "войн", "фронт", "мобилизац", "боев\\w* действ", "теракт", "минирован",
  "\\bпво\\b", "украин", "кремл", "песков", "зеленск", "военн", "оборонн",
  "спецоперац", "взрыв", "снаряд", "атак\\w* на ",
  // Violence and death.
  "уби\\w*", "зареза", "застрел", "изнасил", "насили", "ножом", "ножа\\b",
  "погиб", "смерт", "труп", "жертв", "скончал", "умер", "похорон",
  "избил", "нападени", "напал", "перцовк", "драк", "конфликт",
  // Accidents and disasters.
  "\\bдтп\\b", "авари[яию]", "сбил[аи]?\\b", "наезд", "столкнов", "столкнул",
  "пожар", "сгорел", "загорел", "утонул", "выпал из", "упал с ",
  "отравил", "эвакуирова",
  // Crime, police and the courts.
  "приговор", "уголовн", "арест", "мошенн", "краж",
  "укра[дл]", "похит", "ограб", "следственн", "\\bск\\b", "прокурат",
  // Only the arrest senses. "задерж" on its own, or "задержив", also catches
  // "десятки рейсов задерживаются в Пулково" — a delayed flight is ordinary
  // city news and the reader asked to lose the police log, not the airport.
  "задержан", "задержал",
  "полиц", "суд\\w* (признал|приговорил)", "обвиня",
  // The same in English, for a city whose press is not Russian.
  "killed", "murder", "stabb", "shoot", "shot dead", "\\bwar\\b", "missile",
  "drone strike", "casualt", "wounded", "crash", "collision", "arrested",
  "sentenced", "assault", "\\bfire\\b", "explosion",
];

// JavaScript's \b is ASCII-only — \w is [A-Za-z0-9_], so /\bдтп\b/ never
// matches "после ДТП с автобусом" and the whole pattern silently does nothing.
// Two stories about a bus crash reached a digest that had just been told to
// leave crashes out, and the prototype of this list did not catch it because
// Python's \b *is* Unicode-aware. Cyrillic edges are written out instead.
const CYRILLIC_EDGE = /\\b/g;
function unicodeBoundaries(pattern: string): string {
  return pattern.includes("\\b") && /[а-яё]/i.test(pattern)
    ? pattern
        .replace(/^\\b/, "(?<![а-яё])")
        .replace(/\\b$/, "(?![а-яё])")
        .replace(CYRILLIC_EDGE, "")
    : pattern;
}

const GRIM = new RegExp(GRIM_PATTERNS.map(unicodeBoundaries).join("|"), "i");

export function isGrim(title: string, summary: string | null): boolean {
  return GRIM.test(`${title} ${summary ?? ""}`);
}

// The other half of the ask: things happening in the city, which a general
// news ranking buries because one concert is never carried by three papers at
// once and so never earns the corroboration a road closure does. A nudge, not
// a filter — a story does not have to be an event to lead.
const EVENT_PATTERNS = [
  "выставк", "концерт", "фестивал", "спектакл", "премьер", "экскурс",
  "открыл", "откро[ею]тся", "откры(тие|лся)", "пройд[её]т", "проход[яи]т",
  "маркет", "ярмарк", "парад", "карнавал", "шествие", "забег", "марафон",
  "турнир", "чемпионат", "матч", "лекци", "мастер-класс", "показ",
  "запустил", "заработал", "благоустрой", "отреставрир", "нов[ыа][йя] парк",
  "festival", "exhibition", "concert", "opens", "opening", "will be held",
];

const EVENT = new RegExp(EVENT_PATTERNS.join("|"), "i");

export function isEvent(title: string, summary: string | null): boolean {
  return EVENT.test(`${title} ${summary ?? ""}`);
}
