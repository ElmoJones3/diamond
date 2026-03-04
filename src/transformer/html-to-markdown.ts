/**
 * TransformerService — converts raw HTML into clean, readable Markdown.
 *
 * The transformation is a two-stage pipeline:
 *
 *   Stage 1 — Readability (content extraction)
 *   ─────────────────────────────────────────────
 *   Raw documentation HTML is full of noise: navigation bars, sidebars,
 *   cookie banners, footers, ads, and script tags. Mozilla Readability
 *   (the same library powering Firefox's "Reader View") strips all of that
 *   away and returns just the article body — the actual documentation content.
 *   It uses heuristics like element size, text density, and class names to
 *   decide what's "content" vs "chrome".
 *
 *   Stage 2 — dom-to-semantic-markdown (HTML → Markdown)
 *   ─────────────────────────────────────────────────────
 *   Once we have clean HTML from Readability, we convert it to Markdown.
 *   We use dom-to-semantic-markdown rather than a plain HTML→text converter
 *   because it understands semantic HTML — it preserves code blocks, tables,
 *   headings, and inline formatting in a way that's useful for AI consumption.
 *   It operates on a live DOM (via JSDOM), so it can query element properties
 *   rather than just parsing tag strings.
 *
 * Why JSDOM?
 *   Both Readability and dom-to-semantic-markdown expect a browser-like DOM
 *   API (`document`, `window`, `DOMParser`…). JSDOM provides that API in
 *   Node.js without launching a real browser. The crawled HTML has already been
 *   fully rendered by Playwright, so JSDOM here is just for DOM manipulation —
 *   no JavaScript execution needed.
 */

import { Readability } from '@mozilla/readability';
import { convertHtmlToMarkdown } from 'dom-to-semantic-markdown';
import { JSDOM } from 'jsdom';
import { getLogger } from '#src/logger.js';

export interface TransformationResult {
  /** The page title extracted by Readability (from `<title>` or the main heading). */
  title: string;
  /** The full page content as clean Markdown. */
  markdown: string;
  /** A short summary sentence, if Readability could detect one. */
  excerpt?: string;
  /** The author attribution line, if present (e.g. "By Jane Doe"). */
  byline?: string;
}

export class TransformerService {
  /**
   * Transform raw HTML from a rendered documentation page into clean Markdown.
   *
   * @param html The full HTML string, as returned by Playwright's `page.content()`.
   * @param url  The page's URL — Readability uses this to resolve relative links
   *             inside the content into absolute URLs.
   */
  async transform(html: string, url: string): Promise<TransformationResult> {
    const log = getLogger().child({ component: 'transformer:TransformerService' });
    log.trace({ url }, 'transform:start');

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);

    // `parse()` returns null if Readability couldn't identify a main content
    // region (e.g. very sparse pages, or pages that are mostly navigation).
    const article = reader.parse();
    if (!article) {
      log.warn({ url }, 'transform:readability_fail');
      throw new Error(`Failed to parse content from ${url} using Readability.`);
    }

    const cleanDom = new JSDOM(article.content || '');

    const markdown = convertHtmlToMarkdown(cleanDom.window.document.body.innerHTML, {
      overrideDOMParser: new cleanDom.window.DOMParser(),
    });

    const trimmed = markdown.trim();
    log.trace({ url, markdownBytes: trimmed.length, title: article.title }, 'transform:ok');

    return {
      title: article.title || 'Untitled',
      markdown: trimmed,
      excerpt: article.excerpt ?? undefined,
      byline: article.byline ?? undefined,
    };
  }
}
