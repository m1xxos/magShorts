// Finding the local press of one city.
//
// The same three gates as the Discover catalog — it must resolve to a real
// feed, it must be new, it must belong — over the same verification code. What
// cannot be shared is the asking. The catalog's prompt tells the model to
// avoid "general news wires" and its vet rejects "a general daily newspaper",
// which is exactly what a city paper is.
//
// This is the one part of magShorts with no path at all without a language
// model: there is no way to work out the papers of a city from a database of
// technology feeds. The manual door in /api/city/sources is the answer for a
// reader with no model configured, and for the towns no model has heard of.

import { getDb } from "./db";
import { complete, llmConfigured, llmProviders } from "./llm";
import { addAll, warmUp, type CatalogAddition } from "./catalogSuggest";
import { currentCity, getSetting } from "./settings";

// Enough to fill a morning without turning the reader's database into a wire
// service. Most cities will not reach it.
const MAX_CITY_SOURCES = 12;

// How many headlines the vet is shown per publication.
//
// The catalog shows three, which is plenty when the question is "is this a
// technology magazine". It is not enough here, and the first real run proved
// it: Fontanka is the biggest paper in Санкт-Петербург, and its three newest
// headlines were the Kremlin, a Zenit match and Trump on the Falklands. The
// first city story was fourth. Judged on three, the vet correctly read a
// national front page and deleted the one publication that mattered most.
const VET_HEADLINES = 10;

const SUGGEST_SYSTEM = `You name the local news publications of one city — the papers, sites and broadcasters someone living there reads to find out what happened where they live.

Local means the publication's own subject is that city and the area around it: its council, its courts, its transport, its building sites, its schools, its weather, its football club. A national title with a bureau in the city is not local news, it is a national title. Neither is the city section of a national site, a listings or classifieds site, an official administration's press-release page, or a broadcaster with no website of its own.

Answer in the language that city's press actually publishes in, and name each publication the way its own readers name it. Give the home page of the publication itself: not a section, not a feed URL, not an article.

Accuracy over quantity. If you are not certain a publication exists under that exact domain, leave it out. Four real ones are worth more than twelve you are guessing at, and a city with only two is an ordinary answer, not a failure.

Answer with one publication per line, as \`Name | https://homepage\`, and nothing else: no numbering, no commentary, no markdown.`;

const VET_SYSTEM = `You are checking a list of publications said to be the local press of one city. Each numbered publication comes with its most recent headlines. Judge from those headlines, not from the name.

You are judging the publication, not each headline. Every city paper carries national and international news alongside local news — a front page of politics, sport and world events with a few city stories among them is an ordinary city paper, not a national title. A publication belongs if some of its headlines are plainly about this city or the area around it: its council, its courts, its streets, its transport, its schools, its businesses, its sports clubs, the people who live there.

It does not belong if none of the headlines are about this city, if they are all about a different city, if it is an administration publishing its own press releases, if it is classifieds, listings or advertising, or if it is a section of a national site rather than a publication in its own right.

Answer with the numbers that do NOT belong, comma-separated, and nothing else. Answer \`none\` if they all belong. Do not explain.`;

// `Name | https://home.page`, the same line format the catalog's suggestions
// use and the same tolerance for a model that numbers or bullets its answer.
function parseSuggestions(text: string): Array<{ name: string; url: string }> {
  const found: Array<{ name: string; url: string }> = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*[-*\d.)\s]*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/);
    if (match) found.push({ name: match[1].trim(), url: match[2].trim() });
  }
  return found;
}

export interface CityDiscovery {
  city: string;
  /** null when no model is configured — the reason nothing was tried. */
  additions: CatalogAddition[] | null;
  added: number;
  unreachable: number;
  mismatch: number;
  duplicate: number;
}

function summarise(city: string, additions: CatalogAddition[]): CityDiscovery {
  const count = (status: CatalogAddition["status"]) =>
    additions.filter((entry) => entry.status === status).length;
  return {
    city,
    additions,
    added: count("added"),
    unreachable: count("unreachable"),
    mismatch: count("mismatch"),
    duplicate: count("duplicate"),
  };
}

// The publications already found for this city, so a second run asks for more
// rather than for the same four. Deliberately not the catalog's list of every
// publication in the app: that is two hundred titles of pure token cost, and
// de-duplicating is knownHosts()'s job inside addAll anyway.
function alreadyFound(city: string): string[] {
  return (
    getDb()
      .prepare("SELECT title FROM feeds WHERE city = ? ORDER BY id")
      .all(city) as Array<{ title: string }>
  ).map((row) => row.title);
}

// Once a day, so a city that had three publications on the day it was named
// can grow. The stamp is written before the run, not after: a run that throws
// waits for tomorrow rather than retrying on every tick for the rest of the
// day. Same shape as the catalog's own autofill, and behind it in the tick for
// the same reason — its failure costs nothing.
const DISCOVER_EVERY_MS = 24 * 60 * 60 * 1000;
const DISCOVERED_AT = "city_discovered_at";
let running = false;

export async function maybeDiscoverCitySources(): Promise<void> {
  if (running || !currentCity() || !llmConfigured()) return;

  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(DISCOVERED_AT) as { value: string } | undefined;
  const last = row ? Number(row.value) : 0;
  if (Date.now() - last < DISCOVER_EVERY_MS) return;
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(DISCOVERED_AT, String(Date.now()));

  running = true;
  try {
    await discoverCitySources();
  } catch (error) {
    console.error("[city] daily discovery failed:", error);
  } finally {
    running = false;
  }
}

