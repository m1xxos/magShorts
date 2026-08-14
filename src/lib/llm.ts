import { ProxyAgent } from "undici";

// Provider-agnostic client for OpenAI-compatible /v1/chat/completions.
// Used only by the background digest builder and the bench script — never in a
// request path. With nothing configured every call returns null and callers
// fall back to extractive summaries, so the app works with no LLM at all.

export interface LlmProvider {
  // Log label, also the env prefix a preset reads its overrides from.
  name: string;
  // Ollama accepts (and needs) a keep_alive field that strict OpenAI servers
  // reject, so the flavor has to travel with the provider.
  kind: "ollama" | "openai";
  // Base URL including the version segment, e.g. "http://host:11434/v1".
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// Named shorthands so LLM_PROVIDERS=ollama,groq is enough for the common
// setups; every field can still be overridden per provider through env.
const PRESETS: Record<string, Omit<LlmProvider, "name" | "timeoutMs">> = {
  ollama: {
    kind: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:4b",
  },
  groq: {
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  cerebras: {
    kind: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
  },
  openrouter: {
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
  },
};

function envFor(name: string, suffix: string): string | undefined {
  const key = `LLM_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
  const value = process.env[key]?.trim();
  return value || undefined;
}

function fromPreset(name: string): LlmProvider | null {
  const preset = PRESETS[name.toLowerCase()];
  const baseUrl = envFor(name, "URL") ?? preset?.baseUrl;
  const model = envFor(name, "MODEL") ?? preset?.model;
  if (!baseUrl || !model) {
    console.warn(
      `[llm] provider "${name}" is unknown — set LLM_${name.toUpperCase()}_URL and _MODEL`
    );
    return null;
  }
  const timeout = Number(envFor(name, "TIMEOUT_MS"));
  return {
    name,
    kind: preset?.kind ?? (baseUrl.includes("11434") ? "ollama" : "openai"),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    apiKey: envFor(name, "KEY") ?? preset?.apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

// Accepts either a JSON array of provider objects or a comma-separated list of
// preset names. Exported so the bench can parse its own LLM_BENCH_PROVIDERS.
export function parseProviders(spec: string | undefined): LlmProvider[] {
  const trimmed = spec?.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      console.error("[llm] provider list is not valid JSON — ignoring it");
      return [];
    }
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry, index) => {
      const item = entry as Partial<LlmProvider>;
      if (!item?.baseUrl || !item?.model) {
        console.error(`[llm] provider #${index + 1} needs baseUrl and model`);
        return [];
      }
      return [
        {
          name: item.name ?? `provider${index + 1}`,
          kind: item.kind ?? (item.baseUrl.includes("11434") ? "ollama" : "openai"),
          baseUrl: item.baseUrl.replace(/\/+$/, ""),
          model: item.model,
          apiKey: item.apiKey,
          timeoutMs: item.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
      ];
    });
  }

  return trimmed
    .split(/[,\s]+/)
    .filter(Boolean)
    .flatMap((name) => fromPreset(name) ?? []);
}

export function llmProviders(): LlmProvider[] {
  return parseProviders(process.env.LLM_PROVIDERS);
}

// Providers for ranking, which is one big prompt rather than eight small ones.
// Token budgets are metered per model, so pointing this at a different model
// gives the rerank its own window and it never competes with the annotations.
export function rankProviders(): LlmProvider[] {
  const dedicated = parseProviders(process.env.LLM_RANK_PROVIDERS);
  return dedicated.length > 0 ? dedicated : llmProviders();
}

export function llmConfigured(): boolean {
  return llmProviders().length > 0;
}

// Reasoning models (qwen3 and friends) prepend their scratchpad; the digest
// wants only the answer.
function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

// Several providers geo-block outright (Groq answers 403 from some countries),
// so LLM calls can be routed through a proxy. Node's fetch ignores the
// HTTP_PROXY convention entirely, hence the explicit dispatcher. Only these
// calls are routed — feeds and covers keep going out directly.
function proxyUrl(): string | undefined {
  return (
    process.env.LLM_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    undefined
  );
}

// A proxy is for reaching the outside world. Tunnelling a call to Ollama on
// localhost or the LAN through one would simply break it.
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return host === "host.docker.internal";
}

let agent: ProxyAgent | null = null;
let agentUrl: string | null = null;

function dispatcherFor(baseUrl: string): ProxyAgent | undefined {
  const proxy = proxyUrl();
  if (!proxy) return undefined;
  try {
    if (isLocalHost(new URL(baseUrl).hostname)) return undefined;
  } catch {
    return undefined;
  }
  if (!agent || agentUrl !== proxy) {
    agent = new ProxyAgent(proxy);
    agentUrl = proxy;
    console.log(`[llm] routing provider calls through ${proxy}`);
  }
  return agent;
}

// ------------------------------------------------------------------ pacing
//
// Hosted providers meter tokens per minute, and a digest spends its whole
// budget in one burst — eight annotation calls took 7 890 input tokens in ten
// seconds against Groq's 12 000/min. Rather than walk into a certain 429 and
// fail over, wait for the window to roll.
//
// The budget is read from the provider's own response headers, so nothing has
// to be configured and a plan change is picked up automatically. Providers
// that send no headers (Ollama) can declare LLM_<NAME>_TPM instead, and with
// neither there is simply no pacing.

interface Budget {
  remaining: number;
  resetAt: number;
}

const budgets = new Map<string, Budget>();

const MAX_PACING_WAIT_MS = 70_000;

function budgetKey(provider: LlmProvider): string {
  return `${provider.name}:${provider.model}`;
}

