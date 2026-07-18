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
subscriptions, cached articles, accounts and the recommendation model survive
restarts.

> On Linux, make sure `./data` is writable by the container user:
> `mkdir -p data && chmod 777 data` (or chown it to the container UID).

## Run for development

```bash
npm install
npm run dev
```

## Accounts (v2)

The first visit takes you to `/login` — create an account (username +
password, stored locally in SQLite with scrypt hashing). The first account
inherits the pre-accounts reading list. Each user gets their own Read later
list and their own recommendation profile.

## For you — recommendations (v2)

The sidebar's **For you** feed ranks fresh articles against your taste:

- **Signals**: saving to Read later, 👍/👎 on cards (grid and Shorts), opening
  an article, the "Did you like it?" survey when you remove something from
  Read later, an implicit *skip* when you scroll past a Shorts card within a
  few seconds, and an implicit positive *dwell* when you stay on one for 15s+.
- **Embeddings**: every article title+summary is embedded locally with
  `multilingual-e5-small` (works across English and Russian). The model
  (~120 MB) downloads once on first run into `./data/models` — the first
  batch of recommendations needs internet and a couple of minutes.
- **Ranking**: your profile is a time-decayed weighted average of the
  articles you reacted to; candidates from the selected window
  (**Day / Week / Month**) are ranked by cosine similarity with a per-feed
  diversity penalty and a pinch of exploration so you don't end up in a
  bubble.
- Under 5 positive signals the feed shows a fresh mix and keeps learning.

Both the home grid and Shorts scroll infinitely.

## Folders (v2.5)

Feeds can be grouped into **folders** (e.g. "Magazines" and "Blogs"). Each
folder has a switch that controls whether its articles feed the **For you**
recommendations; **All publications** always spans everything. Click a
folder name in the sidebar for its own mixed feed, and in Shorts a pill
switcher at the top flips the deck between **All** and any folder. The view
the home page opens with (All / For you / a folder) is picked in Settings
(**Default view**).

**Manage sources** (in the sidebar, or `/sources`) is the admin surface:
add a source by pasting *any* URL — a feed URL or just the site/blog address,
the RSS/Atom feed is discovered automatically — plus rename feeds, move them
between folders, pause them, pick per-domain routing (Marreta / Direct /
Archive) and create, rename, hide or delete folders.

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
  `MARRETA_URL` if you host your own). Per-feed routing (Marreta / direct /
  web archive) is configurable in Settings.

## How it works

- **Next.js (App Router)** serves both the UI and the API.
- Feeds live in **SQLite** (`better-sqlite3`); articles are ingested with
  `rss-parser`. A background scheduler refreshes feeds every 10 minutes,
  backfills embeddings and prefetches fresh covers. Requests never wait on
  origin servers: data routes serve the database as-is and kick a
  deduplicated background refresh when feeds have gone stale (e.g. after
  the host slept) — only a completely empty first-run database blocks.
- `GET /api/articles?mix=1` interleaves feeds round-robin so one prolific
  source doesn't drown out the others.
- When a feed item arrives without an image, the scheduler visits the
  article page and adopts its `og:image` / `twitter:image` preview. Articles
  that genuinely have no cover get a typographic card (the title set over the
  feed's tint) instead of a blank block.
- Article covers are served through `/api/images`, a disk cache in
  `./data/images` (capped at ~1 GB, oldest evicted) — images are recompressed
  to max-1280px WebP (roughly 10–20× smaller than typical originals), saved
  articles keep their covers even after publishers delete them, and
  Referer-based hotlink blocks don't apply. On a cache failure the route just
  redirects to the original image.
- Shorts mode is a CSS scroll-snap column with keyboard navigation
  (↑/↓, j/k, space, ←/→ to swipe, Esc to exit). The default Shorts feed has
  its own algorithm, separate from For you: today's most interesting articles
  first, then the week's picks with an older (7–30 day) insert every few
  cards, then the long tail. It never repeats — every card you're shown is
  marked seen (a weightless `view` event). Views only affect Shorts; the
  For you grid keeps an article until you act on it (save/like/dislike/
  open/skip).

## API

All data routes require a session cookie (sign in at `/login`).

| Method | Route | Description |
| --- | --- | --- |
| POST | `/api/auth/register` | Create account: `{ "username", "password" }` |
| POST | `/api/auth/login` | Sign in (sets `ms_session` cookie) |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/me` | Current user |
| GET | `/api/feeds` | List subscriptions with article counts |
| POST | `/api/feeds` | Add a feed: `{ "url", "folder_id"? }` — any site URL works, the feed is auto-discovered |
| PATCH | `/api/feeds/:id` | Update: `{ "enabled"?, "title"?, "folder_id"? }` |
| DELETE | `/api/feeds/:id` | Unsubscribe (removes its articles) |
| GET | `/api/folders` | List folders with feed counts |
| POST | `/api/folders` | Create: `{ "name", "include_in_main"? }` |
| PATCH | `/api/folders/:id` | Update: `{ "name"?, "include_in_main"? }` |
| DELETE | `/api/folders/:id` | Delete a folder (its feeds move to the root) |
| GET | `/api/articles` | Articles; `?feed=ID`, `?folder=ID`, `?mix=1`, `?limit=`, `?offset=` |
| GET | `/api/recommendations` | Personalized feed; `?window=day\|week\|month`, `?limit=`, `?offset=` |
| GET | `/api/shorts` | The Shorts deck; `?limit=`, `?folder=ID` |
| POST | `/api/events` | Taste signal: `{ "link", "action": like\|dislike\|skip\|open\|save }` |
