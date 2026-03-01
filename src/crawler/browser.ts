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

import { type Browser, chromium, type Page } from 'playwright';

export class BrowserService {
  private browser: Browser | null = null;

  /** Launch the headless Chromium browser. Call once before crawling. */
  async init() {
    this.browser = await chromium.launch({ headless: true });
  }

  /** Gracefully shut down the browser and release all resources. */
  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Open a new browser tab, navigate to `url`, and wait for it to fully settle.
   *
   * We use two wait conditions in sequence:
   *
   *   1. `networkidle` — Playwright considers the page "idle" once there have
   *      been no more than 2 in-flight network requests for at least 500ms.
   *      This catches most SPA hydration patterns where the framework fires
   *      XHR/fetch calls on mount to populate the page with content.
   *
   *   2. `domcontentloaded` — a belt-and-suspenders check that the initial
   *      HTML document has been parsed. In practice networkidle implies this,
   *      but waiting for it explicitly ensures consistent behavior.
   *
   * The caller is responsible for closing the returned Page when done.
   */
  async getPage(url: string): Promise<Page> {
    if (!this.browser) throw new Error('Browser not initialized. Call init() first.');

    const page = await this.browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');

    return page;
  }

  /**
   * Reveal hidden content by clicking through interactive tab panels.
   *
   * The problem: documentation frameworks like Docusaurus and Starlight
   * render "tabbed" code blocks where only the active tab's content is visible
   * in the DOM at any given moment. If we capture the HTML without clicking
   * through each tab, we lose the hidden variants — for example, a code
   * example that shows both a JavaScript and TypeScript version would only
   * capture whichever tab was open by default.
   *
   * The solution: we locate all elements that look like tab triggers using a
   * set of well-known CSS selectors, then click each one that isn't already
   * active. A short 200ms pause after each click lets the framework swap in
   * the new content before we move on.
   *
   * Failures on individual tabs are silently ignored — a tab that can't be
   * clicked (hidden, outside viewport, etc.) shouldn't abort the whole page.
   */
  async revealAllContent(page: Page) {
    // These selectors cover the most common documentation framework patterns:
    //   [role="tab"]           — standard ARIA tab widget (used by many frameworks)
    //   .tabs__item            — Docusaurus tab items
    //   button[class*="tabs"]  — generic button-based tabs
    //   .tab-item              — Starlight and others
    const tabSelectors = ['[role="tab"]', '.tabs__item', 'button[class*="tabs"]', '.tab-item'];

    for (const selector of tabSelectors) {
      const tabs = await page.$$(selector);
      for (const tab of tabs) {
        try {
          // Check all the common "already active" signals before clicking —
          // clicking an active tab is harmless but can trigger unnecessary
          // re-renders and slow us down.
          const isSelected = (await tab.getAttribute('aria-selected')) === 'true';
          const isPressed = (await tab.getAttribute('aria-pressed')) === 'true';
          const hasActiveClass = await tab.evaluate(
            (el) => el.classList.contains('active') || el.classList.contains('selected'),
          );

          if (!isSelected && !isPressed && !hasActiveClass) {
            await tab.click({ timeout: 1000 });
            // Brief pause for the framework to swap in the new panel content.
            await page.waitForTimeout(200);
          }
        } catch (_e) {
          // Individual tab click failures are expected (off-screen elements,
          // disabled tabs, etc.) — ignore and move on.
        }
      }
    }
  }
}
