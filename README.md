<h1>
  <img src="src/app/icon.svg" alt="" width="30" align="top">
  magShorts
</h1>

A cozy, YouTube-style reader for articles. Subscribe to publications (RSS/Atom
feeds), browse them as a card grid, or flip through them one screen at a time
in **Shorts** mode. Read them in place, keep the passages that matter, and get
a finite five-minute digest instead of an endless timeline.

Ships with The Atlantic, The Verge, The New York Times and Habr; add any feed
you like with the *Add publication* button.

Everything runs on your own machine. Nothing about the app requires a hosted
service: no account elsewhere, no API key, no model — those are options, and
the app says what it does without them.

## Running it

```bash
docker compose up --build
```

Open http://localhost:3000 and create an account. The SQLite database lives in
`./data`, so subscriptions, articles, accounts and the recommendation profile
survive restarts.

> On Linux make sure `./data` is writable by the container user:
> `mkdir -p data && chmod 777 data` (or chown it to the container UID).

A prebuilt `linux/amd64` image is published to
[`ghcr.io/m1xxos/magshorts`](https://github.com/m1xxos/magShorts/pkgs/container/magshorts)
— `latest` from `main`, `sha-*` per commit, and version tags — by
`.github/workflows/docker.yml`.

For development:

```bash
npm install
npm run dev
npm test          # builds, then runs both suites
```

Configuration is all environment variables; see `.env.example`. The ones worth
knowing: `LLM_PROVIDERS` and friends for the digest, `MARRETA_URL` and
`ARCHIVE_URL` for the unlock chain, `DIGEST_*` for the schedule and its
timezone (a container's clock is UTC), `CATALOG_MAX` and `CATALOG_AUTOFILL`
for Discover, `FEED_PROXY_URL` where feeds or images need one.

## Reading

**The grid** titles every view above the cards, with a **Cards / List /
Compact** switch for how densely they are drawn. It runs the full width of the
window and takes as many columns as fit, so a wide display shows more cards
rather than wider ones. Cards lead with a 2:1 cover, then the full headline —
never truncated, the row simply grows — three lines of summary, and a metadata
line pinned to the bottom edge so neighbours stay aligned: the source, the age
and a **tag**, which is a button for everything else carrying it.

Articles with no cover get a typographic card, the title set over the feed's
tint, rather than a blank block.

**Shorts** (`/shorts`) is one article per screen, a CSS scroll-snap column with
keyboard navigation — ↑/↓, j/k, space, ←/→ to save, `Esc` to leave. It has its
own algorithm, separate from For you: today's most interesting first, then the
week's picks with an older insert every few cards, then the long tail. It never
repeats — every card shown is marked seen, and those views affect only Shorts.

**The sidebar** appears from 1024px up; below that the same rows are behind the
menu button in the top bar. The list you are looking at is in the address bar,
so Back walks the lists you looked at and a copied link opens on the right one.

## Finding things

**Search** is the box in the top bar, or `/` from anywhere. It covers titles
and tags across everything you subscribe to.

- An FTS5 index rather than a `LIKE` scan, for a reason specific to this
  corpus: SQLite folds case for ASCII only, so `железо` would never have found
  `Железо`. 3.8 MB of index over 8,500 articles, built in 330 ms, kept in step
  by triggers so an edited or deleted article follows.
- **Tags are tapped, not typed** — the tag on any card, or the list of the tags
  you actually have on `/search`, commonest first. `tag:python` works too.
- **Relevance, newest or oldest**, and a row of the publications the results
  actually came from, with how many from each — a broad word lands in three
  dozen of them here. Both are in the address bar, so a search you send someone
  arrives in the order you were reading it.
- What you type is never syntax. Words are extracted and quoted, the last gets
  a prefix `*` so results narrow as you type, and a box full of punctuation
  returns nothing rather than an error.
- Article bodies are not indexed. They exist only for articles somebody opened,
  so searching them would find a word inside one article and miss it in the
  next, for no reason you could see.

**Read later** is the built-in list (`/reading-list`). Swipe right on any card,
or use the bookmark. Saved items are snapshots, so they survive unsubscribing.
Rows show how far you got and offer to continue.

**Your reading** (`/stats`) is what you actually read: articles, time, saved
against finished, a streak, a chart by day, where it came from, and the
keywords For you has learned from your titles. Time is measured where the
reader timed itself and estimated from word counts where it could not, and the
card says which. The keyword card needs a term in three separate articles
before it shows it, and says so rather than offering coincidences.

## The reader

Clicking an article opens it **over** the list rather than in another tab, with
the full text extracted from the page. Closing puts you back exactly where you
were, still scrolled to the same card. Shorts and Discover keep opening the
original — in Discover you are judging the publication's own site, which is the
point of that page.

- **Lazy by construction.** Text is fetched on exactly two triggers: opening
  the reader, and saving to Read later. Nothing a render, a scroll or a hover
  does can reach the network. The result is cached in SQLite, so a second open
  makes no request to the publisher at all.
- **Layout** — a reading column, the outline on the left built from the
  article's own sub-headings and following your scroll, *Up next* on the right,
  a progress rule and "N min left" counting down. Where you stopped is
  remembered per article. **Aa** sets text size, column width and serif or
  sans, all three persisted.
- **Up next is about what you are reading**, not where you opened it from:
  ranked by cosine against the current article, taste as a tie-breaker, a
  per-publication penalty so the rail isn't three cards from one source. The
  floor is .85 — above the 99th percentile of random pairs over 3,760 embedded
  articles — because below that a genuinely related piece is indistinguishable
  from noise. An article nothing else covers offers one card, or none.
- **Back walks the articles.** Following *Up next* four deep and pressing Back
  four times returns through them; the header's "← Back to …" leaves for the
  list in one press. The URL is a real `?article=` link that can be pasted.
- **Galleries come through as galleries.** Where a page marks a slideshow in
  its own markup, the extractor tags those images before the parser flattens
  them and rebuilds the group after, and the reader draws a real carousel —
  arrows, a segment bar, a caption that follows the slide, a track that swipes.
  No guessing from layout: three illustrations in a row are an illustrated
  article. The publisher's own "1/4" counter is dropped, since the reader draws
  its own. Click any picture for the full size over the article, with arrow
  keys through a gallery.
- **Articles that aren't in the markup.** A growing number of publishers ship a
  shell of HTML and the article as JSON — WIRED's pages carry 25 paragraphs of
  furniture and a 520 KB `window.__PRELOADED_STATE__`. The reader reads that
  state, with its real paragraph boundaries, and prefers it on near-equal
  length: when a page hands the article over as data, that data *is* the
  article, while Readability is guessing which parts of the markup were.
  Only a *structured* body earns that preference — schema.org's flat
  `articleBody` is a copy written for crawlers, so it has to clear the usual
  bar instead.
- **The unlock chain.** Direct first, then as data. If both come back short or
  with a subscription wall in place of the article: the publisher's own
  AMP/print rendering, then [Marreta](https://github.com/manualdousuario/marreta),
  then each archive in `ARCHIVE_URL` in order. Whichever hop answered is named
  in the rail, so it is never a mystery where the text came from. Measured over
  the 30 busiest publications here: 23 direct, 2 from the page's data, 2 from
  the feed's body, 3 that no route reaches.
- **When nothing works** you get a panel with *Try again* and *Open the
  original* — never an empty column, never a subscription wall. A body that
  arrives but looks too short is stored as partial: shown, retry kept, and the
  next open tries the chain again rather than settling for a teaser.
  nytimes.com in particular answers `403` to any server fetch, has no same-day
  Wayback snapshot, and Marreta reports `HTTP_ERROR`: there is no technical
  route to it. Point `ARCHIVE_URL` at an archive that carries it and the chain
  picks it up.
- Extraction is [`@mozilla/readability`](https://github.com/mozilla/readability)
  over a `linkedom` DOM, chosen by measurement — see
  [`docs/extraction-bench.md`](docs/extraction-bench.md). Bodies are sanitised
  against a tag/attribute allowlist before storage and their images rewritten
  through `/api/images`.

### Highlights

Select a passage and keep it, with a note if you want one. They are listed in
the rail beside the article, and **Copy all** takes the lot as text or Markdown.

- **Anchored to the words, not to a number.** A highlight stores the quote plus
  a little of the text either side. Offsets are a cache: when a publisher edits
  the page, the passage is found again by its own words.
- **Nothing is thrown away.** A passage that can no longer be found is kept and
  marked *not in this version of the article* rather than deleted — an
  extraction that broke today is exactly when a note must not vanish.
- Deleting one leaves a tombstone for 90 days, so a client that already wrote
  it somewhere else learns it went away.

## For you

The sidebar's **For you** ranks fresh articles against your taste.

- **Signals**: saving, opening, the "Did you like it?" survey when you remove
  something from Read later, an implicit skip when you scroll past a Shorts
  card in a few seconds, and an implicit positive when you stay on one 15s+.
- **Embeddings**: every title and summary is embedded locally with
  `multilingual-e5-small`, which works across English and Russian. The model
  (~120 MB) downloads once into `./data/models` — the first batch of
  recommendations needs internet and a couple of minutes.
- **Ranking**: your profile is a time-decayed weighted average of what you
  reacted to; candidates from the chosen window (**Day / Week / Month**) are
  ranked by cosine similarity with a per-feed diversity penalty and a pinch of
  exploration, so you don't end up in a bubble.
- Under five positive signals it shows a fresh mix and keeps learning.

## The digest

`/digest` is the five-minutes-in-the-morning read: a **finite** page instead of
an infinite one. Once a day, and once a week, a background job takes the
period's articles from the folders that feed For you, ranks them, collapses
duplicate stories and freezes the result as a snapshot — one **lead**, six
**also worth it**, four **quick hits**, an **in three lines** summary, and the
rest behind *Show all N*. Opening the page recomputes nothing, so it reads the
same twice.

**Read here** opens the article and counts as a signal, **Read later** saves
it, **Skip** removes it from the digest for good.

Four layers choose the cards, each degrading to the one below:

1. **Ranking** — taste profile, a recency bonus, a per-feed repeat penalty,
   then duplicate stories collapsed by embedding similarity so one event can't
   take three slots.
2. **Commercial roundups demoted** — promo codes, coupons, "N Best …" buying
   guides. Embeddings put these right next to real technology writing, so they
   are recognised by title shape instead, narrowly enough to leave "FTC Strikes
   Deals to Ignore Unlawful Credit Discrimination" alone. Demoted, not dropped,
   and never allowed to lead.
3. **Sources earn their place** — each feed gets a small offset from your own
   reactions to it, smoothed toward the average so a couple of skips can't
   condemn a publication and an unrated feed sits at exactly zero.
4. **The model picks** — one call ranks the top 30 against the titles you
   saved. It can only reorder: a failed or unparseable answer leaves layers
   1–3 in charge.

The blurbs are written by a language model, and none of this is required:

- **Local by default.** Point `LLM_PROVIDERS` at an Ollama instance and nothing
  but the article's own public text leaves the machine — the taste profile and
  the embeddings never do.
- **Failover.** It is an ordered list; a provider that times out, rate-limits
  or 5xxs hands over to the next.
- **Geo-blocks.** Several hosted providers refuse whole countries outright.
  `LLM_PROXY_URL` routes provider calls, and only those, through a proxy; a
  provider on localhost or the LAN is never proxied, so a local Ollama keeps
  working alongside.
- **No model, no problem.** With `LLM_PROVIDERS` empty — the default — the
  digest still builds: blurbs become the articles' own opening lines and the
  three lines become counts.
- **The model reads the article, not the page.** The feed's body when it ships
  a real one, otherwise the reader's extractor. Stripping tags off the raw page
  handed the summariser the navigation, the byline and the "Most Popular" rail,
  so a blurb about a phone could come back mentioning a laptop from the
  sidebar. Annotating fills the reader's cache on the way past, so a digested
  article opens instantly.
- **Nine calls per digest**, all in the background scheduler. No request ever
  waits on a model. Hosted providers meter tokens per minute and a digest
  spends its budget in one burst, so the client reads each provider's
  `x-ratelimit-*` headers and waits for the window rather than walking into a
  429. `LLM_RANK_PROVIDERS` gives ranking its own budget.

To compare models on ten real articles from your own database, using the
digest's own prompt:

```bash
LLM_BENCH_PROVIDERS='ollama,groq' npm run llm-bench
```

It writes `docs/llm-bench.md` — a speed table plus every annotation side by
side, one column per model, so quality is judged by eye.

## Sources and folders

**Manage sources** (`/sources`) is the admin surface: add a source by pasting
*any* URL — a feed or just the site address, the feed is discovered — plus
rename feeds, move them between folders, pause them, pick per-domain routing
(Marreta / Direct / Archive), and create, rename, hide or delete folders.

Feeds group into **folders**, each with a switch for whether its articles feed
For you and another for whether they feed the digest — "what should I read now"
and "what did I miss overnight" are different questions, and a folder of blogs
can reasonably answer only the second. **All publications** always spans
everything. The view the home page opens with is picked in Settings.

A *subscription* that stops answering is never disabled behind your back: that
would look like the app losing your feed, so Manage sources marks it **not
answering** and leaves the choice to you.

## Discover

Everything else shows you what you already subscribe to. `/discover` is a
catalogue of publications you **don't**, ranked against the same taste profile
— either as publications, each with three of its articles, because a
publication is judged by what it publishes; or as a flat grid of articles with
the publication demoted to the card footer.

**Subscribe** is instant and keeps the articles already fetched: a catalogue
publication and a subscription are one row with one flag. The **×** beside it
is the other answer — it removes the publication and remembers the refusal, so
the daily run can't hand it back tomorrow. Manage sources has the reverse,
*To Discover*, which retires a publication into the catalogue instead of
deleting it and its archive.

Catalogue publications are fetched every six hours rather than every ten
minutes and keep only their ten newest articles: enough for three tiles and for
ranking, without carrying an archive nobody can see. They never appear in the
grid, Shorts, For you or the digest. One that stops answering for ten refreshes
running — two and a half days — retires itself.

The catalogue fills from three places, and nothing enters unverified: every
candidate is a home page that must resolve to a real, parseable feed through
the same discovery the *Add publication* button uses.

- publications you retire from your subscriptions;
- a curated seed list (`src/lib/catalogSeed.ts`);
- the model, asked for publications like the ones you save — a source of names,
  not of truth: a suggestion whose domain doesn't exist fails to resolve and is
  reported rather than stored.

That last runs by itself, once a day, up to `CATALOG_MAX` (200), and every
candidate passes three gates: it must **resolve** (a home page yielding no
feed is dropped and its domain remembered, so tomorrow doesn't spend another
round disproving the same invented site); it must be **new** (matched by host);
and it must **belong** — the model is shown the new publications' three most
recent headlines and asked which don't fit, the gate that catches a real, live,
well-made feed that is simply the wrong thing, like a birdwatching monthly
suggested off one saved article about birds. Only what the run just added can
be removed, and only on a clear answer.

The question rotates. Asked the same way every day the model answers with the
same canonical dozen — the first automatic run came back with 24 suggestions,
all 24 already in the catalogue.

```bash
curl -X POST localhost:3000/api/discover/suggest -d '{"seed":true}'   # curated list
curl -X POST localhost:3000/api/discover/suggest -d '{}'              # ask the model now
curl -X POST localhost:3000/api/discover/suggest -d '{"brief":2}'     # from a chosen angle
```

`CATALOG_AUTOFILL=off` keeps the catalogue as you left it. With no LLM there is
nothing to turn off: the seed and retiring your own subscriptions still work,
the automatic runs simply never happen.

Ranking is the taste profile again, with two corrections the grid doesn't need:
a publication is scored on its best three articles together rather than its
single best, and output above roughly one post a day is damped — otherwise a
wire posting a thousand times a week wins every slot on the strength of having
published something four minutes ago.

## Obsidian

A read-only API for clients that are not a browser — the
[Obsidian plugin](https://github.com/m1xxos/magshorts-obsidian) to begin with,
which writes one note per article with your highlights and notes under it.

Mint a token in **Settings → Connections**. It can read your highlights and
nothing else; it cannot mint another token. Tokens are stored as a sha256 hash
and the token itself is shown exactly once. `GET /api/sync/highlights` pages on
a `"<updated_at>|<id>"` cursor, because `datetime('now')` has one-second
resolution and a bulk edit ties, and deletions ride the same stream as
tombstones.

## How it works

- **Next.js (App Router)** serves both the UI and the API; **SQLite**
  (`better-sqlite3`) holds everything; `rss-parser` ingests.
- A background scheduler refreshes feeds every ten minutes, backfills
  embeddings, prefetches covers and builds any digest that has come due.
  Requests never wait on origin servers: data routes serve the database as-is
  and kick a deduplicated background refresh when feeds have gone stale. Only a
  completely empty first-run database blocks.
- `GET /api/articles?mix=1` interleaves feeds round-robin so one prolific
  source doesn't drown out the others.
- When a feed item arrives without an image the scheduler visits the article
  page and adopts its `og:image`.
- Covers are served through `/api/images`, a disk cache in `./data/images`
  capped at ~1 GB, oldest evicted. Images are recompressed to max-1280px WebP,
  roughly 10–20× smaller than typical originals; saved articles keep their
  covers after publishers delete them, and hotlink blocks don't apply. On a
  cache failure the route redirects to the original.
- **Tests** live in `tests/`: `npm test`. Both suites run a real server on its
  own port over a database they seed, and the browser suite drives the
  production build, because the dev server does not behave like the thing that
  ships. See [`tests/README.md`](tests/README.md).

## API

All data routes require a session cookie (sign in at `/login`). The
`/api/sync/*` routes also accept `Authorization: Bearer <token>`.

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
| GET | `/api/articles/:id` | One article, for the reader's `?article=` deep link |
| GET | `/api/articles/:id/related` | What to read next, ranked against this article |
| GET | `/api/articles/:id/content` | Extracted body from cache; never fetches |
| POST | `/api/articles/:id/content` | Extract or return cache; `?retry=1` re-runs a failed one |
| GET | `/api/search` | Search titles and tags; `?q=`, `?sort=relevance\|newest\|oldest`, `?feed=ID`, `?limit=`, `?offset=`. `q=tag:NAME` searches tags only |
| GET | `/api/search/sources` | Which publications a search found something in, and how many from each |
| GET | `/api/tags` | The tags your subscriptions carry, commonest first |
| GET | `/api/recommendations` | Personalized feed; `?window=day\|week\|month`, `?limit=`, `?offset=` |
| GET | `/api/shorts` | The Shorts deck; `?limit=`, `?folder=ID` |
| POST | `/api/events` | Taste signal: `{ "link", "action": like\|dislike\|skip\|open\|save\|read }` |
| GET | `/api/reading-list` | Saved items, each with the `article_id` behind its link |
| POST | `/api/reading-list` | Save a snapshot; also kicks the reader's extraction |
| DELETE | `/api/reading-list` | Un-save by `?link=` (drops the `save` event too) |
| DELETE | `/api/reading-list/:id` | Un-save one row by id |
| GET | `/api/highlights` | Your highlights; `?link=` for one article, `?counts=1` for per-article totals |
| POST | `/api/highlights` | Keep a passage: `{ "link", "article_title", "quote", "prefix"?, "note"? }` |
| PATCH | `/api/highlights/:id` | Edit its note |
| DELETE | `/api/highlights/:id` | Delete it (leaves a tombstone for 90 days) |
| GET | `/api/stats` | Everything on Your reading; `?range=week\|month\|year` |
| GET | `/api/discover/publications` | Catalogue publications; `?topic=`, `?q=`, `?limit=`, `?offset=` |
| GET | `/api/discover/articles` | The catalogue flattened to articles; same filters |
| POST | `/api/discover/suggest` | Fill it: `{ "seed": true }` for the curated list, `{}` to ask the model |
| GET | `/api/digest` | The stored digest snapshot; `?kind=daily\|weekly` |
| POST | `/api/digest/build` | Build it now: `{ "kind", "force"? }` — `force` discards the period's snapshot |
| GET | `/api/tokens` | API tokens in use |
| POST | `/api/tokens` | Mint one: `{ "name" }` — the token is returned exactly once |
| DELETE | `/api/tokens/:id` | Revoke one |
| GET | `/api/sync/health` | Bearer-token check: who am I |
| GET | `/api/sync/highlights` | Highlights since a cursor; `?since=`, `?limit=` |
