import type { Page } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalkerService } from '#src/crawler/walker.js';

describe('WalkerService', () => {
  let walker: WalkerService;

  beforeEach(() => {
    walker = new WalkerService();
  });

  it('should extract and normalize same-origin, in-scope links', async () => {
    const rootUrl = 'https://example.com/docs/';
    const mockLinks = [
      'https://example.com/docs/page1',
      'https://example.com/docs/page2/', // Trailing slash
      'https://example.com/docs/page1#section', // Hash fragment
      'https://example.com/blog/post1', // Out of scope
      'https://external.com/docs/page1', // Different origin
      'mailto:test@example.com', // Invalid URL for new URL()
    ];

    const mockPage = {
      $$eval: vi.fn().mockImplementation((_selector, _fn) => {
        // In reality, fn runs in browser, but we can simulate it here
        return Promise.resolve(mockLinks);
      }),
    } as unknown as Page;

    const urls = await walker.discoverUrls(mockPage, { rootUrl });

    expect(urls).toContain('https://example.com/docs/page1');
    expect(urls).toContain('https://example.com/docs/page2');
    expect(urls).not.toContain('https://example.com/blog/post1');
    expect(urls).not.toContain('https://external.com/docs/page1');
    expect(urls.length).toBe(2); // page1 and page2
  });

  it('should handle root URLs that are not directories (step up to parent)', async () => {
    const rootUrl = 'https://example.com/docs/intro';
    const mockLinks = [
      'https://example.com/docs/intro',
      'https://example.com/docs/sibling',
      'https://example.com/docs/nested/page',
    ];

    const mockPage = {
      $$eval: vi.fn().mockResolvedValue(mockLinks),
    } as unknown as Page;

    // If root is /docs/intro, scope should be /docs/
    const urls = await walker.discoverUrls(mockPage, { rootUrl });

    expect(urls).toContain('https://example.com/docs/intro');
    expect(urls).toContain('https://example.com/docs/sibling');
    expect(urls).toContain('https://example.com/docs/nested/page');
  });

  it('should apply exclude patterns', async () => {
    const rootUrl = 'https://example.com/docs/';
    const mockLinks = [
      'https://example.com/docs/page1',
      'https://example.com/docs/temp-page',
      'https://example.com/docs/private/secret',
    ];

    const mockPage = {
      $$eval: vi.fn().mockResolvedValue(mockLinks),
    } as unknown as Page;

    const urls = await walker.discoverUrls(mockPage, {
      rootUrl,
      excludePatterns: ['temp-', '/private/'],
    });

    expect(urls).toContain('https://example.com/docs/page1');
    expect(urls).not.toContain('https://example.com/docs/temp-page');
    expect(urls).not.toContain('https://example.com/docs/private/secret');
  });

  it('should apply include patterns', async () => {
    const rootUrl = 'https://example.com/docs/';
    const mockLinks = [
      'https://example.com/docs/api/v1',
      'https://example.com/docs/api/v2',
      'https://example.com/docs/guide/start',
    ];

    const mockPage = {
      $$eval: vi.fn().mockResolvedValue(mockLinks),
    } as unknown as Page;

    const urls = await walker.discoverUrls(mockPage, {
      rootUrl,
      includePatterns: ['/api/'],
    });

    expect(urls).toContain('https://example.com/docs/api/v1');
    expect(urls).toContain('https://example.com/docs/api/v2');
    expect(urls).not.toContain('https://example.com/docs/guide/start');
  });
});
