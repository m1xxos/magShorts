<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- <!-- END:nextjs-agent-rules -->

# Investigation: Article Extraction and Paywall/WAF Bypass (The Atlantic)

## Problem Context
We investigated and compared the article extraction mechanisms in `magShorts` against the read-it-later tool **Readeck** (`codeberg.org/readeck/readeck`) to evaluate how paywalls and anti-bot restrictions can be bypassed, specifically focusing on *The Atlantic*.

## What Was Tested and Investigated

1. **Readeck Codebase Analysis (`pkg/extract`, `internal/httpclient`)**:
   - Readeck provides site selectors in `pkg/extract/contentscripts/assets/site-config/theatlantic.com.json` (FiveFilters rules for isolating the `article` container and stripping ad units).
   - Readeck implements a Go HTTP client mimicking Chrome's TLS fingerprint (RFC 8701 GREASE ciphers, Chrome CipherSuites, `Sec-CH-UA` Client Hints).
   - **Test**: We compiled Readeck's HTTP client and performed an outbound request to `theatlantic.com`.
   - **Result**: **`HTTP 403 Forbidden` (`error code: 1020` from Cloudflare)**. The server-side component of Readeck **cannot** fetch The Atlantic directly. In Readeck, such sites are saved exclusively via its client-side **Browser Extension**, which captures the pre-rendered DOM directly from the user's authenticated browser tab and uploads it to the server.

2. **Direct Server-Side Extraction Attempts for The Atlantic in magShorts**:
   - *Direct HTTP requests (Node.js fetch / undici / curl)*: Blocked by Cloudflare WAF with `403 Forbidden`.
   - *User-Agent spoofing (Googlebot, Chrome 133/144)*: Blocked (Cloudflare validates reverse DNS for Googlebot and checks TLS fingerprints).
   - *Proxying (`FEED_PROXY_URL`)*: Blocked with `403` (filtering occurs at Cloudflare edge, not at local network level).
   - *Headless Chrome (`--headless --dump-dom`)*: The page renders a security block stub: *"Our site’s security protections triggered a block... Cloudflare Ray ID"*.
   - *Unlock service (Marreta `marreta.link`)*: Returns access error / NOT_FOUND.
   - *Archive mirrors (Wayback Machine / archive.ph)*: Wayback Machine frequently archives Cloudflare error pages (HTTP `402`) for recent Atlantic articles. `archive.ph` hits a Cloudflare CAPTCHA from server IPs.

3. **Current Working Mechanism in magShorts (RSS Feed Fallback)**:
   - The Atlantic broadcasts the **full text of articles (100% complete body)** in its RSS feed (`https://www.theatlantic.com/feed/all/`, inside `<content:encoded>`). Word-by-word comparison with the archived article confirmed parity (859 words in the feed vs 870 words on the site, with the only difference being 11 words of subtitle and copyright byline).
   - In [src/lib/extract.ts](src/lib/extract.ts), step 3 (`fromFeed`) automatically retrieves the complete text from the feed when direct page fetching fails.

## Why the Extracted Result Looked "Like Text from RSS"
1. **Missing `<h2>` tags**: The Atlantic's feed generator strips `<h2>` tags and renders subheadings as regular italics (`<p><em>...</em></p>`). As a result, the parser finds no headings, leaving the reader's outline table of contents (`ReaderOutline`) empty.
2. **Missing standfirst / lead**: The article subtitle is stored in the `summary` field but is not injected into the start of the body as a lead paragraph.
3. **Older articles in the database**: The feed only contains the latest ~25 items. For older articles, the database previously held a truncated plain-text teaser capped at 6,000 characters (`CONTENT_MAX_LENGTH` in [src/lib/rss.ts](src/lib/rss.ts)).

## Recommendations for Future Agents (Next Steps)

1. **Semantic Feed Upgrader (Recommended for autonomy)**:
   - In `feedBody()` in [src/lib/extract.ts](src/lib/extract.ts), add an heuristic: if an article body lacks `<h2>` tags, inspect short paragraphs (`<p><em>...</em></p>` / `<p><strong>...</strong></p>` under 80 characters without ending periods) and promote them to `<h2>`. This will automatically generate a table of contents in `ReaderOutline`.
   - Prepend `article.summary` to the body as an accented lead paragraph (`<p class="lead font-serif text-lg text-muted">`).
   - This delivers 100% full text and a magazine-quality layout with 0 network requests and 0 risk of Cloudflare blocks.

2. **Client-Side Capture (Readeck model)**:
   - Create an endpoint `POST /api/articles/capture` and a browser bookmarklet. Users can send the rendered DOM of any active tab (including paywalled sites where they are logged in) directly to magShorts with 1 click.

3. **Direct Server-Side Cloudflare Bypass (if full site scrape is required)**:
   - Requires integrating FlareSolverr, `curl-impersonate`, or Playwright with `playwright-extra` + `puppeteer-extra-plugin-stealth` and residential proxy rotation, as standard headless browsers are immediately detected by Cloudflare.


