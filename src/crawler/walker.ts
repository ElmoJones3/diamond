/**
 * WalkerService — link extraction from a rendered page.
 *
 * After a page is fully rendered by Playwright, the Walker's job is to find
 * all the links on that page and decide which ones are worth adding to the
 * crawl queue. It applies three filters in order:
 *
 *   1. Same origin  — only follow links to the same domain (no external sites).
 *   2. Scope prefix — only follow links that start with the root URL's path
 *                     prefix (so crawling "/docs" won't pull in "/blog").
 *   3. Allow/deny   — optional regex patterns for fine-grained control.
 *
 * All discovered URLs are normalized (no trailing slash, no hash fragment) to
 * prevent the same page being queued twice via slightly different URLs.
 */

import type { Page } from 'playwright';
import { getLogger } from '#src/logger.js';

export interface WalkOptions {
  /** The root URL of the crawl — defines the scope for link filtering. */
  rootUrl: string;
  /** Reserved for future depth-limited walking. Not currently used. */
  maxDepth?: number;
  /** Regex patterns — URLs matching any of these are excluded. */
  excludePatterns?: string[];
  /**
   * Regex patterns — if provided, URLs must match at least one to be included.
   * When omitted, all in-scope URLs are included (minus any excludePatterns).
   */
  includePatterns?: string[];
}

export class WalkerService {
  /**
   * Extract all same-scope links from a rendered Playwright page.
   *
   * Uses Playwright's `$$eval` to run the selector query inside the browser's
   * JavaScript context, which is more reliable than parsing the serialized HTML
   * string — it gives us resolved absolute `href` values rather than raw
   * attribute strings (e.g. relative paths are already resolved to full URLs).
   *
   * @param page    The fully rendered Playwright page to extract links from.
   * @param options Controls scoping and filtering behavior.
   * @returns       A deduplicated array of absolute URLs ready for the queue.
   */
  async discoverUrls(page: Page, options: WalkOptions): Promise<string[]> {
    const log = getLogger().child({ component: 'crawler:WalkerService' });
    const root = new URL(options.rootUrl);

    let scopePrefix = root.pathname;
    if (!scopePrefix.endsWith('/')) {
      const parts = scopePrefix.split('/');
      if (parts.length > 1) {
        parts.pop();
        scopePrefix = `${parts.join('/')}/`;
      }
    }

    const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));

    const uniqueUrls = new Set<string>();
    let afterOriginFilter = 0;

    for (const link of links) {
      try {
        const url = new URL(link);

        if (url.origin === root.origin && url.pathname.startsWith(scopePrefix)) {
          afterOriginFilter++;
          if (url.pathname.endsWith('.md')) continue;

          const normalized = url.origin + url.pathname.replace(/\/$/, '');

          if (this.isAllowed(normalized, options)) {
            uniqueUrls.add(normalized);
          }
        }
      } catch (_e) {
        // `new URL()` throws on invalid hrefs (mailto:, javascript:, etc.) — skip them
      }
    }

    const result = Array.from(uniqueUrls);
    log.trace(
      { total: links.length, afterOriginFilter, afterScopeFilter: result.length },
      'walker:links_found',
    );

    return result;
  }

  /**
   * Apply the exclude/include pattern filters.
   */
  private isAllowed(url: string, options: WalkOptions): boolean {
    if (options.excludePatterns) {
      for (const pattern of options.excludePatterns) {
        if (new RegExp(pattern).test(url)) return false;
      }
    }

    if (options.includePatterns) {
      for (const pattern of options.includePatterns) {
        if (new RegExp(pattern).test(url)) return true;
      }
      return false;
    }

    return true;
  }
}
