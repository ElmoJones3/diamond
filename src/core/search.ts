/**
 * SearchService — full-text search over stored documentation.
 */

import path from 'node:path';
import fs from 'fs-extra';
import MiniSearch from 'minisearch';
import { Env } from '#src/core/env.js';
import { getLogger } from '#src/logger.js';

/** The shape of a document as it enters the search index. */
export interface SearchDoc {
  /** The relative file path, used as the document's unique ID (e.g. "api/handlers"). */
  id: string;
  /** The page title — weighted more heavily in search results. */
  title: string;
  /** The full Markdown content of the page — indexed but not stored in results. */
  content: string;
  /** The original URL of the page — stored so it can be returned with results. */
  url: string;
}

/** The shape of a search result. */
export interface DiamondSearchResult {
  id: string;
  title: string;
  url: string;
  score: number;
  match?: Record<string, string[]>;
  terms?: string[];
}

export class SearchService {
  /**
   * Build (or merge into) the keyword search index for a library version.
   *
   * MiniSearch is the main search interface; it is available immediately
   * after this call returns.
   */
  async indexVersion(libId: string, version: string, docs: SearchDoc[]): Promise<void> {
    const log = getLogger().child({ component: 'core:SearchService' });
    log.debug({ lib: libId, version, docCount: docs.length }, 'search:index_start');

    const indexDir = path.join(Env.storageDir, libId, version);
    await fs.ensureDir(indexDir);

    const keywordPath = path.join(indexDir, 'search-index.json');

    let miniSearch: MiniSearch;
    if (await fs.pathExists(keywordPath)) {
      const data = await fs.readJson(keywordPath);
      miniSearch = MiniSearch.loadJSON(JSON.stringify(data), {
        fields: ['title', 'content'],
        storeFields: ['title', 'url'],
        idField: 'id',
        autoVacuum: false,
      });
    } else {
      miniSearch = new MiniSearch({
        fields: ['title', 'content'],
        storeFields: ['title', 'url'],
        idField: 'id',
        autoVacuum: false,
      });
    }

    const seen = new Map<string, SearchDoc>();
    for (const doc of docs) seen.set(doc.id, doc);
    const uniqueDocs = Array.from(seen.values());

    let newCount = 0;
    let replaceCount = 0;
    for (const doc of uniqueDocs) {
      if (miniSearch.has(doc.id)) {
        miniSearch.replace(doc);
        replaceCount++;
      } else {
        miniSearch.add(doc);
        newCount++;
      }
    }

    log.debug({ lib: libId, new: newCount, replaced: replaceCount }, 'search:merge');

    await fs.writeJson(keywordPath, miniSearch.toJSON());
  }

  /**
   * Search a library's index and return ranked results.
   */
  async search(libId: string, version: string, query: string): Promise<DiamondSearchResult[]> {
    const log = getLogger().child({ component: 'core:SearchService' });
    const startTime = Date.now();
    const indexDir = path.join(Env.storageDir, libId, version);
    const keywordPath = path.join(indexDir, 'search-index.json');

    if (!(await fs.pathExists(keywordPath))) return [];

    const results = await this.runKeywordSearch(keywordPath, query);
    log.debug({ query, resultCount: results.length, duration_ms: Date.now() - startTime }, 'search:query');
    return results;
  }

  private async runKeywordSearch(keywordPath: string, query: string): Promise<DiamondSearchResult[]> {
    const data = await fs.readJson(keywordPath);
    const miniSearch = MiniSearch.loadJSON(JSON.stringify(data), {
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    return miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 2 },
    }) as unknown as DiamondSearchResult[];
  }

  /**
   * Build an initial search index for a local repository.
   */
  async indexRepo(repoId: string, localPath: string): Promise<void> {
    const docs: SearchDoc[] = [];
    const walk = async (dir: string) => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = path.relative(localPath, fullPath);

        if (['node_modules', '.git', 'dist', 'build'].includes(file)) continue;

        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (this.isSupportedFile(file)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          docs.push({
            id: relPath,
            title: path.basename(file),
            content,
            url: `repo://${repoId}/${relPath}`,
          });
        }
      }
    };

    await walk(localPath);
    await this.indexVersion(repoId, 'latest', docs);
  }

  /**
   * Update a single file in a repository's index.
   */
  async updateRepoFile(
    repoId: string,
    localPath: string,
    filePath: string,
    type: 'add' | 'change' | 'unlink',
  ): Promise<void> {
    const indexDir = path.join(Env.storageDir, repoId, 'latest');
    const keywordPath = path.join(indexDir, 'search-index.json');

    if (!(await fs.pathExists(keywordPath))) {
      if (type !== 'unlink') await this.indexRepo(repoId, localPath);
      return;
    }

    await this.updateKeywordFile(keywordPath, localPath, filePath, repoId, type);
  }

  private async updateKeywordFile(
    keywordPath: string,
    localPath: string,
    filePath: string,
    repoId: string,
    type: 'add' | 'change' | 'unlink',
  ) {
    const data = await fs.readJson(keywordPath);
    const miniSearch = MiniSearch.loadJSON(JSON.stringify(data), {
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    const relPath = path.relative(localPath, filePath);

    if (type === 'unlink') {
      if (miniSearch.has(relPath)) miniSearch.discard(relPath);
    } else if (this.isSupportedFile(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const doc = {
          id: relPath,
          title: path.basename(filePath),
          content,
          url: `repo://${repoId}/${relPath}`,
        };
        if (miniSearch.has(relPath)) {
          miniSearch.replace(doc);
        } else {
          miniSearch.add(doc);
        }
      } catch (_e) {
        if (miniSearch.has(relPath)) miniSearch.discard(relPath);
      }
    }
    await fs.writeJson(keywordPath, miniSearch.toJSON());
  }

  private isSupportedFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.md', '.mdx', '.txt', '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs'].includes(ext);
  }
}
