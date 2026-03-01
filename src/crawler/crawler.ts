/**
 * CrawlerService — the top-level orchestrator for a documentation crawl.
 *
 * A crawl has two broad phases:
 *
 *   1. Discovery  — figure out *which* URLs to visit, as cheaply as possible,
 *                   before firing up any browser tabs.
 *   2. Processing — for each URL, render the page, reveal hidden content,
 *                   extract HTML, and convert it to clean Markdown.
 *
 * Both phases run concurrently: up to `concurrency` (default 5) pages are
 * processed in parallel, sharing a single headless Chromium instance managed
 * by BrowserService.
 *
 * Data flow:
 *   CrawlerService
 *     → DiscoveryService  (sitemap → initial URL list)
 *     → BrowserService    (render each URL with Playwright)
 *     → WalkerService     (extract links from rendered page)
 *     → TransformerService (HTML → Markdown)
 *     → CrawlResult[]
 */

import { TransformerService } from '../transformer/html-to-markdown.js';
import { BrowserService } from './browser.js';
import { DiscoveryService } from './discovery.js';
import { WalkerService } from './walker.js';

/** Options for a single crawl run. */
export interface CrawlOptions {
  /** The root URL to start from (e.g. "https://mswjs.io/docs"). */
  url: string;
  /**
   * Follow links discovered on each page.
   * Set to false to only process the root URL (useful for quick previews).
   * Defaults to true.
   */
  recursive?: boolean;
  /** Not currently enforced — reserved for depth-limited crawls. */
  maxDepth?: number;
  /**
   * Number of pages to process simultaneously.
   * Higher values are faster but use more memory and can trigger rate-limits.
   * Defaults to 5.
   */
  concurrency?: number;
  /** Stop after visiting this many pages (useful for large doc sites during testing). */
  limit?: number;
}

/** The normalized output for a single crawled page. */
export interface CrawlResult {
  /** The original URL of the page. */
  url: string;
  /**
   * The relative file path this page should be stored at, derived from the
   * URL pathname (e.g. "api/handlers.md").
   */
  path: string;
  /** The page's full content converted to Markdown. */
  content: string;
  /** The page's `<title>` or extracted heading, used for search indexing. */
  title: string;
}

export class CrawlerService {
  private browser = new BrowserService();
  private transformer = new TransformerService();
  private walker = new WalkerService();
  private discovery = new DiscoveryService();

  async crawl(options: CrawlOptions): Promise<CrawlResult[]> {
    const { url, recursive, concurrency = 5, limit } = options;
    const results: CrawlResult[] = [];

    // Track visited URLs so we never process the same page twice, even if
    // multiple workers discover the same link at the same time.
    const visited = new Set<string>();
    const queue: string[] = [url];

    try {
      // Boot a single headless Chromium instance shared across all workers.
      // Launching a browser is expensive (~1 second), so we do it once here
      // rather than per-page.
      await this.browser.init();

      // -----------------------------------------------------------------------
      // Phase 1: Sitemap Discovery
      //
      // Before loading a single page with Playwright, we try to fetch the
      // site's sitemap. Sitemaps are plain XML files that list every URL the
      // site wants indexed — loading one HTTP request can give us hundreds of
      // URLs for free, skipping a lot of in-browser link-following overhead.
      //
      // After fetching, we scope the results to URLs that share the same
      // origin *and* path prefix as the root URL — so crawling
      // "https://mswjs.io/docs" won't accidentally pull in "/blog" pages.
      // -----------------------------------------------------------------------
      const sitemapUrls = await this.discovery.discoverFromSitemaps(url);

      const root = new URL(url);

      // Compute the "scope prefix" — the directory portion of the root path.
      // e.g. "/docs/api/handlers" → "/docs/api/" (parent dir)
      //       "/docs/"            → "/docs/"       (already a directory)
      let scopePrefix = root.pathname;
      if (!scopePrefix.endsWith('/')) {
        const parts = scopePrefix.split('/');
        if (parts.length > 1) {
          parts.pop();
          scopePrefix = parts.join('/') + '/';
        }
      }

      for (const u of sitemapUrls) {
        try {
          const discovered = new URL(u);
          if (discovered.origin === root.origin && discovered.pathname.startsWith(scopePrefix)) {
            if (!visited.has(u)) queue.push(u);
          }
        } catch (e) {
          // Skip malformed URLs in the sitemap
        }
      }

      // -----------------------------------------------------------------------
      // Phase 2: Parallel Worker Loop
      //
      // We spin up `concurrency` async workers that all drain the same queue.
      // This is a lightweight alternative to a real worker pool: each async
      // function grabs the next URL, processes it (awaiting I/O), then loops.
      // Because JS is single-threaded, there's no data-race on `queue` or
      // `visited` — but we still get concurrency from overlapping I/O waits
      // (network, browser rendering, etc.).
      // -----------------------------------------------------------------------
      const processQueue = async () => {
        while (queue.length > 0) {
          if (limit && visited.size >= limit) break;

          const currentUrl = queue.shift();
          if (!currentUrl || visited.has(currentUrl)) continue;
          visited.add(currentUrl);

          console.warn(`Crawling [${visited.size}/${limit || queue.length + visited.size}]: ${currentUrl}...`);

          try {
            // Open a new browser tab, navigate, and wait for the page to fully
            // settle (network idle + DOM ready). SPA frameworks like Next.js or
            // Docusaurus hydrate after the initial HTML arrives, so we need to
            // wait for them to finish before reading the DOM.
            const page = await this.browser.getPage(currentUrl);

            // Click through any tab panels / disclosure widgets so their
            // content is in the DOM before we extract HTML. Frameworks like
            // Docusaurus hide tab content in inactive panes by default.
            await this.browser.revealAllContent(page);

            const html = await page.content();
            const result = await this.transformer.transform(html, currentUrl);

            // Derive a stable relative file path from the URL's pathname.
            // A trailing slash becomes an implicit "index" — this keeps paths
            // consistent regardless of whether the server redirects /docs/ → /docs/index.
            const urlObj = new URL(currentUrl);
            const relativePath = urlObj.pathname.replace(/\/$/, '') || 'index';

            results.push({
              url: currentUrl,
              // Strip a leading slash before appending .md
              path: `${relativePath.startsWith('/') ? relativePath.slice(1) : relativePath}.md`,
              content: result.markdown,
              title: result.title,
            });

            // After processing a page, extract its links and add any new
            // same-scope URLs to the queue for the workers to pick up.
            if (recursive) {
              const discovered = await this.walker.discoverUrls(page, { rootUrl: url });
              for (const d of discovered) {
                if (!visited.has(d)) queue.push(d);
              }
            }

            await page.close();
          } catch (e) {
            console.error(`Failed to crawl ${currentUrl}:`, e);
          }
        }
      };

      // Start all workers simultaneously; they all share the same queue and
      // race to process URLs. Promise.all waits until every worker exits
      // (i.e. the queue is empty or the limit is hit).
      const workers = Array.from({ length: concurrency }, () => processQueue());
      await Promise.all(workers);

      return results;
    } finally {
      // Always close the browser, even if crawling threw an error — otherwise
      // the Chromium process will linger in the background.
      await this.browser.close();
    }
  }
}
