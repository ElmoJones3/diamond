#!/usr/bin/env node

import { Command } from 'commander';
import { crawlCommand } from './cli/crawl.js';
import { addRepoCommand } from './cli/repo.js';
import { syncCommand } from './cli/sync.js';
import { McpServer } from './mcp/server.js';

const program = new Command();

program.name('diamond').description('Documentation Registry and Crawler for MCP').version('1.0.0');

program
  .command('crawl')
  .description('Crawl a documentation site and drop Markdown files locally')
  .argument('<url>', 'The base URL to crawl')
  .option('--key <name>', 'The identifier for this library', 'docs')
  .option('--recursive', 'Whether to follow internal links', false)
  .option('--depth <number>', 'Maximum depth for recursive crawling', '2')
  .option('--concurrency <number>', 'Number of simultaneous pages to crawl', '5')
  .option('--limit <number>', 'Limit the number of pages to crawl')
  .argument('[outDir]', 'The output directory', '.')
  .action(async (url, outDir, options) => {
    try {
      await crawlCommand(url, {
        key: options.key,
        outDir: outDir || '.',
        recursive: options.recursive,
        maxDepth: parseInt(options.depth, 10),
        concurrency: parseInt(options.concurrency, 10),
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    } catch (e) {
      console.error('Fatal error during crawl:', e);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync a documentation site to the global registry (Deduplicated)')
  .argument('<url>', 'The base URL to crawl')
  .option('--key <name>', 'The identifier for this library', 'docs')
  .option('--ver <string>', 'The version of the documentation', 'latest')
  .option('--recursive', 'Whether to follow internal links', false)
  .option('--concurrency <number>', 'Number of simultaneous pages to crawl', '5')
  .option('--limit <number>', 'Limit the number of pages to crawl')
  .action(async (url, options) => {
    console.warn(`Entering sync command for ${url}...`);
    try {
      await syncCommand(url, {
        key: options.key,
        version: options.ver,
        recursive: options.recursive,
        concurrency: parseInt(options.concurrency, 10),
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    } catch (e) {
      console.error('Fatal error during sync:', e);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the Diamond MCP server on stdio')
  .action(async () => {
    try {
      const server = new McpServer();
      await server.run();
    } catch (e) {
      console.error('Fatal error in MCP server:', e);
      process.exit(1);
    }
  });

const repo = program.command('repo').description('Manage local repositories in the registry');

repo
  .command('add')
  .description('Track a local git repository')
  .argument('<path>', 'The local path to the repository')
  .option('--key <name>', 'The identifier for this repository')
  .action(async (path, options) => {
    try {
      await addRepoCommand(path, options);
    } catch (e) {
      console.error('Fatal error adding repo:', e);
      process.exit(1);
    }
  });

program.parse(process.argv);
