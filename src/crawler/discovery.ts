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
import robotsParser from 'robots-parser';
import { getLogger } from '#src/logger.js';

export interface DiscoveryOptions {
  rootUrl: string;
}

export class DiscoveryService {
  private parser = new XMLParser();

  /**
   * Fetch and create a robots.txt parser for the given origin.
   */
  async getRobotsParser(rootUrl: string) {
    const log = getLogger().child({ component: 'crawler:DiscoveryService' });
    const origin = new URL(rootUrl).origin;
    const robotsUrl = `${origin}/robots.txt`;
    const robotsTxt = await this.fetchRobotsTxt(robotsUrl);
    log.debug({ robotsUrl, hasContent: robotsTxt.length > 0 }, 'discovery:robots');
    // robots-parser is CJS; default import not callable under NodeNext without this cast
    // biome-ignore lint/suspicious/noExplicitAny: robots-parser is CJS; default import not callable under NodeNext without this cast
    return (robotsParser as any)(robotsUrl, robotsTxt);
  }

  private async fetchRobotsTxt(url: string): Promise<string> {
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.text();
    } catch (_e) {
      // ignore
    }
    return '';
  }

  /**
   * Attempt to collect URLs from the site's sitemap(s).
   *
   * Returns a flat, deduplicated array of absolute URL strings. The caller is
   * responsible for filtering this list to the appropriate scope before use.
   *
   * @param rootUrl The base URL of the site being crawled.
   */
  async discoverFromSitemaps(rootUrl: string): Promise<string[]> {
    const log = getLogger().child({ component: 'crawler:DiscoveryService' });
    const url = new URL(rootUrl);
    const origin = url.origin;
    const discoveredUrls: string[] = [];

    const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);

    try {
      const resp = await fetch(`${origin}/robots.txt`);
      if (resp.ok) {
        const text = await resp.text();
        const matches = text.matchAll(/^Sitemap:\s*(.*)$/gim);
        for (const match of matches) {
          if (match[1]) sitemapUrls.add(match[1].trim());
        }
      }
    } catch (_e) {
      // robots.txt is optional — many sites don't have one
    }

    for (const sitemapUrl of sitemapUrls) {
      try {
        const urls = await this.parseSitemap(sitemapUrl);
        if (urls.length > 0) {
          log.debug({ url: sitemapUrl, urlCount: urls.length }, 'discovery:sitemap');
        }
        discoveredUrls.push(...urls);
      } catch (_e) {
        // This sitemap didn't work — move on to the next candidate
      }
    }

    return Array.from(new Set(discoveredUrls));
  }

  /**
   * Fetch and parse a single sitemap XML file.
   */
  private async parseSitemap(url: string): Promise<string[]> {
    const resp = await fetch(url);
    if (!resp.ok) return [];

    const text = await resp.text();
    const data = this.parser.parse(text);

    return this.parseSitemapData(data);
  }

  /**
   * Parse sitemap data (from XML) into a flat array of URLs.
   * Handles both <urlset> and <sitemapindex> formats.
   */
  private async parseSitemapData(data: {
    sitemapindex?: { sitemap: { loc: string } | { loc: string }[] };
    urlset?: { url: { loc: string } | { loc: string }[] };
  }): Promise<string[]> {
    const urls: string[] = [];

    if (data.sitemapindex?.sitemap) {
      urls.push(...(await this.handleSitemapIndex(data.sitemapindex.sitemap)));
    }

    if (data.urlset?.url) {
      urls.push(...this.handleUrlSet(data.urlset.url));
    }

    return urls;
  }

  private async handleSitemapIndex(sitemap: { loc: string } | { loc: string }[]): Promise<string[]> {
    const urls: string[] = [];
    const sitemaps = Array.isArray(sitemap) ? sitemap : [sitemap];
    for (const sm of sitemaps) {
      if (sm.loc) {
        urls.push(...(await this.parseSitemap(sm.loc)));
      }
    }
    return urls;
  }

  private handleUrlSet(url: { loc: string } | { loc: string }[]): string[] {
    const urls: string[] = [];
    const entries = Array.isArray(url) ? url : [url];
    for (const entry of entries) {
      if (entry.loc) urls.push(entry.loc);
    }
    return urls;
  }

  /**
   * Try to determine the library version from a URL or page HTML.
   */
  async resolveVersion(url: string, html?: string): Promise<string | null> {
    const log = getLogger().child({ component: 'crawler:DiscoveryService' });

    const versionMatch = url.match(/\/v?(\d+\.\d+\.\d+)\//);
    if (versionMatch) {
      log.debug({ method: 'url', version: versionMatch[1] }, 'discovery:version');
      return versionMatch[1];
    }

    if (html) {
      const docMatch =
        html.match(/<meta\s+name="version"\s+content="([^"]+)"/i) ||
        html.match(/<meta\s+name="docsearch:version"\s+content="([^"]+)"/i);
      if (docMatch) {
        log.debug({ method: 'meta', version: docMatch[1] }, 'discovery:version');
        return docMatch[1];
      }
    }

    return null;
  }
}
