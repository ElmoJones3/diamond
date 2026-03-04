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
import { getLogger } from '#src/logger.js';
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
  /**
   * Skip robots.txt enforcement entirely.
   * Some sites (e.g. TanStack) disallow crawlers in robots.txt but are fine
   * with personal, offline use. Set this to true to proceed regardless.
   */
  ignoreRobots?: boolean;
  /** Optional correlation ID for log tracing across a sync pipeline run. */
  correlationId?: string;
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
    const { url, recursive, concurrency = 10, limit, ignoreRobots, correlationId } = options;
    const log = getLogger().child({ component: 'crawler:CrawlerService', correlationId });
    const results: CrawlResult[] = [];
    const visited = new Set<string>();
    const queue: string[] = [url];
    const startTime = Date.now();

    log.info({ url, concurrency, recursive, limit }, 'crawl:start');

    try {
      await this.browser.init();
      const robots = ignoreRobots
        ? { isAllowed: () => true, getSitemaps: () => [] }
        : await this.discovery.getRobotsParser(url);
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

      // Phase 2: Batch-parallel crawl loop.
      //
      // The previous worker-pool approach had a race condition: all workers
      // start simultaneously but the queue only has 1 URL at that point, so
      // (concurrency - 1) workers see an empty queue and exit immediately,
      // leaving a single worker processing everything serially.
      //
      // This batch loop fixes that: we dequeue up to `concurrency` URLs,
      // mark them visited, fire them all in parallel, collect any newly
      // discovered links into the queue, then repeat — guaranteeing full
      // concurrency at every step.
      while (queue.length > 0 && !(limit && visited.size >= limit)) {
        const batch: string[] = [];
        while (batch.length < concurrency && queue.length > 0) {
          if (limit && visited.size + batch.length >= limit) break;
          const next = queue.shift()!;
          if (visited.has(next) || !robots.isAllowed(next, userAgent)) continue;
          visited.add(next);
          batch.push(next);
        }

        if (batch.length === 0) break;

        log.debug({ batchSize: batch.length, visited: visited.size, queued: queue.length }, 'crawl:batch');

        const batchResults = await Promise.all(
          batch.map((u) =>
            this.crawlSinglePage(u, {
              recursive,
              rootUrl: url,
              robots,
              userAgent,
              queue,
              visited,
              correlationId,
            }).catch((e) => {
              log.warn({ url: u, err: e }, 'crawl:page_fail');
              return null;
            }),
          ),
        );

        for (const r of batchResults) {
          if (r) results.push(r);
        }
      }

      const duration_ms = Date.now() - startTime;
      log.info({ pagesVisited: visited.size, duration_ms }, 'crawl:complete');

      return results;
    } finally {
      await this.browser.close();
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
      correlationId?: string;
    },
  ): Promise<CrawlResult | null> {
    const log = getLogger().child({ component: 'crawler:CrawlerService', correlationId: context.correlationId });

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

    log.debug({ url: currentUrl, markdownBytes: result.markdown.length }, 'crawl:page_ok');

    return {
      url: currentUrl,
      path: `${relativePath.startsWith('/') ? relativePath.slice(1) : relativePath}.md`,
      content: result.markdown,
      title: result.title,
    };
  }
}
