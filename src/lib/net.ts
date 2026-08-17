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

// A connection that never completed — as opposed to a server that answered
// with 403 or 404, which is a real answer and not worth retrying elsewhere.
function isTransportFailure(error: unknown): boolean {
  const name = (error as Error)?.name;
  return name !== "TimeoutError" && name !== "AbortError";
}

export async function fetchMaybeProxied(
  url: string,
  init: RequestInit
): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const proxy = dispatcher();
    if (!proxy || !isTransportFailure(error)) return null;
    try {
      return await fetch(url, {
        ...init,
        dispatcher: proxy,
      } as RequestInit & { dispatcher?: ProxyAgent });
    } catch {
      return null;
    }
  }
}
