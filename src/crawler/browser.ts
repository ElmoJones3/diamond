/**
 * BrowserService — a thin lifecycle wrapper around a Playwright Chromium instance.
 *
 * Why Playwright instead of a plain HTTP fetch?
 * Most modern documentation sites are JavaScript-heavy SPAs (Next.js, Docusaurus,
 * VitePress, Starlight…). A plain fetch only returns the server-rendered HTML
 * shell; the actual page content is injected by JavaScript after hydration.
 * Playwright runs a real headless browser, so we get the fully rendered DOM —
 * the same thing a human would see in Chrome.
 *
 * A single Browser instance is shared across the whole crawl to keep startup
 * costs low (one ~1 second Chromium launch vs. one per page). Individual page
 * tabs are created and disposed by the caller.
 */

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { getLogger } from '#src/logger.js';

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  /** Launch the headless Chromium browser and set up a shared context with asset blocking. */
  async init() {
    const log = getLogger().child({ component: 'crawler:BrowserService' });
    log.debug('browser:launch');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();

    // Block asset types that contribute nothing to text extraction.
    // This eliminates network wait time for images, fonts, and stylesheets.
    await this.context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });
  }

  /** Gracefully shut down the browser and release all resources. */
  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Open a new browser tab, navigate to `url`, and wait for content to be ready.
   *
   * Strategy:
   *   1. Navigate with `domcontentloaded` — fast; heavy assets are already blocked
   *      so `load` would never fire cleanly anyway.
   *
   *   2. Wait for a content selector to appear in the DOM — proceeds the instant
   *      content is available, not after a fixed penalty. Falls back gracefully
   *      if no matching selector is found within 3 seconds.
   *
   * The caller is responsible for closing the returned Page when done.
   */
  async getPage(url: string): Promise<Page> {
    const log = getLogger().child({ component: 'crawler:BrowserService' });
    if (!this.context) throw new Error('Browser not initialized. Call init() first.');

    log.trace({ url }, 'browser:navigate');
    const page = await this.context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await page.waitForSelector(
        'main, article, [role="main"], .markdown, .theme-doc-markdown, .markdown-body, .content',
        { state: 'attached', timeout: 3000 },
      );
    } catch {
      // Selector not found — proceed with whatever has rendered.
    }

    return page;
  }

  /**
   * Reveal hidden content by clicking through interactive tab panels.
   *
   * The problem: documentation frameworks like Docusaurus and Starlight
   * render "tabbed" code blocks where only the active tab's content is visible
   * in the DOM at any given moment. If we capture the HTML without clicking
   * through each tab, we lose the hidden variants.
   *
   * This runs the entire tab-click loop inside the browser process via
   * page.evaluate(), eliminating Node↔browser IPC round-trips.
   */
  async revealAllContent(page: Page) {
    const log = getLogger().child({ component: 'crawler:BrowserService' });

    const tabCount = await page.evaluate(async () => {
      const tabSelectors = ['[role="tab"]', '.tabs__item', 'button[class*="tabs"]', '.tab-item'];
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let clicked = 0;

      for (const selector of tabSelectors) {
        const tabs = document.querySelectorAll<HTMLElement>(selector);
        for (const tab of tabs) {
          try {
            const isSelected = tab.getAttribute('aria-selected') === 'true';
            const isPressed = tab.getAttribute('aria-pressed') === 'true';
            const hasActiveClass = tab.classList.contains('active') || tab.classList.contains('selected');

            if (!isSelected && !isPressed && !hasActiveClass) {
              tab.click();
              await sleep(50);
              clicked++;
            }
          } catch {
            // Individual tab click failures are expected — ignore and move on.
          }
        }
      }
      return clicked;
    });

    if (tabCount > 0) {
      log.trace({ tabCount }, 'browser:reveal_tabs');
    }
  }
}
