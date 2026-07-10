import { getDb } from "./db";

export type SettingKey = "omnivore_url" | "omnivore_api_key" | "marreta_url";

export const SETTING_KEYS: SettingKey[] = [
  "omnivore_url",
  "omnivore_api_key",
  "marreta_url",
];

const ENV_FALLBACKS: Record<SettingKey, string | undefined> = {
  omnivore_url: process.env.OMNIVORE_URL,
  omnivore_api_key: process.env.OMNIVORE_API_KEY,
  marreta_url: process.env.MARRETA_URL,
};

const DEFAULTS: Partial<Record<SettingKey, string>> = {
  marreta_url: "https://marreta.link",
};

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
