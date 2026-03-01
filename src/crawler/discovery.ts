/**
 * DiscoveryService — pre-crawl URL discovery via sitemaps.
 *
 * Before firing up a headless browser, we try to get a head-start on the
 * URL list by reading the site's sitemap. A sitemap is a standard XML file
 * (defined by sitemaps.org and supported by every major doc framework) that
 * lists every page the site wants indexed. Loading one XML file can hand us
 * hundreds of URLs in milliseconds — far cheaper than following links
 * page-by-page through the browser.
 *
 * The discovery strategy has three steps:
 *
 *   1. Try well-known sitemap locations (/sitemap.xml, /sitemap_index.xml).
 *   2. Parse robots.txt for `Sitemap:` directives (sites sometimes put
 *      their sitemap at a non-standard path and declare it there).
 *   3. Parse every found sitemap, recursing into sitemap index files.
 *
 * All failures are soft — if a site has no sitemap, or it's malformed,
 * discovery returns an empty list and the crawl falls back to link-following.
 *
 * Scope filtering (keeping only URLs under the crawl root's path prefix)
 * is intentionally left to CrawlerService so this service stays generic.
 */

import { XMLParser } from 'fast-xml-parser';

export interface DiscoveryOptions {
  rootUrl: string;
}

export class DiscoveryService {
  // fast-xml-parser is a zero-dependency XML parser — lighter than a full DOM
  // parser and well-suited for the simple key/value structure of sitemaps.
  private parser = new XMLParser();

  /**
   * Attempt to collect URLs from the site's sitemap(s).
   *
   * Returns a flat, deduplicated array of absolute URL strings. The caller is
   * responsible for filtering this list to the appropriate scope before use.
   *
   * @param rootUrl The base URL of the site being crawled.
   */
  async discoverFromSitemaps(rootUrl: string): Promise<string[]> {
    const url = new URL(rootUrl);
    const origin = url.origin;
    const discoveredUrls: string[] = [];

    // Seed the set with the two most common sitemap locations.
    const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);

    // robots.txt is a plain-text file that search engines read for crawling
    // rules. It also commonly includes `Sitemap:` directives pointing to
    // sitemap files at custom paths. Parsing it is fast and free.
    try {
      const resp = await fetch(`${origin}/robots.txt`);
      if (resp.ok) {
        const text = await resp.text();
        // Match lines like: "Sitemap: https://example.com/custom-sitemap.xml"
        const matches = text.matchAll(/^Sitemap:\s*(.*)$/gim);
        for (const match of matches) {
          if (match[1]) sitemapUrls.add(match[1].trim());
        }
      }
    } catch (e) {
      // robots.txt is optional — many sites don't have one
    }

    // Parse every sitemap candidate. Individual failures are swallowed so a
    // 404 on /sitemap_index.xml doesn't break the crawl.
    for (const sitemapUrl of sitemapUrls) {
      try {
        const urls = await this.parseSitemap(sitemapUrl);
        discoveredUrls.push(...urls);
      } catch (e) {
        // This sitemap didn't work — move on to the next candidate
      }
    }

    // Deduplicate in case multiple sitemaps list the same URL.
    return Array.from(new Set(discoveredUrls));
  }

  /**
   * Fetch and parse a single sitemap XML file.
   *
   * Handles two sitemap formats defined by the sitemaps.org spec:
   *
   *   • `<urlset>` — a standard sitemap containing `<url><loc>` entries.
   *     This is the most common format.
   *
   *   • `<sitemapindex>` — an index file that lists other sitemap files
   *     rather than pages directly. Large sites split their sitemap across
   *     multiple files and use an index to reference them. We recurse into
   *     each child sitemap to collect all URLs.
   *
   * Note: both `<sitemap>` and `<url>` can appear as a single object or as an
   * array depending on how many entries the sitemap contains. fast-xml-parser
   * doesn't normalize this, so we coerce to an array explicitly.
   */
  private async parseSitemap(url: string): Promise<string[]> {
    const resp = await fetch(url);
    if (!resp.ok) return [];

    const text = await resp.text();
    const data = this.parser.parse(text);

    const urls: string[] = [];

    if (data.sitemapindex && data.sitemapindex.sitemap) {
      // Sitemap index — each `<sitemap>` entry points to another sitemap file.
      const sitemaps = Array.isArray(data.sitemapindex.sitemap)
        ? data.sitemapindex.sitemap
        : [data.sitemapindex.sitemap];

      for (const sm of sitemaps) {
        if (sm.loc) {
          const nested = await this.parseSitemap(sm.loc);
          urls.push(...nested);
        }
      }
    } else if (data.urlset && data.urlset.url) {
      // Standard sitemap — each `<url>` entry has a `<loc>` with the page URL.
      const entries = Array.isArray(data.urlset.url) ? data.urlset.url : [data.urlset.url];

      for (const entry of entries) {
        if (entry.loc) urls.push(entry.loc);
      }
    }

    return urls;
  }

  /**
   * Try to determine the library version from a URL or page HTML.
   *
   * Version strings in docs URLs are surprisingly common:
   *   https://lexical.dev/docs/v0.21.0/api   → "0.21.0"
   *   https://reactrouter.com/v6/api          → "6" (not matched currently)
   *
   * If the URL doesn't contain a semver segment, we fall back to checking
   * well-known HTML `<meta>` tags that some documentation generators emit:
   *   <meta name="version" content="2.12.10">
   *   <meta name="docsearch:version" content="2.12.10">  (Algolia DocSearch)
   *
   * Returns null if no version can be determined — the caller should fall back
   * to "latest" in that case.
   */
  async resolveVersion(url: string, html?: string): Promise<string | null> {
    // Look for a semver-like segment in the URL path (/v1.2.3/ or /1.2.3/)
    const versionMatch = url.match(/\/v?(\d+\.\d+\.\d+)\//);
    if (versionMatch) return versionMatch[1];

    if (html) {
      const docMatch =
        html.match(/<meta\s+name="version"\s+content="([^"]+)"/i) ||
        html.match(/<meta\s+name="docsearch:version"\s+content="([^"]+)"/i);
      if (docMatch) return docMatch[1];
    }

    return null;
  }
}
