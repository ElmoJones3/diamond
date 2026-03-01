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

import { BrowserService } from '#src/crawler/browser.js';
import { DiscoveryService } from '#src/crawler/discovery.js';
import { WalkerService } from '#src/crawler/walker.js';
import { TransformerService } from '#src/transformer/html-to-markdown.js';

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

interface RobotsParser {
  isAllowed(url: string, userAgent: string): boolean;
  getSitemaps(): string[];
}

export class CrawlerService {
  private browser = new BrowserService();
  private transformer = new TransformerService();
  private walker = new WalkerService();
  private discovery = new DiscoveryService();

  async crawl(options: CrawlOptions): Promise<CrawlResult[]> {
    const { url, recursive, concurrency = 5, limit } = options;
    const results: CrawlResult[] = [];
    const visited = new Set<string>();
    const queue: string[] = [url];

    try {
      await this.browser.init();
      const robots = await this.discovery.getRobotsParser(url);
      const userAgent = 'DiamondCrawler';

      // Phase 1: Sitemap Discovery
      const sitemapUrls = await this.discovery.discoverFromSitemaps(url);
      const root = new URL(url);
      let scopePrefix = root.pathname;
      if (!scopePrefix.endsWith('/')) {
        const parts = scopePrefix.split('/');
        if (parts.length > 1) {
          parts.pop();
          scopePrefix = `${parts.join('/')}/`;
        }
      }

      for (const u of sitemapUrls) {
        try {
          const discovered = new URL(u);
          if (discovered.origin === root.origin && discovered.pathname.startsWith(scopePrefix)) {
            const normalized = discovered.origin + discovered.pathname.replace(/\/$/, '');
            if (robots.isAllowed(normalized, userAgent) && !visited.has(normalized)) {
              queue.push(normalized);
            }
          }
        } catch (_e) {
          /* Skip malformed */
        }
      }

      // Phase 2: Parallel Worker Loop
      const workers = Array.from({ length: concurrency }, () =>
        this.runWorker({
          queue,
          visited,
          limit,
          robots,
          userAgent,
          url,
          recursive,
          results,
        }),
      );
      await Promise.all(workers);

      return results;
    } finally {
      await this.browser.close();
    }
  }

  private async runWorker(context: {
    queue: string[];
    visited: Set<string>;
    limit?: number;
    robots: RobotsParser;
    userAgent: string;
    url: string;
    recursive?: boolean;
    results: CrawlResult[];
  }) {
    while (context.queue.length > 0) {
      if (context.limit && context.visited.size >= context.limit) break;

      const currentUrl = context.queue.shift();
      if (!currentUrl || context.visited.has(currentUrl)) continue;

      if (!context.robots.isAllowed(currentUrl, context.userAgent)) {
        console.warn(`Skipping disallowed URL: ${currentUrl}`);
        continue;
      }

      context.visited.add(currentUrl);
      console.warn(
        `Crawling [${context.visited.size}/${context.limit || context.queue.length + context.visited.size}]: ${currentUrl}...`,
      );

      try {
        const result = await this.crawlSinglePage(currentUrl, {
          recursive: context.recursive,
          rootUrl: context.url,
          robots: context.robots,
          userAgent: context.userAgent,
          queue: context.queue,
          visited: context.visited,
        });
        if (result) context.results.push(result);
      } catch (e) {
        console.error(`Failed to crawl ${currentUrl}:`, e);
      }
    }
  }

  /**
   * Processes a single page: renders, transforms to Markdown, and discovers new links.
   */
  private async crawlSinglePage(
    currentUrl: string,
    context: {
      recursive?: boolean;
      rootUrl: string;
      robots: RobotsParser;
      userAgent: string;
      queue: string[];
      visited: Set<string>;
    },
  ): Promise<CrawlResult | null> {
    const page = await this.browser.getPage(currentUrl);
    await this.browser.revealAllContent(page);

    const html = await page.content();
    const result = await this.transformer.transform(html, currentUrl);

    const urlObj = new URL(currentUrl);
    const relativePath = urlObj.pathname.replace(/\/$/, '') || 'index';

    if (context.recursive) {
      const discovered = await this.walker.discoverUrls(page, { rootUrl: context.rootUrl });
      for (const d of discovered) {
        if (context.robots.isAllowed(d, context.userAgent) && !context.visited.has(d)) {
          context.queue.push(d);
        }
      }
    }

    await page.close();

    return {
      url: currentUrl,
      path: `${relativePath.startsWith('/') ? relativePath.slice(1) : relativePath}.md`,
      content: result.markdown,
      title: result.title,
    };
  }
}
