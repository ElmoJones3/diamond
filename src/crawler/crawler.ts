import { TransformerService } from '../transformer/html-to-markdown.js';
import { BrowserService } from './browser.js';
import { DiscoveryService } from './discovery.js';
import { WalkerService } from './walker.js';

export interface CrawlOptions {
  url: string;
  recursive?: boolean;
  maxDepth?: number;
  concurrency?: number;
  limit?: number;
}

export interface CrawlResult {
  url: string;
  path: string;
  content: string;
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
    const visited = new Set<string>();
    const queue: string[] = [url];

    try {
      await this.browser.init();

      // 1. Initial Discovery (Sitemaps)
      const sitemapUrls = await this.discovery.discoverFromSitemaps(url);

      const root = new URL(url);
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
        } catch (e) {}
      }

      // 2. Parallel Worker Loop
      const processQueue = async () => {
        while (queue.length > 0) {
          if (limit && visited.size >= limit) break;

          const currentUrl = queue.shift();
          if (!currentUrl || visited.has(currentUrl)) continue;
          visited.add(currentUrl);

          console.warn(`Crawling [${visited.size}/${limit || queue.length + visited.size}]: ${currentUrl}...`);

          try {
            const page = await this.browser.getPage(currentUrl);
            await this.browser.revealAllContent(page);

            const html = await page.content();
            const result = await this.transformer.transform(html, currentUrl);

            const urlObj = new URL(currentUrl);
            const relativePath = urlObj.pathname.replace(/\/$/, '') || 'index';

            results.push({
              url: currentUrl,
              path: `${relativePath.startsWith('/') ? relativePath.slice(1) : relativePath}.md`,
              content: result.markdown,
              title: result.title,
            });

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

      const workers = Array.from({ length: concurrency }, () => processQueue());
      await Promise.all(workers);

      return results;
    } finally {
      await this.browser.close();
    }
  }
}
