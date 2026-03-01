import { type RegistryEntry, RegistryManager } from '../core/registry.js';
import { SearchService } from '../core/search.js';
import { StorageManager } from '../core/storage.js';
import { CrawlerService } from '../crawler/crawler.js';
import { DiscoveryService } from '../crawler/discovery.js';

export interface SyncCommandOptions {
  key: string;
  version?: string;
  recursive?: boolean;
  concurrency?: number;
  limit?: number;
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

  // 1. Crawl
  const results = await crawler.crawl({
    url,
    recursive: options.recursive,
    concurrency: options.concurrency,
    limit: options.limit,
  });

  if (results.length === 0) {
    throw new Error('Crawl returned zero results. Nothing to sync.');
  }

  // 2. Version Resolution (if 'latest' requested)
  if (version === 'latest') {
    // Try resolving from the root page content
    const rootResult = results.find((r) => r.url === url);
    const resolved = await discovery.resolveVersion(url, rootResult?.content);
    if (resolved) {
      console.warn(`Resolved 'latest' to version: ${resolved}`);
      version = resolved;
    }
  }

  console.warn(`Discovered and transformed ${results.length} pages.`);

  // 3. Storage (CAS + Hardlinks)
  console.warn(`Writing to Content-Addressable Store (Version: ${version})...`);
  await storage.createVersion(
    libId,
    version,
    results.map((r) => ({ path: r.path, content: r.content })),
  );

  // 4. Index for Search
  console.warn('Building search index...');
  await search.indexVersion(
    libId,
    version,
    results.map((r) => ({
      id: r.path,
      title: r.title,
      content: r.content,
      url: r.url,
    })),
  );

  // 5. Registry Update
  const existing = registry.getEntry(libId);
  const syncedAt = new Date().toISOString();

  const entry: RegistryEntry = {
    id: libId,
    type: 'docs',
    name: libId,
    homepage: url,
    versions: {
      ...(existing?.type === 'docs' ? existing.versions : {}),
      [version]: { syncedAt },
    },
  };

  await registry.addEntry(entry);

  console.warn(`\nSuccess! ${libId}@${version} is now synced and indexed.`);
  console.warn(`Storage Location: ${storage.getLibPath(libId, version)}`);
}
