// Benchmarks annotation models against a fixed corpus of real articles from
// the local database, using the digest's own prompt and text pipeline.
//
//   LLM_BENCH_PROVIDERS='ollama,groq' npm run llm-bench
//
// Falls back to LLM_PROVIDERS when LLM_BENCH_PROVIDERS is unset. Writes
// docs/llm-bench.md: a speed table plus every annotation side by side, one
// column per model, so quality is judged by eye.
//
// Not read-only: it feeds the models exactly what the digest feeds them, which
// since the digest stopped summarising raw pages means running the reader's
// extractor over any corpus article whose feed shipped no body — a live fetch,
// and a row written to article_content in ./data. Point DATA_DIR at a copy if
// that matters.

import fs from "node:fs";
import path from "node:path";
import { getDb, type Article } from "../src/lib/db";
import { articleFullText, LEAD_SYSTEM } from "../src/lib/digest";
import { completeWith, parseProviders, type LlmProvider } from "../src/lib/llm";

interface Sample {
  article: Article & { feed_title: string };
  text: string;
}

interface Measurement {
  ms: number;
  promptTokens: number;
  completionTokens: number;
  text: string;
  error?: string;
}

const CORPUS = path.join(import.meta.dirname, "llm-bench-corpus.json");
const OUTPUT = path.join(import.meta.dirname, "..", "docs", "llm-bench.md");

function providers(): LlmProvider[] {
  const spec = process.env.LLM_BENCH_PROVIDERS ?? process.env.LLM_PROVIDERS;
  const list = parseProviders(spec);
  if (list.length === 0) {
    console.error(
      "Set LLM_BENCH_PROVIDERS (or LLM_PROVIDERS) to the configs to compare, e.g.\n" +
        "  LLM_BENCH_PROVIDERS='ollama,groq' npm run llm-bench"
    );
    process.exit(1);
  }
  return list;
}

async function loadCorpus(): Promise<Sample[]> {
  const { articleIds } = JSON.parse(fs.readFileSync(CORPUS, "utf8")) as {
    articleIds: number[];
  };
  const db = getDb();
  const select = db.prepare(
    `SELECT a.*, f.title AS feed_title FROM articles a
     JOIN feeds f ON f.id = a.feed_id WHERE a.id = ?`
  );

  const samples: Sample[] = [];
  for (const id of articleIds) {
    const article = select.get(id) as (Article & { feed_title: string }) | undefined;
    if (!article) {
      console.warn(`  ! article ${id} is not in this database — skipping`);
      continue;
    }
    const text = await articleFullText(article);
    samples.push({ article, text });
    console.log(
      `  ${id} ${article.feed_title}: ${text.length} chars — ${article.title.slice(0, 50)}`
    );
  }
  return samples;
}

async function measure(
  provider: LlmProvider,
  sample: Sample
): Promise<Measurement> {
  const startedAt = Date.now();
  const attempt = await completeWith(
    provider,
    LEAD_SYSTEM,
    `Publication: ${sample.article.feed_title}\nHeadline: ${sample.article.title}\n\n${sample.text}`,
    320
  );
  if (!attempt.result) {
    return {
      ms: Date.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      text: "",
      error: attempt.reason ?? "failed",
    };
  }
  const { ms, promptTokens, completionTokens, text } = attempt.result;
  return { ms, promptTokens, completionTokens, text };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Markdown eats pipes and newlines inside a table cell.
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || "—";
}

function report(
  configs: LlmProvider[],
  samples: Sample[],
  results: Map<string, Measurement[]>
): string {
  const label = (provider: LlmProvider) => `${provider.name} / ${provider.model}`;
  const lines: string[] = [
    "# Annotation model benchmark",
    "",
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC over ` +
      `${samples.length} articles from the local database, using the digest's own ` +
      "lead prompt (`LEAD_SYSTEM` in `src/lib/digest.ts`).",
    "",
    "## Speed",
    "",
    "| Config | ok | median | p90 | in tok | out tok | tok/s | errors |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const provider of configs) {
    const measurements = results.get(label(provider)) ?? [];
    const ok = measurements.filter((entry) => !entry.error);
    const times = ok.map((entry) => entry.ms);
    const sorted = [...times].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const throughput =
      average(times) > 0
        ? (average(ok.map((entry) => entry.completionTokens)) /
            (average(times) / 1000)).toFixed(1)
        : "—";
    const errors = measurements
      .filter((entry) => entry.error)
      .map((entry) => entry.error);
    lines.push(
      `| ${label(provider)} | ${ok.length}/${measurements.length} | ` +
        `${(median(times) / 1000).toFixed(1)} s | ${(p90 / 1000).toFixed(1)} s | ` +
        `${Math.round(average(ok.map((entry) => entry.promptTokens)))} | ` +
        `${Math.round(average(ok.map((entry) => entry.completionTokens)))} | ` +
        `${throughput} | ${errors.length ? [...new Set(errors)].join(", ") : "—"} |`
    );
  }

  lines.push(
    "",
    "## Annotations",
    "",
    "One column per model — read across a row to compare them on the same article.",
    "",
    `| Article | ${configs.map(label).join(" | ")} |`,
    `| --- | ${configs.map(() => "---").join(" | ")} |`
  );

  for (const [index, sample] of samples.entries()) {
    const cells = configs.map((provider) => {
      const entry = results.get(label(provider))?.[index];
      return cell(entry?.error ? `_${entry.error}_` : (entry?.text ?? ""));
    });
    lines.push(
      `| **${cell(sample.article.title)}**<br>${sample.article.feed_title} · ` +
        `${sample.text.length} chars | ${cells.join(" | ")} |`
    );
  }

  lines.push(
    "",
    "## Chosen default",
    "",
    "_Fill this in after a run: which config `.env.example` ships as the default, and why._",
    ""
  );
  return lines.join("\n");
}

async function main() {
  const configs = providers();
  console.log(`Comparing ${configs.length} config(s):`);
  for (const provider of configs) {
    console.log(`  ${provider.name} → ${provider.baseUrl} (${provider.model})`);
  }

  console.log("\nLoading corpus:");
  const samples = await loadCorpus();
  if (samples.length === 0) {
    console.error("No corpus articles found in this database.");
    process.exit(1);
  }

  const results = new Map<string, Measurement[]>();
  for (const provider of configs) {
    const label = `${provider.name} / ${provider.model}`;
    console.log(`\n${label}`);
    const measurements: Measurement[] = [];
    for (const sample of samples) {
      const measurement = await measure(provider, sample);
      measurements.push(measurement);
      console.log(
        measurement.error
          ? `  ✗ ${measurement.error.padEnd(18)} ${sample.article.title.slice(0, 44)}`
          : `  ✓ ${(measurement.ms / 1000).toFixed(1)}s`.padEnd(20) +
              ` ${sample.article.title.slice(0, 44)}`
      );
    }
    results.set(label, measurements);
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, report(configs, samples, results));
  console.log(`\nWrote ${path.relative(process.cwd(), OUTPUT)}`);
}

main();
