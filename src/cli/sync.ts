/**
 * sync command — the main pipeline for ingesting documentation into Diamond.
 *
 * This is the heart of Diamond's "offline docs" feature. A sync run is a
 * four-stage pipeline:
 *
 *   1. Crawl    — render every page of the docs site with Playwright and
 *                 convert HTML → Markdown.
 *   2. Resolve  — if no explicit version was given, try to detect one from
 *                 the URL or page meta tags.
 *   3. Store    — write each Markdown file to the CAS and create hardlinked
 *                 versioned views under `~/.local/share/diamond/storage/`.
 *   4. Index    — build a MiniSearch full-text index so `search_library`
 *                 works without reading every file.
 *   5. Register — record the library and this version in `registry.json`.
 *
 * After a successful sync, the library is available offline via:
 *   • The `docs://{lib}/{version}/{path}` MCP resource URI.
 *   • The `search_library` MCP tool.
 *   • The `docs://` symlink at `docs://{lib}/latest/...`.
 *
 * This function is called both by the `diamond sync` CLI command and by the
 * `sync_docs` MCP tool — the MCP server and CLI share the same implementation.
 */

import { type RegistryEntry, RegistryManager } from '#src/core/registry.js';
import { SearchService } from '#src/core/search.js';
import { StorageManager } from '#src/core/storage.js';
import { CrawlerService } from '#src/crawler/crawler.js';
import { DiscoveryService } from '#src/crawler/discovery.js';
import { getLogger } from '#src/logger.js';

export interface SyncCommandOptions {
  /** The short identifier for this library, e.g. "msw" or "zod". */
  key: string;
  /**
   * A specific version string to pin (e.g. "2.12.10").
   * If omitted or "latest", Diamond tries to auto-detect the version from
   * the URL or page meta tags, falling back to storing it as "latest".
   */
  version?: string;
  /** Follow links on each page to discover more pages (recommended). */
  recursive?: boolean;
  /** Number of pages to crawl in parallel. Defaults to 5. */
  concurrency?: number;
  /** Hard cap on total pages crawled. Useful for testing on large sites. */
  limit?: number;
  /** A short human-readable description of the library (e.g. "API mocking library for browser and Node.js"). */
  description?: string;
  /** Skip robots.txt enforcement. Some sites disallow crawlers but are fine with personal offline use. */
  ignoreRobots?: boolean;
}

export async function syncCommand(url: string, options: SyncCommandOptions) {
  const correlationId = crypto.randomUUID();
  const log = getLogger().child({ component: 'cli:sync', correlationId });

  const crawler = new CrawlerService();
  const registry = new RegistryManager();
  const storage = new StorageManager();
  const discovery = new DiscoveryService();
  const search = new SearchService();

  await registry.init();

  const libId = options.key;
  let version = options.version || 'latest';

  log.info({ url, libId, version, recursive: options.recursive, concurrency: options.concurrency }, 'sync:start');

  // -------------------------------------------------------------------------
  // Stage 1: Crawl
  // -------------------------------------------------------------------------
  const results = await crawler.crawl({
    url,
    recursive: options.recursive,
    concurrency: options.concurrency,
    limit: options.limit,
    ignoreRobots: options.ignoreRobots,
    correlationId,
  });

  if (results.length === 0) {
    throw new Error('Crawl returned zero results. Nothing to sync.');
  }

  log.debug({ pageCount: results.length }, 'sync:crawl_complete');

  // -------------------------------------------------------------------------
  // Stage 2: Version Resolution
  // -------------------------------------------------------------------------
  if (version === 'latest') {
    const rootResult = results.find((r) => r.url === url);
    const resolved = await discovery.resolveVersion(url, rootResult?.content);
    if (resolved) {
      version = resolved;
    }
  }

  log.debug({ version }, 'sync:version_resolved');

  // -------------------------------------------------------------------------
  // Stage 3: Storage (CAS + Hardlinks)
  // -------------------------------------------------------------------------
  await storage.createVersion(
    libId,
    version,
    results.map((r) => ({ path: r.path, content: r.content })),
  );

  log.debug({ fileCount: results.length }, 'sync:storage_complete');

  // -------------------------------------------------------------------------
  // Stage 4: Search Index
  // -------------------------------------------------------------------------
  const searchDocs = results.map((r) => ({
    id: r.path,
    title: r.title,
    content: r.content,
    url: r.url,
  }));

  await search.indexVersion(libId, version, searchDocs);

  log.debug({ docCount: searchDocs.length }, 'sync:index_complete');

  // -------------------------------------------------------------------------
  // Stage 5: Registry Update
  // -------------------------------------------------------------------------
  const existing = registry.getEntry(libId);
  const syncedAt = new Date().toISOString();

  const entry: RegistryEntry = {
    id: libId,
    type: 'docs',
    name: libId,
    homepage: url,
    description: options.description ?? (existing?.type === 'docs' ? existing.description : undefined),
    versions: {
      ...(existing?.type === 'docs' ? existing.versions : {}),
      [version]: { syncedAt },
    },
  };

  await registry.addEntry(entry);

  const storagePath = storage.getLibPath(libId, version);
  log.info({ libId, version, path: storagePath }, 'sync:complete');
}
