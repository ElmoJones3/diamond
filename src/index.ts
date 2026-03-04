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
 * Note on stderr output:
 *   When running as an MCP server, stdout is the JSON-RPC transport channel.
 *   Writing anything else to stdout will corrupt the protocol stream. All
 *   human-readable output (progress, errors) therefore goes to stderr, which
 *   is safe in both CLI and MCP mode. The logger is configured to write to
 *   stderr (and a JSONL log file) — never stdout.
 */

import { Command } from 'commander';
import { crawlCommand } from '#src/cli/crawl.js';
import { gcCommand } from '#src/cli/gc.js';
import { installCommand } from '#src/cli/install.js';
import { removeCommand } from '#src/cli/remove.js';
import { addRepoCommand } from '#src/cli/repo.js';
import { syncCommand } from '#src/cli/sync.js';
import { watchCommand } from '#src/cli/watch.js';
import { getLogger, initLogger } from '#src/logger.js';
import { McpServer } from '#src/mcp/server.js';

const program = new Command();

program
  .name('diamond')
  .description('Documentation registry and MCP server — sync docs once, read them offline forever.')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable trace-level logging (all debug output)', false)
  .option('--log-file <path>', 'Write structured JSONL logs to this file (overrides DIAMOND_LOG_FILE env var)');

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
  .option('--concurrency <number>', 'Pages to process simultaneously', '10')
  .option('--limit <number>', 'Stop after this many pages (useful for testing)')
  .action(async (url, outDir, options) => {
    const log = getLogger().child({ component: 'cli:crawl' });
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
      log.error({ err: e }, 'Fatal error during crawl');
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
  .option('--concurrency <number>', 'Pages to process simultaneously', '10')
  .option('--limit <number>', 'Stop after this many pages')
  .option('--description <text>', 'Short description of the library')
  .option('--ignore-robots', 'Ignore robots.txt restrictions (for personal offline use)', false)
  .action(async (url, options) => {
    const log = getLogger().child({ component: 'cli:sync' });
    try {
      await syncCommand(url, {
        key: options.key,
        version: options.ver,
        recursive: options.recursive,
        concurrency: parseInt(options.concurrency, 10),
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        description: options.description,
        ignoreRobots: options.ignoreRobots,
      });
      // Exit immediately — don't wait for the background vector build that
      // syncCommand fires.  Vectors complete naturally inside `diamond serve`
      // (the long-running MCP server process).
      process.exit(0);
    } catch (e) {
      log.error({ err: e }, 'Fatal error during sync');
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
    const log = getLogger().child({ component: 'cli:serve' });
    try {
      const server = new McpServer();
      await server.run();
    } catch (e) {
      log.error({ err: e }, 'Fatal error in MCP server');
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
    const log = getLogger().child({ component: 'cli:install' });
    const targets: string[] = [];
    if (options.claudeCode) targets.push('claude-code');
    if (options.claudeDesktop) targets.push('claude-desktop');
    if (options.cursor) targets.push('cursor');
    if (options.geminiCli) targets.push('gemini-cli');

    if (targets.length === 0) {
      log.warn('No install targets specified');
      process.stderr.write('Specify one or more targets:\n\n');
      process.stderr.write('  diamond install --claude-code\n');
      process.stderr.write('  diamond install --claude-desktop\n');
      process.stderr.write('  diamond install --cursor\n');
      process.stderr.write('  diamond install --gemini-cli\n');
      process.stderr.write('\nFlags can be combined: diamond install --claude-code --gemini-cli\n');
      process.exit(0);
    }

    try {
      await installCommand({ targets });
    } catch (e) {
      log.error({ err: e }, 'Fatal error during install');
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
    const log = getLogger().child({ component: 'cli:remove' });
    try {
      await removeCommand(id);
    } catch (e) {
      log.error({ err: e }, 'Fatal error removing entry');
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// gc — garbage collect orphaned CAS blobs
// -----------------------------------------------------------------------------
program
  .command('gc')
  .description('Remove orphaned blobs from the content-addressable store to reclaim disk space')
  .action(async () => {
    const log = getLogger().child({ component: 'cli:gc' });
    try {
      await gcCommand();
    } catch (e) {
      log.error({ err: e }, 'Fatal error during gc');
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
    const log = getLogger().child({ component: 'cli:watch' });
    try {
      await watchCommand();
    } catch (e) {
      log.error({ err: e }, 'Fatal error during watch');
      process.exit(1);
    }
  });

// -----------------------------------------------------------------------------
// repo — manage local git repositories
// -----------------------------------------------------------------------------
const repo = program.command('repo').description('Manage local git repositories tracked by Diamond');

repo
  .command('remove')
  .description('Remove a repository from the Diamond registry')
  .argument('<id>', 'Registry identifier to remove')
  .action(async (id) => {
    const log = getLogger().child({ component: 'cli:repo' });
    try {
      await removeCommand(id);
    } catch (e) {
      log.error({ err: e }, 'Fatal error removing repo');
      process.exit(1);
    }
  });

repo
  .command('add')
  .description('Register a local git repository so Diamond can serve its files over MCP')
  .argument('<path>', 'Path to the repository root (relative or absolute)')
  .option('--key <name>', 'Registry identifier (defaults to the directory name)')
  .option('--description <text>', 'Short description of the repository')
  .action(async (repoPath, options) => {
    const log = getLogger().child({ component: 'cli:repo' });
    try {
      await addRepoCommand(repoPath, options);
    } catch (e) {
      log.error({ err: e }, 'Fatal error adding repo');
      process.exit(1);
    }
  });

// Initialize logger before parsing — this ensures the singleton is ready
// before any command action fires. The --verbose and --log-file options are
// parsed from process.argv directly since Commander hasn't parsed yet.
const verboseFlag = process.argv.includes('--verbose') || process.argv.includes('-v');
const logFileIdx = process.argv.indexOf('--log-file');
const logFileArg = logFileIdx !== -1 ? process.argv[logFileIdx + 1] : undefined;
const level = verboseFlag ? 'trace' : (process.env.LOG_LEVEL ?? 'info');
initLogger(level, logFileArg);

program.parse(process.argv);
