import type { Page } from 'playwright';

export interface WalkOptions {
  rootUrl: string;
  maxDepth?: number;
  excludePatterns?: string[];
  includePatterns?: string[];
}

export class WalkerService {
  /**
   * Discovers unique URLs on a page within the same domain/scope.
   *
   * @param page The rendered Playwright page.
   * @param options Walk configuration.
   * @returns A unique list of discovered URLs.
   */
  async discoverUrls(page: Page, options: WalkOptions): Promise<string[]> {
    const root = new URL(options.rootUrl);

    // Derive a broader scope: if the URL ends in a "file-like" path,
    // we use the parent directory as the scope.
    let scopePrefix = root.pathname;
    if (!scopePrefix.endsWith('/')) {
      const parts = scopePrefix.split('/');
      if (parts.length > 1) {
        parts.pop();
        scopePrefix = parts.join('/') + '/';
      }
    }

    // Extract all absolute links from the page
    const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));

    const uniqueUrls = new Set<string>();

    for (const link of links) {
      try {
        const url = new URL(link);

        // Ensure same domain and starts with the scope prefix
        if (url.origin === root.origin && url.pathname.startsWith(scopePrefix)) {
          // Normalize (remove hash, remove trailing slash)
          const normalized = url.origin + url.pathname.replace(/\/$/, '');

          if (this.isAllowed(normalized, options)) {
            uniqueUrls.add(normalized);
          }
        }
      } catch (e) {
        // Invalid URL
      }
    }

    return Array.from(uniqueUrls);
  }

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
      return false; // If includes provided, must match one
    }

    return true;
  }
}
