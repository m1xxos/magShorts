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
    });
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      result: null,
      reason: name === "TimeoutError" ? "timeout" : `network (${name})`,
    };
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
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
  maxTokens = 400
): Promise<LlmResult | null> {
  return serialize(async () => {
    const providers = llmProviders();
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