// A city that changes is a reader who moved, or one who mistyped. Either way
// the old city's publications are switched off rather than deleted: they stop
// refreshing every fifteen minutes for a digest nothing reads, and they are
// still there to be turned back on by correcting the spelling, or removed by
// hand. Deleting a publication and its archive because a settings field was
// edited is not something a settings field should do.
export function switchCity(previous: string, next: string): void {
  if (previous === next) return;
  const db = getDb();
  if (previous) {
    const off = db
      .prepare("UPDATE feeds SET enabled = 0 WHERE city = ? AND enabled = 1")
      .run(previous);
    if (off.changes > 0) {
      console.log(
        `[city] switched off ${off.changes} publication(s) from ${previous}`
      );
    }
  }
  if (next) {
    db.prepare("UPDATE feeds SET enabled = 1 WHERE city = ? AND enabled = 0").run(
      next
    );
    // A new city is discovered on demand, so let the daily run happen too.
    db.prepare("DELETE FROM settings WHERE key = ?").run(DISCOVERED_AT);
  }
}

export async function discoverCitySources(): Promise<CityDiscovery> {
  const city = currentCity();
  const spelling = getSetting("city").trim();
  if (!city) return summarise("", []);
  if (!llmConfigured()) {
    return { ...summarise(spelling, []), additions: null };
  }

  const already = alreadyFound(city);
  const answer = await complete(
    SUGGEST_SYSTEM,
    `City: ${spelling}\n\n` +
      `Name up to ${MAX_CITY_SOURCES} news publications based in this city ` +
      `and covering it: the city's own newspaper, the local broadcaster's ` +
      `news site, and the online-only city outlets.` +
      (already.length > 0
        ? `\n\nAlready found (do not repeat these):\n${already.join(", ")}`
        : ""),
    600,
    llmProviders()
  );
  if (!answer) return { ...summarise(spelling, []), additions: null };

  const candidates = parseSuggestions(answer.text).slice(0, MAX_CITY_SOURCES);
  if (candidates.length === 0) {
    console.warn(
      `[city] ${answer.model} answered with no usable publication lines`
    );
    return summarise(spelling, []);
  }

  const additions = await addAll(candidates, new Set(), city);
  await warmUp(additions);
  await vet(spelling, additions);

  console.log(
    `[city] ${spelling}: ${candidates.length} named, ` +
      `${additions.filter((a) => a.status === "added").length} added, ` +
      `${additions.filter((a) => a.status === "unreachable").length} did not resolve, ` +
      `${additions.filter((a) => a.status === "mismatch").length} not about the city`
  );
  return summarise(spelling, additions);
}

// The third gate. Load-bearing in a way it is not for the catalog: a made-up
// magazine domain usually does not exist, but a made-up *local* domain often
// does — parked, squatted, or a real business with a WordPress blog — and
// sniffFeed will accept its /feed happily. Nothing else catches a real, live
// site for the wrong place.
async function vet(city: string, additions: CatalogAddition[]): Promise<void> {
  const added = additions.filter((entry) => entry.status === "added");
  if (added.length === 0) return;

  const db = getDb();
  const candidates = added.map((entry) => {
    const feed = db
      .prepare("SELECT id, title FROM feeds WHERE url = ?")
      .get(entry.feedUrl!) as { id: number; title: string } | undefined;
    const headlines = feed
      ? (
          db
            .prepare(
              "SELECT title FROM articles WHERE feed_id = ? ORDER BY published_at DESC LIMIT ?"
            )
            .all(feed.id, VET_HEADLINES) as Array<{ title: string }>
        ).map((row) => row.title)
      : [];
    return { entry, feed, headlines };
  });

  // A publication whose articles have not arrived yet is not evidence of
  // anything. warmUp swallows its own failures, so without this a feed that
  // was merely slow would be shown to the model as a publication that has
  // never published, and deleted for it. It keeps its place and is judged on
  // the next run, when it has headlines.
  const shown = candidates.filter((row) => row.headlines.length > 0);
  if (shown.length === 0) return;

  const listing = shown
    .map(
      ({ entry, feed, headlines }, index) =>
        `${index + 1}. ${feed?.title ?? entry.name}\n` +
        headlines.map((line) => `   - ${line}`).join("\n")
    )
    .join("\n");

  const result = await complete(
    VET_SYSTEM,
    `City: ${city}\n\nPublications to check:\n${listing}`,
    400,
    llmProviders()
  );
  if (!result) return;

  const answer = result.text.trim();
  if (/^none\b/i.test(answer)) return;
  const numbers = new Set(
    (answer.match(/\d+/g) ?? []).map((value) => Number(value))
  );
  // The catalog also throws away "all of them are wrong", on the grounds that
  // being wrong costs a publication the reader might have liked. Here the
  // doubt runs the other way: the likeliest bad outcome is a city the model
  // does not know, where it invents five plausible outlets, all five resolve
  // to parked domains, and the vet correctly condemns every one. That is the
  // single answer this gate exists to hear.
  if (numbers.size === 0) return;

  for (const [index, { entry, feed }] of shown.entries()) {
    if (!numbers.has(index + 1) || !feed) continue;
    db.prepare("DELETE FROM feeds WHERE id = ?").run(feed.id);
    entry.status = "mismatch";
  }
}
