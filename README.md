# magShorts

A cozy, YouTube-style reader for articles. Subscribe to publications (RSS/Atom
feeds), browse them as a card grid like your YouTube subscriptions, or flip
through them one screen at a time in **Shorts** mode.

Ships with The Atlantic, The Verge, The New York Times and Habr; add any feed
you like with the *Add publication* button.

## Run with Docker

```bash
docker compose up --build
```

Open http://localhost:3000. The SQLite database is stored in `./data`, so
subscriptions and cached articles survive restarts.

> On Linux, make sure `./data` is writable by the container user:
> `mkdir -p data && chmod 777 data` (or chown it to the container UID).

## Run for development

```bash
npm install
npm run dev
```

## Swipes, reading list & integrations

- **Swipe right** on any card (home grid or Shorts) — or use the bookmark
  button — to save it to the built-in **Read later** list (`/reading-list`).
  Saved items are snapshots, so they survive unsubscribing from a feed.
- **Swipe left** to send the article to your **self-hosted Omnivore**
  instance. Configure its URL and API key in *Settings* (gear at the bottom
  of the sidebar) or via `OMNIVORE_URL` / `OMNIVORE_API_KEY` env vars.
  The cloud omnivore.app shut down in Nov 2024 — only self-hosted works.
- **No paywall** opens the article through a [Marreta](https://github.com/manualdousuario/marreta)
  instance (`https://marreta.link` by default; change it in Settings or with
  `MARRETA_URL` if you host your own).

## How it works

- **Next.js (App Router)** serves both the UI and the API.
- Feeds live in **SQLite** (`better-sqlite3`); articles are ingested with
  `rss-parser` and refreshed lazily (15-minute TTL) whenever they're requested.
- `GET /api/articles?mix=1` interleaves feeds round-robin so one prolific
  source doesn't drown out the others.
- Shorts mode is a CSS scroll-snap column with keyboard navigation
  (↑/↓, j/k, space).

## API

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/feeds` | List subscriptions with article counts |
| POST | `/api/feeds` | Add a feed: `{ "url": "https://…/feed.xml" }` |
| DELETE | `/api/feeds/:id` | Unsubscribe (removes its articles) |
| GET | `/api/articles` | Articles; `?feed=ID`, `?mix=1`, `?limit=`, `?offset=` |
