/**
 * crawl command — a standalone, one-shot crawler that drops Markdown files locally.
 *
 * This is the "escape hatch" command for when you want raw Markdown output
 * without going through Diamond's registry or storage system. It crawls a
 * documentation site and writes the results straight to a local directory
 * alongside a manifest file (`index.json`).
 *
 * Use this when you want to:
 *   • Inspect the raw Markdown output of the crawler.
 *   • Pipe docs into another tool that expects plain files.
 *   • Do a one-off crawl without polluting the global registry.
 *
 * For persistent, MCP-accessible documentation, use `diamond sync` instead.
 * `sync` goes through the CAS, deduplicates, builds a search index, and
 * registers the library so it's available to AI tools.
 *
 * Output structure:
 *   {outDir}/{key}/
 *     api/handlers.md       ← one file per crawled page
 *     getting-started.md
 *     index.json            ← manifest: { url → { title, path } }
 */

import path from 'node:path';
import fs from 'fs-extra';
import { CrawlerService } from '#src/crawler/crawler.js';
import { getLogger } from '#src/logger.js';

export interface CrawlCommandOptions {
  /** Short name for the library, used as the output subdirectory name. */
  key: string;
  /** Parent directory where the `{key}/` output folder will be created. */
  outDir: string;
  /** Follow internal links to crawl more than just the root page. */
  recursive?: boolean;
  /** Reserved for depth-limited crawling (not yet enforced). */
  maxDepth?: number;
  /** Number of pages to process simultaneously. Defaults to 5. */
  concurrency?: number;
  /** Stop after this many pages. Useful for previewing large sites. */
  limit?: number;
}

/**
 * Crawl a documentation site and write Markdown files to a local directory.
 *
 * @param url     The root URL to start crawling from.
 * @param options Controls output location, crawl scope, and concurrency.
 */
export async function crawlCommand(url: string, options: CrawlCommandOptions) {
  const log = getLogger().child({ component: 'cli:crawl' });
  const crawler = new CrawlerService();

  const targetDir = path.resolve(options.outDir, options.key);
  await fs.ensureDir(targetDir);

  log.info({ url, key: options.key, outDir: options.outDir }, 'crawl:start');

  const results = await crawler.crawl({
    url,
    recursive: options.recursive,
    maxDepth: options.maxDepth,
    concurrency: options.concurrency,
    limit: options.limit,
  });

  const manifest: Record<string, { title: string; path: string }> = {};

  for (const result of results) {
    const filePath = path.join(targetDir, result.path);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, result.content);

    manifest[result.url] = {
      title: result.title,
      path: result.path,
    };
  }

  await fs.writeJson(path.join(targetDir, 'index.json'), manifest, { spaces: 2 });

  log.info({ pageCount: results.length, targetDir }, 'crawl:complete');
}
