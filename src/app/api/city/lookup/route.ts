import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Type-ahead for the city field, against OpenStreetMap's Nominatim.
//
// This is the one place magShorts asks a service it does not run. It is worth
// saying plainly what that means: the letters typed into the city box are sent
// to openstreetmap.org, and nothing else is. The alternative was a list of
// cities bundled into the repository, which would have been a guess about
// which places count — a reader in a town of 40,000 would not find it.
//
// The field stays free text. If this route is unreachable, blocked, or does
// not know the place, typing the name still works: the picker is a
// convenience, not a gate.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Their usage policy asks for an identifying User-Agent and no more than one
// request a second. The field debounces; this is the backstop.
const USER_AGENT = "magShorts/2 (self-hosted RSS reader)";
const MIN_INTERVAL_MS = 1100;
let lastCall = 0;

// A place people live, not a shop or a street. `featureType=settlement` does
// most of this, but it still answers with regions, and Москва and
// Санкт-Петербург come back typed `state` because they are federal cities —
// dropping those would lose the two places most likely to be typed.
const SETTLEMENTS = new Set([
  "city",
  "town",
  "village",
  "municipality",
  "borough",
  "suburb",
  "hamlet",
  "state",
]);

// Repeated prefixes are the normal case while somebody types — "сан", "санк",
// "санкт" — and the third of those is a request nobody needs to make twice.
const cache = new Map<string, CityMatch[]>();
const CACHE_MAX = 200;

export interface CityMatch {
  /** What goes in the setting. */
  name: string;
  /** Where it is, for telling two places of the same name apart. */
  where: string;
}

interface NominatimRow {
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  display_name?: string;
}

export async function GET(request: NextRequest) {
  if (!getSessionUser(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  // Two letters match half the world and spend a request finding that out.
  if (query.length < 3) return NextResponse.json([]);

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached) return NextResponse.json(cached);

  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  let rows: NominatimRow[];
  try {
    const response = await fetch(
      // featureType=settlement rather than a plain search: without it "санкт"
      // answers with streets and businesses and the city is nowhere. Nominatim
      // matches whole words, not prefixes, so this completes a name most of
      // the way typed — it is not a three-letter autocomplete and cannot be.
      `${NOMINATIM}?q=${encodeURIComponent(query)}&format=jsonv2&limit=12&featureType=settlement`,
      {
        headers: {
          "User-Agent": USER_AGENT,
          // The names come back in the reader's own language where OSM has
          // one, so a Russian city reads as a Russian city.
          "Accept-Language":
            request.headers.get("accept-language") ?? "ru,en;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!response.ok) return NextResponse.json([]);
    rows = await response.json();
  } catch {
    // Unreachable, blocked or slow. An empty list, never an error: the field
    // underneath still takes anything typed into it.
    return NextResponse.json([]);
  }

  const seen = new Set<string>();
  const matches: CityMatch[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!SETTLEMENTS.has(row.addresstype ?? row.type ?? "")) continue;
    const name = row.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    // display_name leads with the place itself; the rest is where it is.
    const where = (row.display_name ?? "")
      .split(",")
      .slice(1)
      .map((part) => part.trim())
      .filter((part) => part && !/^\d+$/.test(part))
      .join(", ");
    matches.push({ name, where });
    if (matches.length >= 6) break;
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, matches);
  return NextResponse.json(matches);
}
