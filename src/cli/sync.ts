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
  const crawler = new CrawlerService();
  const registry = new RegistryManager();
  const storage = new StorageManager();
  const discovery = new DiscoveryService();
  const search = new SearchService();

  await registry.init();

  const libId = options.key;
  let version = options.version || 'latest';

  console.warn(`Syncing ${libId} from ${url}...`);

  // -------------------------------------------------------------------------
  // Stage 1: Crawl
  //
  // CrawlerService handles discovery (sitemap), rendering (Playwright),
  // content extraction (Readability), and conversion (HTML → Markdown).
  // Each result is a { url, path, content, title } object.
  // -------------------------------------------------------------------------
  const results = await crawler.crawl({
    url,
    recursive: options.recursive,
    concurrency: options.concurrency,
    limit: options.limit,
    ignoreRobots: options.ignoreRobots,
  });

  if (results.length === 0) {
    throw new Error('Crawl returned zero results. Nothing to sync.');
  }

  // -------------------------------------------------------------------------
  // Stage 2: Version Resolution
  //
  // If the user didn't specify a version, try to detect one.
  // We check the root page first (most likely to have version info), then
  // fall back to the URL itself. If nothing is found, we keep "latest" —
  // which is fine for libraries that don't version their docs separately.
  // -------------------------------------------------------------------------
  if (version === 'latest') {
    const rootResult = results.find((r) => r.url === url);
    const resolved = await discovery.resolveVersion(url, rootResult?.content);
    if (resolved) {
      console.warn(`Resolved 'latest' to version: ${resolved}`);
      version = resolved;
    }
  }

  console.warn(`Discovered and transformed ${results.length} pages.`);

  // -------------------------------------------------------------------------
  // Stage 3: Storage (CAS + Hardlinks)
  //
  // StorageManager writes each page's Markdown content into the CAS (keyed
  // by SHA256 hash) and then creates a hardlink from the store to the
  // versioned storage path. Identical content across versions costs zero
  // extra disk space.
  // -------------------------------------------------------------------------
  console.warn(`Writing to Content-Addressable Store (Version: ${version})...`);
  await storage.createVersion(
    libId,
    version,
    results.map((r) => ({ path: r.path, content: r.content })),
  );

  // -------------------------------------------------------------------------
  // Stage 4: Search Index
  //
  // Build and persist a MiniSearch keyword index — fast, always awaited.
  // The library is fully searchable via search_library as soon as this returns.
  // -------------------------------------------------------------------------
  const searchDocs = results.map((r) => ({
    id: r.path,
    title: r.title,
    content: r.content,
    url: r.url,
  }));

  console.warn('Building keyword index...');
  await search.indexVersion(libId, version, searchDocs);

  // -------------------------------------------------------------------------
  // Stage 5: Registry Update
  //
  // Record this version in the registry manifest. We merge with any existing
  // versions so a re-sync (e.g. adding a newer version) doesn't erase the
  // record of older synced versions.
  // -------------------------------------------------------------------------
  const existing = registry.getEntry(libId);
  const syncedAt = new Date().toISOString();

  const entry: RegistryEntry = {
    id: libId,
    type: 'docs',
    name: libId,
    homepage: url,
    // Prefer the newly supplied description; fall back to whatever was stored before.
    description: options.description ?? (existing?.type === 'docs' ? existing.description : undefined),
    versions: {
      // Preserve any previously synced versions
      ...(existing?.type === 'docs' ? existing.versions : {}),
      [version]: { syncedAt },
    },
  };

  await registry.addEntry(entry);

  console.warn(`\nSuccess! ${libId}@${version} is now synced and indexed.`);
  console.warn(`Storage Location: ${storage.getLibPath(libId, version)}`);
}
