# Crawler System

The crawler is responsible for turning a documentation URL into a list of clean Markdown pages. It is composed of four services that each own a distinct part of the problem.

## Services

| File | Responsibility |
|---|---|
| `crawler.ts` | Orchestrates the full crawl: discovery → rendering → transformation |
| `browser.ts` | Playwright lifecycle management and SPA content revealing |
| `walker.ts` | Link extraction and scope-based URL filtering from rendered pages |
| `discovery.ts` | Pre-crawl URL discovery via sitemaps and robots.txt |

## The Crawl Pipeline

### 1. Pre-crawl Discovery (DiscoveryService)

Before any browser tab opens, Diamond tries to get a head start on the URL list by reading the site's sitemap. A sitemap is an XML file listing every page the site wants indexed — loading one HTTP request can return hundreds of URLs.

Discovery strategy (in order):
1. Fetch `/sitemap.xml` and `/sitemap_index.xml` from the root origin
2. Parse `robots.txt` for `Sitemap:` directives (sites sometimes use custom paths)
3. Parse all found sitemaps, recursing into sitemap index files

Both `<urlset>` (standard: lists pages) and `<sitemapindex>` (lists other sitemaps) formats are supported.

**Scope filtering** happens after discovery, in `CrawlerService`: only URLs sharing the same origin and path prefix as the root URL are queued.

### 2. Parallel Processing (CrawlerService)

The main crawl loop runs `concurrency` (default: 5) async workers draining a shared queue. This is a simple but effective concurrency model for I/O-heavy work:

```
queue = [rootUrl, ...sitemapUrls]
visited = Set()

worker (×5):
  while queue not empty:
    url = queue.shift()
    if visited.has(url): continue
    visited.add(url)
    page = browser.getPage(url)        ← async: network + render time
    browser.revealAllContent(page)     ← click tab panels
    html = page.content()
    result = transformer.transform(html, url)
    discovered = walker.discoverUrls(page)
    queue.push(...discovered)
    page.close()
```

Because JavaScript is single-threaded, there are no data races on `queue` or `visited`. Concurrency comes from overlapping `await` calls — while one worker waits for a page to render, others process different pages.

### 3. Browser Rendering (BrowserService)

Diamond uses Playwright with headless Chromium. A single browser instance is shared across all workers to amortize the ~1 second startup cost.

For each page, Diamond waits for:
- `networkidle` — no more than 2 in-flight requests for 500ms. This catches SPA hydration (React, Vue, etc.) which fires fetch/XHR calls on mount.
- `domcontentloaded` — belt-and-suspenders: initial HTML parsed.

**Revealing hidden content**: Documentation frameworks like Docusaurus render tab panels where only the active tab's content is in the DOM. Diamond clicks through all unselected tab elements before extracting HTML, so the full content (e.g. both the JS and TS variants of a code example) is captured.

Selectors used for tab detection:
- `[role="tab"]` — ARIA standard
- `.tabs__item` — Docusaurus
- `button[class*="tabs"]` — generic
- `.tab-item` — Starlight and others

### 4. Link Extraction (WalkerService)

After a page is processed, Diamond extracts links to add to the queue. Links are filtered to:
1. **Same origin** — no external sites
2. **Same path prefix** — derived from the root URL's parent directory

For example, crawling `https://mswjs.io/docs/api/handlers` would set a scope prefix of `/docs/api/`, limiting the crawl to pages under that path. Crawling `https://mswjs.io/docs/` would scope to `/docs/`.

Links are extracted using Playwright's `$$eval` inside the browser context — this gives resolved absolute URLs rather than raw attribute strings, handling relative paths automatically.

URLs are normalized before queuing: trailing slashes and hash fragments are removed so `/docs/api/` and `/docs/api` don't both get crawled.

### 5. HTML → Markdown (TransformerService)

A two-stage pipeline:

**Stage 1 — Readability (noise removal)**
Mozilla Readability (the Firefox Reader View engine) identifies the main content area of the page and strips everything else: navbars, sidebars, footers, cookie banners, script tags. It uses text-density and element-size heuristics, not CSS selectors — so it works across different documentation frameworks without any site-specific configuration.

**Stage 2 — dom-to-semantic-markdown (conversion)**
The clean HTML from Readability is passed to dom-to-semantic-markdown, which converts it to Markdown while preserving semantic structure: code blocks with language tags, tables, headings, and inline formatting. This produces significantly better LLM-readable output than generic HTML-to-text converters.

Both libraries operate on JSDOM (a Node.js DOM implementation), not on strings. This is why the output is consistent and correct — they query element properties rather than parsing tag text.

## Version Detection

`DiscoveryService.resolveVersion()` tries to extract a version string after crawling:

1. Check the URL for semver patterns: `/v0.21.0/` or `/0.21.0/`
2. Check HTML meta tags: `<meta name="version">` or `<meta name="docsearch:version">`

If no version is found, the library is stored under "latest".

## Output Shape

Each crawled page produces a `CrawlResult`:

```typescript
{
  url: "https://mswjs.io/docs/api/handlers",
  path: "api/handlers.md",            // relative path derived from URL pathname
  content: "# Handlers\n\n...",       // Markdown from TransformerService
  title: "Handlers — Mock Service Worker",
}
```

The `path` field is used as both the storage path and the search document ID.
