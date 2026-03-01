import path from 'node:path';
import fs from 'fs-extra';
import { CrawlerService } from '../crawler/crawler.js';

export interface CrawlCommandOptions {
  key: string;
  outDir: string;
  recursive?: boolean;
  maxDepth?: number;
  concurrency?: number;
  limit?: number;
}

export async function crawlCommand(url: string, options: CrawlCommandOptions) {
  const crawler = new CrawlerService();
  const targetDir = path.resolve(options.outDir, options.key);
  await fs.ensureDir(targetDir);

  console.warn(`Starting crawl of ${url}...`);
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
  console.warn(`\nSuccess! Documentation for '${options.key}' dropped at: ${targetDir}`);
}
