import { getDb } from "./db";

export type SettingKey =
  | "marreta_url"
  | "archive_url"
  | "direct_domains"
  | "archive_domains"
  // Which view the home page opens with: "" = All publications,
  // "forYou", or "folder:<id>".
  | "default_view"
  // "on" | "off": whether a headline opens in the in-app reader or leaves for
  // the publisher's own page. Stored as words, never as "" — an empty value
  // deletes the row and reverts to the default, which is the opposite of what
  // turning something off should mean.
  | "open_in_reader"
  // Digest shape and schedule. Each falls back to its env var, so a deployment
  // can still be configured entirely from the environment.
  | "digest_also_count"
  | "digest_quick_count"
  | "digest_daily_at"
  | "digest_weekly_at"
  | "digest_tz"
  | "digest_rerank";

export const SETTING_KEYS: SettingKey[] = [
  "marreta_url",
  "archive_url",
  "direct_domains",
  "archive_domains",
  "default_view",
  "open_in_reader",
  "digest_also_count",
  "digest_quick_count",
  "digest_daily_at",
  "digest_weekly_at",
  "digest_tz",
  "digest_rerank",
];

const ENV_FALLBACKS: Record<SettingKey, string | undefined> = {
  marreta_url: process.env.MARRETA_URL,
  archive_url: process.env.ARCHIVE_URL,
  direct_domains: process.env.DIRECT_DOMAINS,
  archive_domains: process.env.ARCHIVE_DOMAINS,
  default_view: undefined,
  open_in_reader: process.env.OPEN_IN_READER,
  digest_also_count: undefined,
  digest_quick_count: undefined,
  digest_daily_at: process.env.DIGEST_DAILY_AT,
  digest_weekly_at: process.env.DIGEST_WEEKLY_AT,
  // A container's clock is UTC unless TZ says otherwise, and an 08:00 digest
  // in the wrong zone is the whole feature landing at the wrong hour.
  digest_tz: process.env.DIGEST_TZ ?? process.env.TZ,
  digest_rerank: process.env.DIGEST_RERANK,
};

const DEFAULTS: Partial<Record<SettingKey, string>> = {
  marreta_url: "https://marreta.link",
  archive_url: "https://web.archive.org/web/",
  direct_domains: "habr.com",
  archive_domains: "nytimes.com",
  // "off" sends a headline to the publisher's own page in a new tab, the
  // way the app behaved before the reader existed.
  open_in_reader: "on",
  digest_also_count: "6",
  digest_quick_count: "4",
  digest_daily_at: "08:00",
  digest_weekly_at: "Sun 19:00",
  digest_tz: "UTC",
  // "off" keeps the scored order and saves the one ranking call.
  digest_rerank: "on",
};

function matchesDomainList(articleUrl: string, key: SettingKey): boolean {
  let host: string;
  try {
    host = new URL(articleUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return getSetting(key)
    .split(/[,\s]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean)
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// archive_url may name more than one archive, comma- or whitespace-separated.
// One archive is never enough on its own — the Wayback Machine has no snapshot
// of most articles published today — and which mirrors to reach for is the
// reader's decision to make, not something to hard-code.
export function archiveBases(): string[] {
  return getSetting("archive_url")
    .split(/[,\s]+/)
    .map((base) => base.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function isDirectDomain(articleUrl: string): boolean {
  return matchesDomainList(articleUrl, "direct_domains");
}

export function isArchiveDomain(articleUrl: string): boolean {
  return matchesDomainList(articleUrl, "archive_domains");
}

export function getSetting(key: SettingKey): string {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? ENV_FALLBACKS[key] ?? DEFAULTS[key] ?? "";
}

// A count that a hand-edited setting can't push somewhere absurd — every extra
// annotated card is another model call.
export function getCountSetting(
  key: SettingKey,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(getSetting(key), 10);
  if (!Number.isFinite(parsed)) return Number(DEFAULTS[key] ?? min);
  return Math.min(max, Math.max(min, parsed));
}

export function setSetting(key: SettingKey, value: string): void {
  const db = getDb();
  if (value.trim() === "") {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, value.trim());
  }
}

export function getAllSettings(): Record<SettingKey, string> {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, getSetting(key)])
  ) as Record<SettingKey, string>;
}
