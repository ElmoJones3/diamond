import { XMLParser } from 'fast-xml-parser';

export interface DiscoveryOptions {
  rootUrl: string;
}

export class DiscoveryService {
  private parser = new XMLParser();

  /**
   * Attempts to find sitemap URLs via robots.txt and common locations.
   *
   * @param rootUrl The base URL to start discovery from.
   * @returns A list of unique URLs discovered from sitemaps.
   */
  async discoverFromSitemaps(rootUrl: string): Promise<string[]> {
    const url = new URL(rootUrl);
    const origin = url.origin;
    const discoveredUrls: string[] = [];

    // 1. Try common locations
    const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);

    // 2. Try robots.txt for 'Sitemap:' directives
    try {
      const resp = await fetch(`${origin}/robots.txt`);
      if (resp.ok) {
        const text = await resp.text();
        const matches = text.matchAll(/^Sitemap:\s*(.*)$/gim);
        for (const match of matches) {
          if (match[1]) sitemapUrls.add(match[1].trim());
        }
      }
    } catch (e) {
      // Ignore robots.txt failures
    }

    // 3. Parse all found sitemaps
    for (const sitemapUrl of sitemapUrls) {
      try {
        const urls = await this.parseSitemap(sitemapUrl);
        // Add all discovered URLs. We'll filter them by scope in the crawl command.
        discoveredUrls.push(...urls);
      } catch (e) {
        // Ignore individual sitemap failures
      }
    }

    return Array.from(new Set(discoveredUrls));
  }

  private async parseSitemap(url: string): Promise<string[]> {
    const resp = await fetch(url);
    if (!resp.ok) return [];

    const text = await resp.text();
    const data = this.parser.parse(text);

    const urls: string[] = [];

    // Handle sitemapindex (recursive sitemaps)
    if (data.sitemapindex && data.sitemapindex.sitemap) {
      const sitemaps = Array.isArray(data.sitemapindex.sitemap)
        ? data.sitemapindex.sitemap
        : [data.sitemapindex.sitemap];

      for (const sm of sitemaps) {
        if (sm.loc) {
          const nested = await this.parseSitemap(sm.loc);
          urls.push(...nested);
        }
      }
    }
    // Handle standard urlset
    else if (data.urlset && data.urlset.url) {
      const entries = Array.isArray(data.urlset.url) ? data.urlset.url : [data.urlset.url];

      for (const entry of entries) {
        if (entry.loc) urls.push(entry.loc);
      }
    }

    return urls;
  }

  /**
   * Attempts to resolve a version string for the given URL/library.
   * Currently checks common meta tags and the URL itself.
   */
  async resolveVersion(url: string, html?: string): Promise<string | null> {
    // 1. Check URL for version-like patterns (e.g., /v1.2.3/, /0.21.0/)
    const versionMatch = url.match(/\/v?(\d+\.\d+\.\d+)\//);
    if (versionMatch) return versionMatch[1];

    // 2. Check HTML meta tags if provided
    if (html) {
      const docMatch =
        html.match(/<meta\s+name="version"\s+content="([^"]+)"/i) ||
        html.match(/<meta\s+name="docsearch:version"\s+content="([^"]+)"/i);
      if (docMatch) return docMatch[1];
    }

    return null;
  }
}
