import { Readability } from '@mozilla/readability';
import { convertHtmlToMarkdown } from 'dom-to-semantic-markdown';
import { JSDOM } from 'jsdom';

export interface TransformationResult {
  title: string;
  markdown: string;
  excerpt?: string;
  byline?: string;
}

export class TransformerService {
  /**
   * Transforms raw HTML into clean, semantic Markdown.
   *
   * @param html The raw HTML string from the rendered page.
   * @param url The source URL for context.
   * @returns A TransformationResult containing the clean title and markdown.
   */
  async transform(html: string, url: string): Promise<TransformationResult> {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      throw new Error(`Failed to parse content from ${url} using Readability.`);
    }

    // dom-to-semantic-markdown works best on the cleaned content container.
    // We recreate a JSDOM instance with just the 'content' HTML from Readability.
    const cleanDom = new JSDOM(article.content || '');

    // Convert to semantic markdown
    const markdown = convertHtmlToMarkdown(cleanDom.window.document.body.innerHTML, {
      overrideDOMParser: new cleanDom.window.DOMParser(),
    });

    return {
      title: article.title || 'Untitled',
      markdown: markdown.trim(),
      excerpt: article.excerpt ?? undefined,
      byline: article.byline ?? undefined,
    };
  }
}
