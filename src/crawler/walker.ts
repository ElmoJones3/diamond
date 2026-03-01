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
    const root = new URL(options.rootUrl);

    // Derive the scope prefix from the root URL's pathname.
    // If the root URL points to a specific "file" rather than a directory,
    // we step up to its parent so sibling pages are included.
    //
    // Examples:
    //   /docs/       → /docs/          (already a directory — no change)
    //   /docs/intro  → /docs/          (step up to parent)
    //   /api/v2/ref  → /api/v2/        (step up to parent)
    let scopePrefix = root.pathname;
    if (!scopePrefix.endsWith('/')) {
      const parts = scopePrefix.split('/');
      if (parts.length > 1) {
        parts.pop();
        scopePrefix = parts.join('/') + '/';
      }
    }

    // Run inside the browser context to get resolved absolute URLs.
    // The browser handles relative → absolute resolution for us.
    const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));

    const uniqueUrls = new Set<string>();

    for (const link of links) {
      try {
        const url = new URL(link);

        // Filter 1: same origin (e.g. no links to GitHub or external APIs)
        // Filter 2: within the scope prefix (no blog, no homepage, etc.)
        if (url.origin === root.origin && url.pathname.startsWith(scopePrefix)) {
          // Normalize to a canonical form:
          //   - Drop hash fragments (#section) — we want the page, not the anchor
          //   - Drop trailing slashes — /docs/ and /docs are the same page
          const normalized = url.origin + url.pathname.replace(/\/$/, '');

          // Filter 3: apply caller-supplied allow/deny patterns
          if (this.isAllowed(normalized, options)) {
            uniqueUrls.add(normalized);
          }
        }
      } catch (e) {
        // `new URL()` throws on invalid hrefs (mailto:, javascript:, etc.) — skip them
      }
    }

    return Array.from(uniqueUrls);
  }

  /**
   * Apply the exclude/include pattern filters.
   *
   * Logic:
   *   - If the URL matches any excludePattern → reject (return false).
   *   - If includePatterns are provided and the URL doesn't match any → reject.
   *   - Otherwise → accept.
   *
   * This means excludePatterns take priority over includePatterns.
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
      // If includePatterns were specified but none matched, reject.
      return false;
    }

    return true;
  }
}
