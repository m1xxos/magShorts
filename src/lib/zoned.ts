// One idea of what day it is.
//
// Every timestamp in the database is UTC, and SQLite's own date() would
// therefore bucket by UTC day. That is fine until two surfaces disagree: the
// digest already decides "today" in the reader's timezone, so a reading streak
// bucketed in UTC would break at 3am for a reader in Moscow while the digest
// still called it yesterday. These helpers were private to digest.ts; the
// stats page needs exactly the same arithmetic, so they live here now.

export interface ZonedNow {
  date: string; // YYYY-MM-DD in the given timezone
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday
}

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Building an Intl.DateTimeFormat costs about 30 microseconds, which is
// nothing until the stats page asks what day each of thirty thousand events
// happened on. One formatter per timezone, kept.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = FORMATTERS.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    FORMATTERS.set(timeZone, found);
  }
  return found;
}

export function zonedNow(now: Date, timeZone: string): ZonedNow {
  const parts = formatter(timeZone).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  // "24" shows up at midnight in some ICU versions.
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
    weekday: Math.max(
      0,
      WEEKDAYS.indexOf(get("weekday").toLowerCase().slice(0, 3))
    ),
  };
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  // Noon UTC keeps the arithmetic clear of every DST edge.
  const shifted = new Date(
    Date.UTC(year, month - 1, day, 12) + days * 86_400_000
  );
  return shifted.toISOString().slice(0, 10);
}
