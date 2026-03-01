import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryService } from '#src/crawler/discovery.js';

describe('DiscoveryService', () => {
  let discovery: DiscoveryService;

  beforeEach(() => {
    discovery = new DiscoveryService();
    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should discover sitemaps from robots.txt', async () => {
    const rootUrl = 'https://example.com';

    // Mock robots.txt response
    (fetch as any).mockImplementation((url: string) => {
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Sitemap: https://example.com/custom-sitemap.xml\nUser-agent: *'),
        });
      }
      return Promise.resolve({ ok: false });
    });

    // Mock the custom sitemap response
    (fetch as any).mockImplementation((url: string) => {
      if (url === 'https://example.com/custom-sitemap.xml') {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(`
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/page1</loc></url>
            </urlset>
          `),
        });
      }
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('Sitemap: https://example.com/custom-sitemap.xml'),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const urls = await discovery.discoverFromSitemaps(rootUrl);
    expect(urls).toContain('https://example.com/page1');
  });

  it('should parse a standard sitemap', async () => {
    const _sitemapUrl = 'https://example.com/sitemap.xml';
    (fetch as any).mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(`
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/home</loc></url>
          <url><loc>https://example.com/about</loc></url>
        </urlset>
      `),
    });

    // We call the private method via any to test it directly or use the public discover method
    // Let's use the public one but seed it to only look at one place if possible
    // Actually, discoverFromSitemaps always tries common ones.
    const urls = await discovery.discoverFromSitemaps('https://example.com');
    expect(urls).toContain('https://example.com/home');
    expect(urls).toContain('https://example.com/about');
  });

  it('should recurse into sitemap index files', async () => {
    (fetch as any).mockImplementation((url: string) => {
      if (url.endsWith('sitemap_index.xml')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(`
            <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sitemap><loc>https://example.com/sub-sitemap.xml</loc></sitemap>
            </sitemapindex>
          `),
        });
      }
      if (url.endsWith('sub-sitemap.xml')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(`
            <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
              <url><loc>https://example.com/sub-page</loc></url>
            </urlset>
          `),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const urls = await discovery.discoverFromSitemaps('https://example.com');
    expect(urls).toContain('https://example.com/sub-page');
  });

  it('should resolve version from URL semver segment', async () => {
    const url = 'https://example.com/docs/v1.2.3/api';
    const version = await discovery.resolveVersion(url);
    expect(version).toBe('1.2.3');
  });

  it('should resolve version from meta tags in HTML', async () => {
    const url = 'https://example.com/docs/latest';
    const html = `
      <html>
        <head>
          <meta name="docsearch:version" content="2.0.1">
        </head>
      </html>
    `;
    const version = await discovery.resolveVersion(url, html);
    expect(version).toBe('2.0.1');
  });

  it('should return null if no version found', async () => {
    const version = await discovery.resolveVersion('https://example.com/docs');
    expect(version).toBeNull();
  });
});