// "185ms" | "7.66s" | "1m26.4s" | "2h30m" → milliseconds.
function parseDuration(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Number(value) * 1000;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit] ?? 0;
    total += Number(amount) * factor;
    matched = true;
  }
  return matched ? total : null;
}

function recordBudget(provider: LlmProvider, response: Response): void {
  const remaining = response.headers.get("x-ratelimit-remaining-tokens");
  const reset = parseDuration(
    response.headers.get("x-ratelimit-reset-tokens")
  );
  if (remaining === null || reset === null) return;
  budgets.set(budgetKey(provider), {
    remaining: Number(remaining),
    resetAt: Date.now() + reset,
  });
}

function staticTpm(provider: LlmProvider): number | null {
  const raw = Number(envFor(provider.name, "TPM"));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

// Wait, if the next call plainly does not fit in what is left of the window.
async function pace(provider: LlmProvider, needed: number): Promise<void> {
  const budget = budgets.get(budgetKey(provider));
  if (!budget) {
    // No observed budget yet. A declared TPM still catches the case where one
    // prompt alone is larger than a whole window.
    const tpm = staticTpm(provider);
    if (tpm && needed > tpm) {
      console.warn(
        `[llm] ${provider.name}: prompt needs ~${needed} tokens but the limit is ${tpm}/min`
      );
    }
    return;
  }
  const waitMs = budget.resetAt - Date.now();
  if (budget.remaining >= needed || waitMs <= 0) return;
  const sleepMs = Math.min(waitMs, MAX_PACING_WAIT_MS);
  console.log(
    `[llm] ${provider.name}: ${budget.remaining} tokens left, need ~${needed} — waiting ${Math.ceil(sleepMs / 1000)}s`
  );
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
  budgets.delete(budgetKey(provider));
}

export interface LlmAttempt {
  result: LlmResult | null;
  // Why it failed. Purely for the log line and the bench's error column —
  // every failure moves on to the next provider.
  reason?: string;
}

async function callProvider(
  provider: LlmProvider,
  system: string,
  user: string,
  maxTokens: number
): Promise<LlmAttempt> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    stream: false,
  };
  // Keeps the weights resident between the five calls of one digest. Only
  // Ollama understands it; sending it elsewhere risks a 400.
  if (provider.kind === "ollama") body.keep_alive = "5m";

  await pace(provider, estimateTokens(system + user) + maxTokens);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey
          ? { Authorization: `Bearer ${provider.apiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(provider.timeoutMs),
      // Not in the DOM RequestInit, but undici — which backs Node's fetch —
      // reads it.
      dispatcher: dispatcherFor(provider.baseUrl),
    } as RequestInit & { dispatcher?: ProxyAgent });
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      result: null,
      reason: name === "TimeoutError" ? "timeout" : `network (${name})`,
    };
  }

  recordBudget(provider, response);

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    if (response.status === 429) {
      // Believe Retry-After over our own bookkeeping — we evidently got it
      // wrong, and the next attempt should not repeat the mistake.
      const retry = parseDuration(response.headers.get("retry-after"));
      if (retry !== null) {
        budgets.set(budgetKey(provider), {
          remaining: 0,
          resetAt: Date.now() + retry,
        });
      }
    }
    // 429 and 5xx are transient; anything else is almost always a bad key,
    // a wrong URL or a model name the provider doesn't serve.
    if (response.status !== 429 && response.status < 500) {
      console.error(
        `[llm] ${provider.name} rejected the request: ${response.status} ${detail}`
      );
    }
    return { result: null, reason: `HTTP ${response.status}` };
  }

  let payload: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    payload = await response.json();
  } catch {
    return { result: null, reason: "unparseable response" };
  }

  const text = stripReasoning(payload.choices?.[0]?.message?.content ?? "");
  if (!text) return { result: null, reason: "empty completion" };

  const ms = Date.now() - startedAt;
  const promptTokens =
    payload.usage?.prompt_tokens ?? estimateTokens(system + user);
  const completionTokens =
    payload.usage?.completion_tokens ?? estimateTokens(text);
  console.log(
    `[llm] ${provider.name} ${provider.model} in=${promptTokens} out=${completionTokens} ${ms}ms`
  );
  return {
    result: {
      text,
      provider: provider.name,
      model: provider.model,
      promptTokens,
      completionTokens,
      ms,
    },
  };
}

// One call at a time, process-wide: the default target is a 4-core box running
// Ollama, where concurrent generations only make each other slower.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

// Walks the configured providers in order and returns the first completion.
// null means every provider failed (or none is configured) — the caller is
// expected to have a non-LLM fallback.
export function complete(
  system: string,
  user: string,
  maxTokens = 400,
  from: LlmProvider[] = llmProviders()
): Promise<LlmResult | null> {
  return serialize(async () => {
    const providers = from;
    for (const provider of providers) {
      const attempt = await callProvider(provider, system, user, maxTokens);
      if (attempt.result) return attempt.result;
      console.warn(
        `[llm] ${provider.name} failed (${attempt.reason}) — trying the next provider`
      );
    }
    if (providers.length > 0) {
      console.warn("[llm] every provider failed; falling back to extractive text");
    }
    return null;
  });
}

// Same call, but against one explicit provider and without the failover — the
// bench needs to attribute every timing to the config that produced it.
export function completeWith(
  provider: LlmProvider,
  system: string,
  user: string,
  maxTokens = 400
): Promise<LlmAttempt> {
  return serialize(() => callProvider(provider, system, user, maxTokens));
}
