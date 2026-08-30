import { ProxyAgent } from "undici";

// Outbound fetching for feeds and article pages.
//
// Some publications are unreachable from a given network — not 403, but a
// refused connection: Defector, Rest of World and MIT Technology Review all
// behave that way from here, while answering normally through a proxy. Node's
// fetch ignores the HTTP_PROXY convention, so nothing about the environment
// helps on its own.
//
// The rule is direct first, proxy only on failure. A working connection never
// pays for the proxy, nothing is routed through it that doesn't have to be,
// and with no proxy configured the behaviour is exactly what it was before.
//
// "Failure" includes timing out. It did not at first, on the theory that a
// timeout is the host's answer — but a filtered network does not refuse a
// connection, it drops the packets, and dropped packets look exactly like a
// slow site. Measured here: kottke.org, pluralistic.net and granta.com all
// hang past twelve seconds direct and answer in two through the proxy. An
// HTTP error is a real answer and still never retried, because fetch resolves
// those rather than throwing.

let agent: ProxyAgent | null = null;
let agentUrl: string | null = null;

export function proxyUrl(): string | undefined {
  return (
    process.env.FEED_PROXY_URL?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    undefined
  );
}

function dispatcher(): ProxyAgent | undefined {
  const url = proxyUrl();
  if (!url) return undefined;
  if (!agent || agentUrl !== url) {
    agent = new ProxyAgent(url);
    agentUrl = url;
  }
  return agent;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ProxiedFetch {
  headers?: Record<string, string>;
  redirect?: RequestInit["redirect"];
  timeoutMs?: number;
}

export interface FetchedText {
  text: string;
  // Where the response actually came from, after redirects.
  url: string;
}

// Hosts that have already needed the proxy once in this process. Discovering
// a feed probes up to a dozen well-known paths on the same host, and paying
// the full direct timeout on each before falling back turns one unreachable
// publication into minutes of waiting. Remembered per process, not stored: a
// restart re-learns it in one request, and a network that has since been
// fixed is never held against.
const preferProxy = new Set<string>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// The body is read here rather than by the caller, and that is the point: a
// filtered connection often completes its headers and then stalls, so a
// Response handed back intact would strand the caller mid-body with a spent
// timeout and no way to retry. Reading inside means a stalled body is just
// another failure, and the proxy attempt covers it.
async function once(
  url: string,
  init: RequestInit,
  proxy?: ProxyAgent
): Promise<FetchedText | null> {
  const response = await fetch(url, {
    ...init,
    ...(proxy ? { dispatcher: proxy } : {}),
  } as RequestInit & { dispatcher?: ProxyAgent });
  // A status is a real answer: 403 and 404 mean the same through any route,
  // so they end the attempt rather than triggering the fallback.
  if (!response.ok) return null;
  return { text: await response.text(), url: response.url };
}

// The same rule, for bytes.
//
// Images need it more than feeds do, not less: a cover that will not load is
// the most visible kind of failure this app has, and the CDNs are exactly
// where a filtered network bites. Measured from the server: every
// cdn.theatlantic.com address its resolver hands back drops the connection,
// while the same file arrives through the proxy in a little over a second.
//
// The size cap is checked twice — once against Content-Length, so an absurd
// file is refused before it is pulled, and once against what actually
// arrived, because the header is a claim rather than a promise.
export interface FetchedBinary {
  buffer: Buffer;
  contentType: string;
  url: string;
}

export interface ProxiedBinaryFetch extends ProxiedFetch {
  maxBytes?: number;
}

async function onceBinary(
  url: string,
  init: RequestInit,
  maxBytes: number,
  proxy?: ProxyAgent
): Promise<FetchedBinary | null> {
  const response = await fetch(url, {
    ...init,
    ...(proxy ? { dispatcher: proxy } : {}),
  } as RequestInit & { dispatcher?: ProxyAgent });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
  return {
    buffer,
    contentType: response.headers.get("content-type") ?? "",
    url: response.url,
  };
}

export async function fetchBinaryMaybeProxied(
  url: string,
  options: ProxiedBinaryFetch = {}
): Promise<FetchedBinary | null> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = Number.MAX_SAFE_INTEGER,
    ...rest
  } = options;
  const proxy = dispatcher();
  const host = hostOf(url);
  const proxyFirst = proxy !== undefined && preferProxy.has(host);
  const init = () => ({ ...rest, signal: AbortSignal.timeout(timeoutMs) });

  try {
    return await onceBinary(url, init(), maxBytes, proxyFirst ? proxy : undefined);
  } catch (error) {
    if (!proxy) {
      console.warn(`[net] ${host}: ${reason(error)}, and no proxy is configured`);
      return null;
    }
    try {
      const result = await onceBinary(
        url,
        init(),
        maxBytes,
        proxyFirst ? undefined : proxy
      );
      // Learned once, for every other picture from the same CDN. An article
      // with twenty covers on a blocked host would otherwise pay the full
      // direct timeout twenty times over.
      if (result && !proxyFirst) {
        preferProxy.add(host);
        console.log(`[net] ${host} answered through the proxy (direct: ${reason(error)})`);
      }
      if (!result) {
        console.warn(`[net] ${host}: direct ${reason(error)}, proxy returned nothing`);
      }
      return result;
    } catch (viaProxy) {
      console.warn(`[net] ${host}: direct ${reason(error)}, proxy ${reason(viaProxy)}`);
      return null;
    }
  }
}

// Why an attempt failed, in the few words a log line can carry. undici puts
// the useful part in `cause`; the message on its own is always "fetch failed".
function reason(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  return (
    cause?.code ??
    cause?.message ??
    (error as { name?: string }).name ??
    String(error)
  );
}

// Fetch a text document, falling back to the proxy when the direct route
// fails. Returns null for anything that isn't a 2xx with a readable body.
export async function fetchTextMaybeProxied(
  url: string,
  options: ProxiedFetch = {}
): Promise<FetchedText | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  const proxy = dispatcher();
  const host = hostOf(url);
  const proxyFirst = proxy !== undefined && preferProxy.has(host);
  // Each attempt is armed with its own timeout. A caller-built
  // AbortSignal.timeout would already have fired by the time the direct
  // attempt gave up, so the retry would abort before it opened a socket —
  // which is to say the fallback would never work in the case it exists for.
  const init = () => ({ ...rest, signal: AbortSignal.timeout(timeoutMs) });

  try {
    return await once(url, init(), proxyFirst ? proxy : undefined);
  } catch {
    if (!proxy) return null;
    try {
      const result = await once(url, init(), proxyFirst ? undefined : proxy);
      if (result && !proxyFirst) preferProxy.add(host);
      return result;
    } catch {
      return null;
    }
  }
}
