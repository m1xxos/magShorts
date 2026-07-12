import { getDb } from "./db";

export type SettingKey =
  | "omnivore_url"
  | "omnivore_api_key"
  | "marreta_url"
  | "archive_url"
  | "direct_domains"
  | "archive_domains";

export const SETTING_KEYS: SettingKey[] = [
  "omnivore_url",
  "omnivore_api_key",
  "marreta_url",
  "archive_url",
  "direct_domains",
  "archive_domains",
];

const ENV_FALLBACKS: Record<SettingKey, string | undefined> = {
  omnivore_url: process.env.OMNIVORE_URL,
  omnivore_api_key: process.env.OMNIVORE_API_KEY,
  marreta_url: process.env.MARRETA_URL,
  archive_url: process.env.ARCHIVE_URL,
  direct_domains: process.env.DIRECT_DOMAINS,
  archive_domains: process.env.ARCHIVE_DOMAINS,
};

const DEFAULTS: Partial<Record<SettingKey, string>> = {
  marreta_url: "https://marreta.link",
  archive_url: "https://web.archive.org/web/",
  direct_domains: "habr.com",
  archive_domains: "nytimes.com",
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
