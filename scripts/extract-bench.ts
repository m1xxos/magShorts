// Compares full-text extractors on real articles from the local database.
//
//   npm run extract-bench
//
// Every candidate sees the same bytes: each page is fetched once and cached on
// disk, so the numbers compare parsers rather than networks, and a re-run costs
// nothing. Writes docs/extraction-bench.md.
//
// The corpus is picked once and committed (extract-bench-corpus.json) so the
// comparison is repeatable — otherwise every run measures a different day's
// articles and the table can't be argued with.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { extractFromHtml } from "@extractus/article-extractor";
import { getDb } from "../src/lib/db";
import { fetchPageHtml } from "../src/lib/articleImages";

const CORPUS = path.join(import.meta.dirname, "extract-bench-corpus.json");
const CACHE = path.join(import.meta.dirname, "..", "data", "extract-bench-cache");
const OUTPUT = path.join(import.meta.dirname, "..", "docs", "extraction-bench.md");

interface Sample {
  feed: string;
  title: string;
  link: string;
}

interface Result {
  chars: number;
  paragraphs: number;
  headings: number;
  // Boilerplate phrases that should never survive a good extraction.
  junk: string[];
  ms: number;
  error?: string;
}

// One recent article from each publication named here. The list spans the
// shapes that break extractors in different ways: a JS-heavy news site, a
// classic CMS, a Russian-language site, a newsletter, a static blog, and two
// publications known to truncate at a paywall.
const WANTED = [
  "The Verge",
  "The Atlantic",
  "The New York Times",
  "WIRED",
  "Habr",
  "Harper's Magazine",
  "The Pudding",
  "Sean Goedecke",
  "Terence Eden’s Blog",
  "The Cloudflare Blog",
];

function pickCorpus(): Sample[] {
  const db = getDb();
  const pick = db.prepare(
    `SELECT a.title, a.link FROM articles a
     JOIN feeds f ON f.id = a.feed_id
     WHERE f.title = ? AND a.link LIKE 'http%'
     ORDER BY a.published_at DESC LIMIT 1`
  );
  const samples: Sample[] = [];
  for (const feed of WANTED) {
    const row = pick.get(feed) as { title: string; link: string } | undefined;
    if (row) samples.push({ feed, title: row.title, link: row.link });
    else console.warn(`[bench] no article for ${feed} — skipped`);
  }
  return samples;
}

async function html(sample: Sample): Promise<string | null> {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(
    CACHE,
    `${createHash("sha1").update(sample.link).digest("hex")}.html`
  );
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const page = await fetchPageHtml(sample.link);
  if (!page) return null;
  fs.writeFileSync(file, page.html);
  return page.html;
}

