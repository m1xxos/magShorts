<h1>
  <img src="src/app/icon.svg" alt="" width="30" align="top">
  magShorts
</h1>

A cozy, YouTube-style reader for articles. Subscribe to publications (RSS/Atom
feeds), browse them as a card grid like your YouTube subscriptions, or flip
through them one screen at a time in **Shorts** mode.

Ships with The Atlantic, The Verge, The New York Times and Habr; add any feed
you like with the *Add publication* button.

## Run with Docker

```bash
docker compose up --build
```

A prebuilt `linux/amd64` image is published to
[`ghcr.io/m1xxos/magshorts`](https://github.com/m1xxos/magShorts/pkgs/container/magshorts)
(`latest` from `main`, `sha-*` per commit, and version tags like `v2.1`) by
the GitHub Actions workflow in `.github/workflows/docker.yml`.

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

- **Signals**: saving to Read later, opening an article, the "Did you like
  it?" survey when you remove something from Read later, an implicit *skip*
  when you scroll past a Shorts card within a few seconds, and an implicit
  positive *dwell* when you stay on one for 15s+.
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

## Discover (v2.3)

Everything else in magShorts shows you what you already subscribe to.
`/discover` is a catalog of publications you **don't**, ranked against the same
taste profile — behind one switch, either as publications (each with three of
its articles, because a publication is judged by what it publishes) or as a
flat grid of articles with the publication demoted to the card footer.

**Subscribe** and **+ Follow** are the same action in two places: a catalog
publication and a subscription are one row with one flag, so subscribing is
instant, keeps the articles already fetched, and is undone by the same switch.
The **×** beside them is the other answer — it removes the publication and
remembers the refusal, so the daily suggestion run can't hand it back
tomorrow. Subscriptions have no ×: unsubscribing is a different act and
already has its own switch.

**Manage sources** has the reverse — *To Discover* on a feed, *All to Discover*
on a folder — which retires a publication into the catalog instead of deleting
it and its archive.

A catalog publication that stops answering for ten refreshes running — two and
a half days — is retired from the catalog on its own. A *subscription* that
fails is never disabled behind your back: it would look like the app losing
your feed, so Manage sources marks it **not answering** and leaves the choice
to you.

Catalog publications are fetched every six hours rather than every ten minutes
and keep only their ten newest articles: enough for three tiles and for
ranking, without carrying an archive nobody can see. They never appear in the
grid, Shorts, For you or the digest.

The catalog fills from three places, and nothing enters it unverified — every
candidate is a home page that must resolve to a real, parseable feed through
the same discovery the *Add publication* button uses:

- publications you retire from your subscriptions;
- a curated seed list (`src/lib/catalogSeed.ts`);
- the model, asked for publications like the ones you save. It is a source of
  names, not of truth: a suggestion whose domain doesn't exist simply fails to
  resolve and is reported rather than stored.

That last one runs by itself. Once a day the scheduler asks for more, up to a
ceiling of `CATALOG_MAX` publications (120), and every candidate goes through
the same three gates before it stays:

1. **It must resolve.** A home page that yields no parseable feed is dropped,
   and its domain is remembered so tomorrow's run doesn't spend another round
   of fetches disproving the same invented site.
2. **It must be new.** Matching is by host, so the same publication offered
   under a different path is recognised.
3. **It must belong.** After the feed is fetched, the model is shown the new
   publications' three most recent headlines and asked which don't fit — the
   gate that catches a real, live, well-made feed that is simply the wrong
   thing, like a birdwatching monthly suggested off one saved article about
   birds. Only what this run just added can be removed, and only on a clear
   answer; a failed or unparseable reply keeps everything.

The question rotates. Asked the same way every day the model answers with the
same canonical dozen — the first automatic run came back with 24 suggestions,
all 24 already in the catalog. Each run takes a different angle and a
different window over what you saved.

```bash
curl -X POST localhost:3000/api/discover/suggest -d '{"seed":true}'   # curated list
curl -X POST localhost:3000/api/discover/suggest -d '{}'              # ask the model now
curl -X POST localhost:3000/api/discover/suggest -d '{"brief":2}'     # from a chosen angle
```

Set `CATALOG_AUTOFILL=off` to keep the catalog exactly as you left it. With no
LLM configured there is nothing to turn off: the curated seed and retiring your
own subscriptions still work, the automatic runs simply never happen.

Ranking is the taste profile again, with two corrections the grid doesn't
need: a publication is scored on its best three articles together rather than
its single best, and output above roughly one post a day is damped — otherwise
a wire posting a thousand times a week wins every slot on the strength of
having published something four minutes ago.

## Digest (v2.2)

`/digest` is the five-minutes-in-the-morning read: a **finite** page instead of
an infinite one. Once a day (and once a week) a background job takes the
period's articles from the folders that feed **For you**, ranks them with the
same taste profile, collapses duplicate stories, and freezes the result as a
snapshot — one **lead** article, six **also worth it**, four **quick hits**,
an **in three lines** prose summary of the period, and the rest behind
*Show all N*. Opening the page recomputes nothing, so it reads the same twice,
and **Daily / Weekly** is a switch between two stored snapshots.

**Read here** opens the article (and counts as a taste signal), **Read later**
saves it, and **Skip** removes it from the digest for good.

### How the seven get chosen

Four layers, each of which degrades to the one below it:

1. **Ranking** — the For-you taste profile (cosine over article embeddings),
   a recency bonus and a per-feed repeat penalty, then duplicate stories are
   collapsed by embedding similarity so one event can't take three slots.
2. **Commercial roundups are demoted** — promo codes, coupons, "N Best …"
   buying guides, sale posts. Embeddings put these right next to real
   technology writing, so they're recognised by title shape instead, and the
   patterns are narrow enough to leave "FTC Strikes Deals to Ignore Unlawful
   Credit Discrimination" alone. Demoted rather than dropped, and never
   allowed to be the lead.
3. **Sources earn their place** — every feed gets a small score offset from
   your own reactions to it (saves and opens against skips and dislikes),
   smoothed toward the average so a couple of skips can't condemn a
   publication and a feed you've never rated sits at exactly zero. A source
   you keep skipping quietly fades instead of needing to be switched off.
4. **The model picks the cards** — one call ranks the top 30 stories against
   the titles you actually saved, with the lead going to the most significant
   story and at least two slots to things you'd pick for yourself. It can only
   reorder: an unparseable or failed answer leaves layers 1–3 in charge.

The blurbs are written by a language model:

- **Local by default.** Point `LLM_PROVIDERS` at an Ollama instance on the host
  and nothing but the article's own public text leaves the machine — the taste
  profile and the embeddings never do.
- **Failover.** `LLM_PROVIDERS` is an ordered list; a provider that times out,
  rate-limits or 5xxs hands over to the next one.
- **Geo-blocks.** Several hosted providers refuse whole countries outright
  (Groq answers `403`). `LLM_PROXY_URL` routes the provider calls — and only
  those — through a proxy; a provider on localhost or the LAN is never
  proxied, so a local Ollama keeps working alongside it.
- **No model, no problem.** With `LLM_PROVIDERS` empty (the default) the digest
  still builds — the blurbs become the articles' own opening lines and the
  three lines become counts. Nothing about the app requires an LLM.
- **Nine calls per digest** — one to rank, one per annotated card, one for the
  summary panel — all in the background scheduler. No request ever waits on a
  model.
- **Paced.** Hosted providers meter tokens per minute and a digest spends its
  budget in one burst, so the client reads each provider's `x-ratelimit-*`
  headers and waits for the window to roll rather than walking into a 429.
  Ranking can be pointed at a second model with `LLM_RANK_PROVIDERS`, giving
  it a separate budget from the annotations.

Configure it with `DIGEST_DAILY_AT` (default `08:00`), `DIGEST_WEEKLY_AT`
(default `Sun 19:00`), `DIGEST_TZ` and the `LLM_*` variables — see
`.env.example`. `DIGEST_TZ` matters: a container's clock is UTC.

To compare candidate models on a fixed corpus of ten real articles from your
own database, using the digest's own prompt:

```bash
LLM_BENCH_PROVIDERS='ollama,groq' npm run llm-bench
```

It writes `docs/llm-bench.md` — a speed table plus every annotation side by
side, one column per model, so quality is judged by eye.

## The home grid (v2.1)

Every view is titled above the cards, and a **Cards / List / Compact** switch on
the right sets how densely they are drawn — the choice is remembered in
`localStorage`. The grid runs the full width of the window and takes as many
columns as fit, so a wide display shows more cards rather than wider ones. The
sidebar appears from 1024px up; below that its navigation is the chip row above
the grid, which leaves a portrait tablet room for three columns.

Cards lead with a 2:1 cover, then the full headline (never truncated, so the
row simply grows), three lines of summary and a metadata line pinned to the
bottom edge so neighbouring cards stay aligned. That line carries the source,
the age and a **topic pill**: the first usable `<category>` the feed publishes,
falling back to the folder the feed lives in, and omitted when neither exists.
Topics are derived when an article is ingested, so articles already stored
before the feature landed stay untagged until their feed republishes them.

## Folders (v2.1)

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
  `MARRETA_URL` if you host your own). Which route a given publication takes
  (Marreta / Direct / Archive) is set per feed in **Manage sources**.

## How it works

- **Next.js (App Router)** serves both the UI and the API.
- Feeds live in **SQLite** (`better-sqlite3`); articles are ingested with
  `rss-parser`. A background scheduler refreshes feeds every 10 minutes,
  backfills embeddings, prefetches fresh covers and builds any digest that has
  come due. Requests never wait on
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
  For you grid keeps an article until you act on it (save/open/skip).

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
| GET | `/api/discover/publications` | Catalog publications; `?topic=`, `?q=`, `?limit=`, `?offset=` |
| GET | `/api/discover/articles` | The catalog flattened to articles; same filters |
| POST | `/api/discover/suggest` | Fill the catalog: `{ "seed": true }` for the curated list, `{}` to ask the model |
| GET | `/api/digest` | The stored digest snapshot; `?kind=daily\|weekly` |
| POST | `/api/digest/build` | Build it now: `{ "kind", "force"? }` — `force` discards the period's snapshot and rebuilds |
