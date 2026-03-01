import { describe, expect, it } from 'vitest';
import { TransformerService } from '#src/transformer/html-to-markdown.js';

describe('TransformerService', () => {
  const transformer = new TransformerService();

  it('should extract main content and convert to markdown', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav>
            <ul><li><a href="/">Home</a></li></ul>
          </nav>
          <main>
            <h1>Main Title</h1>
            <p>This is the <strong>important</strong> content.</p>
            <pre><code>const x = 1;</code></pre>
          </main>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;
    const url = 'https://example.com/test';

    const result = await transformer.transform(html, url);

    expect(result.title).toBe('Test Page');
    expect(result.markdown).toContain('# Main Title');
    expect(result.markdown).toContain('This is the **important** content.');
    expect(result.markdown).toContain('```\nconst x = 1;\n```');
    // Navigation and footer should be stripped by Readability
    expect(result.markdown).not.toContain('Home');
    expect(result.markdown).not.toContain('Copyright 2026');
  });

  it('should handle relative links by resolving them with the base URL', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <article>
            <p>Check out <a href="/docs/api">the docs</a>.</p>
          </article>
        </body>
      </html>
    `;
    const url = 'https://example.com/start';

    const result = await transformer.transform(html, url);

    expect(result.markdown).toContain('(https://example.com/docs/api)');
  });

  it('should extract excerpt and byline if present', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="description" content="A short summary of the page.">
          <meta name="author" content="Jane Doe">
        </head>
        <body>
          <article>
            <h1>Article Title</h1>
            <p>Content goes here...</p>
          </article>
        </body>
      </html>
    `;

    const result = await transformer.transform(html, 'https://example.com');

    expect(result.excerpt).toBe('A short summary of the page.');
    expect(result.byline).toBe('Jane Doe');
  });

  it('should throw error if no content can be parsed', async () => {
    const html = `<!DOCTYPE html><html><body><div></div></body></html>`;

    await expect(transformer.transform(html, 'https://example.com')).rejects.toThrow('Failed to parse content');
  });
});