// What a reader would see, from whatever the candidate returned.
function measure(bodyHtml: string, ms: number): Result {
  const { document } = parseHTML(`<html><body>${bodyHtml}</body></html>`);
  const text = (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
  const junk = JUNK.filter((phrase) =>
    text.toLowerCase().includes(phrase.toLowerCase())
  );
  return {
    chars: text.length,
    paragraphs: document.querySelectorAll("p").length,
    headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    junk,
    ms,
  };
}

// Phrases that only appear in page furniture. If one survives, the candidate
// kept navigation, a newsletter box or a related-articles rail.
const JUNK = [
  "Sign up for",
  "Subscribe to",
  "Most Popular",
  "Related Stories",
  "Cookie",
  "Newsletter",
  "Share this",
  "Читайте также",
  "Комментарии",
];

// The floor: the regex strip already used by the digest. Not a real extractor —
// it is here so every candidate has to prove it earns its dependency.
function baseline(raw: string): string {
  const article = raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  let body = article?.[1] ?? raw;
  body = body.replace(
    /<(script|style|noscript|svg|head|nav|header|footer|aside|form|figure)\b[\s\S]*?<\/\1>/gi,
    " "
  );
  return body;
}

type Candidate = (raw: string, url: string) => Promise<string | null>;

const CANDIDATES: Record<string, Candidate> = {
  baseline: async (raw) => baseline(raw),

  readability: async (raw, url) => {
    const { document } = parseHTML(raw);
    // Readability reads the base URI off the document to absolutise links.
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.appendChild(base);
    // linkedom's Document is structurally compatible; the types are not.
    const parsed = new Readability(document as unknown as Document).parse();
    return parsed?.content ?? null;
  },

  defuddle: async (raw, url) => {
    // The package's named export is undefined under this loader; the class is
    // the default export.
    const Defuddle = (await import("defuddle")).default;
    const { document } = parseHTML(raw);
    const result = await new Defuddle(document as unknown as Document, {
      url,
    }).parse();
    return result?.content ?? null;
  },

  "article-extractor": async (raw, url) => {
    const parsed = await extractFromHtml(raw, url);
    return parsed?.content ?? null;
  },
};

async function main(): Promise<void> {
  let corpus: Sample[];
  if (fs.existsSync(CORPUS)) {
    corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8")) as Sample[];
  } else {
    corpus = pickCorpus();
    fs.writeFileSync(CORPUS, `${JSON.stringify(corpus, null, 2)}\n`);
    console.log(`[bench] wrote a fresh corpus of ${corpus.length} articles`);
  }

  const names = Object.keys(CANDIDATES);
  const table: Array<{ sample: Sample; results: Record<string, Result> }> = [];

  for (const sample of corpus) {
    const raw = await html(sample);
    if (!raw) {
      console.warn(`[bench] could not fetch ${sample.link}`);
      continue;
    }
    const results: Record<string, Result> = {};
    for (const name of names) {
      const started = Date.now();
      try {
        const body = await CANDIDATES[name](raw, sample.link);
        results[name] = body
          ? measure(body, Date.now() - started)
          : {
              chars: 0,
              paragraphs: 0,
              headings: 0,
              junk: [],
              ms: Date.now() - started,
              error: "returned nothing",
            };
      } catch (error) {
        results[name] = {
          chars: 0,
          paragraphs: 0,
          headings: 0,
          junk: [],
          ms: Date.now() - started,
          error: String(error).slice(0, 80),
        };
      }
    }
    table.push({ sample, results });
    console.log(
      `${sample.feed.padEnd(22)} ${names
        .map((n) => `${n} ${results[n].chars}`)
        .join("  ")}`
    );
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, report(table, names));
  console.log(`\nwrote ${path.relative(process.cwd(), OUTPUT)}`);
}

// Written by hand from the tables below — the script prints the measurements,
// not the conclusion. Re-read it if the numbers move.
const VERDICT = `## Verdict: \`@mozilla/readability\` + \`linkedom\`

**The Atlantic settles it.** The regex baseline gets 99 characters there — the
page keeps its body outside \`<article>\`, so the digest's strip finds nothing.
Readability gets 2 448 characters across 26 paragraphs. That single row is the
whole reason this task needs a real parser, and every candidate that isn't the
baseline clears it.

Between the three real candidates the tables are close on characters, so the
decision came from the other three columns:

- **\`@extractus/article-extractor\` is Readability.** It wraps it, and the
  numbers show it: identical character counts on six of eight pages, identical
  paragraph counts on all eight. It adds 488 KB and a second parse of the same
  document to reach the same answer. No reason to prefer the wrapper.
- **\`defuddle\` loses structure.** It reads marginally more raw text (WIRED
  6 060 vs 5 842, Cloudflare 21 555 vs 21 414) but returns it in far fewer
  paragraphs: 0 on The Atlantic against 26, 14 on Habr against 47, 3 on The
  Verge against 6. A reader renders paragraphs, so "more characters, no
  \`<p>\`" is worse, not better. It is also 3–15× slower (607 ms on The
  Pudding against 39 ms) and it is the largest install at 3 068 KB.
- **Readability is the fastest real parser** — 4–43 ms — the smallest at
  188 KB, and it keeps the paragraph and heading structure the outline is
  built from.

\`linkedom\` (2 568 KB) is the DOM Readability needs. It is pure JavaScript, so
nothing changes in the Dockerfile, and it is reused afterwards for sanitising
and for assigning heading ids.

**One thing no parser can fix:** The New York Times could not be fetched at
all — the direct request never returns a document. That is the unlock chain's
job, not the extractor's.
`;

function report(
  table: Array<{ sample: Sample; results: Record<string, Result> }>,
  names: string[]
): string {
  const lines: string[] = [
    "# Full-text extractors, compared on real feeds",
    "",
    `Generated by \`npm run extract-bench\` on ${new Date().toISOString().slice(0, 10)}.`,
    "Every candidate parses the same cached HTML, so the numbers are about the",
    "parser and not the network. `baseline` is the regex strip the digest already",
    "uses — a candidate that doesn't beat it isn't worth a dependency.",
    "",
    VERDICT,
    "",
    "## Characters of body text extracted",
    "",
    `| Publication | ${names.join(" | ")} |`,
    `| --- | ${names.map(() => "---:").join(" | ")} |`,
  ];
  for (const row of table) {
    lines.push(
      `| ${row.sample.feed} | ${names
        .map((n) => {
          const r = row.results[n];
          return r.error ? `— (${r.error})` : String(r.chars);
        })
        .join(" | ")} |`
    );
  }

  lines.push("", "## Structure and boilerplate", "");
  lines.push(`| Publication | Candidate | ¶ | headings | boilerplate kept | ms |`);
  lines.push(`| --- | --- | ---: | ---: | --- | ---: |`);
  for (const row of table) {
    for (const name of names) {
      const r = row.results[name];
      lines.push(
        `| ${row.sample.feed} | ${name} | ${r.paragraphs} | ${r.headings} | ${
          r.junk.length ? r.junk.join(", ") : "—"
        } | ${r.ms} |`
      );
    }
  }

  lines.push("", "## Corpus", "");
  for (const row of table) {
    lines.push(`- **${row.sample.feed}** — [${row.sample.title}](${row.sample.link})`);
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
