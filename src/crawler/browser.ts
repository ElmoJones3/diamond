import { type Browser, chromium, type Page } from 'playwright';

export class BrowserService {
  private browser: Browser | null = null;

  async init() {
    this.browser = await chromium.launch({ headless: true });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getPage(url: string): Promise<Page> {
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();

    // Set a reasonable timeout and wait for network idle to handle SPAs
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Basic stabilization
    await page.waitForLoadState('domcontentloaded');

    return page;
  }

  /**
   * Attempts to find and click all buttons that look like tabs (Docusaurus, Starlight, etc.)
   * to ensure all content is rendered before extraction.
   */
  async revealAllContent(page: Page) {
    // Common tab patterns: [role="tab"], .tabs__item, [data-toggle="tab"]
    const tabSelectors = ['[role="tab"]', '.tabs__item', 'button[class*="tabs"]', '.tab-item'];

    for (const selector of tabSelectors) {
      const tabs = await page.$$(selector);
      for (const tab of tabs) {
        try {
          // Only click if not already active/selected
          const isSelected = (await tab.getAttribute('aria-selected')) === 'true';
          const isPressed = (await tab.getAttribute('aria-pressed')) === 'true';
          const hasActiveClass = await tab.evaluate(
            (el) => el.classList.contains('active') || el.classList.contains('selected'),
          );

          if (!isSelected && !isPressed && !hasActiveClass) {
            await tab.click({ timeout: 1000 });
            // Brief wait for content swap
            await page.waitForTimeout(200);
          }
        } catch (e) {
          // Ignore click failures on individual tabs
        }
      }
    }
  }
}
