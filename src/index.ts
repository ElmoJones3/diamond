#!/usr/bin/env node

/**
 * Diamond CLI — entry point.
 *
 * Diamond has two personalities:
 *
 *   As a CLI tool:  `diamond <command> [options]`
 *     • crawl  — one-shot crawl, dumps Markdown files to a local directory.
 *     • sync   — crawl + store in the global registry (CAS, search index).
 *     • serve  — start the MCP server for AI assistant integration.
 *     • repo   — manage local git repositories in the registry.
 *
 *   As an MCP server:  `diamond serve`
 *     The serve command launches the Diamond MCP server over stdio, making
 *     all of Diamond's capabilities available to any MCP-compatible AI host
 *     (Claude Desktop, Cursor, etc.) without the user needing to run any
 *     other commands.
 *
 * All commands are thin wrappers — they parse arguments and delegate to the
 * implementation in `src/cli/` or `src/mcp/`. The actual logic lives there.
 *
 * Note on console.warn vs console.log:
 *   When running as an MCP server, stdout is the JSON-RPC transport channel.
 *   Writing anything else to stdout will corrupt the protocol stream. All
 *   human-readable output (progress, errors) therefore goes to stderr via
 *   `console.warn` / `console.error`, which is safe in both CLI and MCP mode.
 */

import { Command } from 'commander';

import { crawlCommand } from '#src/cli/crawl.js';
import { installCommand } from '#src/cli/install.js';
import { removeCommand } from '#src/cli/remove.js';
import { addRepoCommand } from '#src/cli/repo.js';
import { syncCommand } from '#src/cli/sync.js';
import { watchCommand } from '#src/cli/watch.ts';
import { McpServer } from '#src/mcp/server.js';

const program = new Command();

program
  .name('diamond')
  .description('Documentation registry and MCP server — sync docs once, read them offline forever.')
  .version('1.0.0');

// -----------------------------------------------------------------------------
// crawl — one-shot crawl without touching the global registry
// -----------------------------------------------------------------------------
program
  .command('crawl')
  .description('Crawl a documentation site and write Markdown files to a local directory')
  .argument('<url>', 'The root URL to start crawling from')
  .argument('[outDir]', 'Output directory (default: current directory)', '.')
  .option('--key <name>', 'Subdirectory name for the output (e.g. "msw")', 'docs')
  .option('--recursive', 'Follow internal links to crawl sub-pages', false)
  .option('--depth <number>', 'Maximum link-follow depth (not yet enforced)', '2')
  .option('--concurrency <number>', 'Pages to process simultaneously', '5')
  .option('--limit <number>', 'Stop after this many pages (useful for testing)')
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

// -----------------------------------------------------------------------------
// sync — crawl + ingest into the global registry (CAS, search index, manifest)
// -----------------------------------------------------------------------------
program
  .command('sync')
  .description("Crawl a documentation site and store it in Diamond's global registry")
  .argument('<url>', 'The root URL to start crawling from')
  .option('--key <name>', 'Library identifier in the registry (e.g. "msw")', 'docs')
  .option('--ver <string>', 'Pin a specific version (default: auto-detect)', 'latest')
  .option('--recursive', 'Follow internal links to crawl sub-pages', false)
  .option('--concurrency <number>', 'Pages to process simultaneously', '5')
  .option('--limit <number>', 'Stop after this many pages')
  .option('--description <text>', 'Short description of the library')
  .action(async (url, options) => {
    console.warn(`Entering sync command for ${url}...`);
    try {
      await syncCommand(url, {
        key: options.key,
        version: options.ver,
        recursive: options.recursive,
        concurrency: parseInt(options.concurrency, 10),
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        description: options.description,
      });
    } catch (e) {
      console.error('Fatal error during sync:', e);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// serve — launch the MCP server over stdio
// -----------------------------------------------------------------------------
program
  .command('serve')
  .description('Start the Diamond MCP server (connect via Claude Desktop, Cursor, etc.)')
  .action(async () => {
    try {
      const server = new McpServer();
      await server.run();
    } catch (e) {
      console.error('Fatal error in MCP server:', e);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// install — register Diamond as an MCP server in AI coding tools
// -----------------------------------------------------------------------------
program
  .command('install')
  .description('Register Diamond as an MCP server in AI coding tools')
  .option('--claude-code', 'Install into Claude Code (~/.claude.json)')
  .option('--claude-desktop', 'Install into Claude Desktop')
  .option('--cursor', 'Install into Cursor (~/.cursor/mcp.json)')
  .option('--gemini-cli', 'Install into Gemini CLI (~/.gemini/settings.json)')
  .action(async (options) => {
    const targets: string[] = [];
    if (options.claudeCode) targets.push('claude-code');
    if (options.claudeDesktop) targets.push('claude-desktop');
    if (options.cursor) targets.push('cursor');
    if (options.geminiCli) targets.push('gemini-cli');

    if (targets.length === 0) {
      console.warn('Specify one or more targets:\n');
      console.warn('  diamond install --claude-code');
      console.warn('  diamond install --claude-desktop');
      console.warn('  diamond install --cursor');
      console.warn('  diamond install --gemini-cli');
      console.warn('\nFlags can be combined: diamond install --claude-code --gemini-cli');
      process.exit(0);
    }

    try {
      await installCommand({ targets });
    } catch (e) {
      console.error('Fatal error during install:', e);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// remove — remove a library or repository from the registry
// -----------------------------------------------------------------------------
program
  .command('remove')
  .description('Remove a library or repository from the Diamond registry')
  .argument('<id>', 'The registry id to remove (e.g. "msw" or "diamond-core")')
  .action(async (id) => {
    try {
      await removeCommand(id);
    } catch (e) {
      console.error('Fatal error removing entry:', e);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// watch — live indexing for local repositories
// -----------------------------------------------------------------------------
program
  .command('watch')
  .description('Watch registered local repositories for changes and update search indices in real-time')
  .action(async () => {
    try {
      await watchCommand();
    } catch (e) {
      console.error('Fatal error during watch:', e);
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// repo — manage local git repositories
// -----------------------------------------------------------------------------
const repo = program.command('repo').description('Manage local git repositories tracked by Diamond');

repo
  .command('add')
  .description('Register a local git repository so Diamond can serve its files over MCP')
  .argument('<path>', 'Path to the repository root (relative or absolute)')
  .option('--key <name>', 'Registry identifier (defaults to the directory name)')
  .option('--description <text>', 'Short description of the repository')
  .action(async (repoPath, options) => {
    try {
      await addRepoCommand(repoPath, options);
    } catch (e) {
      console.error('Fatal error adding repo:', e);
      process.exit(1);
    }
  });

program.parse(process.argv);
