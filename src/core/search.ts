import path from 'node:path';
import fs from 'fs-extra';
import MiniSearch from 'minisearch';
import { Env } from './env.js';

export interface SearchDoc {
  id: string; // The relative path (e.g., api/editors.md)
  title: string;
  content: string;
  url: string;
}

/**
 * Manages per-library search indices using MiniSearch.
 */
export class SearchService {
  /**
   * Builds and persists a search index for a specific library version.
   */
  async indexVersion(libId: string, version: string, docs: SearchDoc[]): Promise<void> {
    const miniSearch = new MiniSearch({
      fields: ['title', 'content'], // Fields to index for full-text search
      storeFields: ['title', 'url'], // Fields to return with search results
      idField: 'id',
    });

    miniSearch.addAll(docs);

    const indexPath = path.join(Env.storageDir, libId, version, 'search-index.json');
    await fs.writeJson(indexPath, miniSearch.toJSON());
  }

  /**
   * Searches a library's index and returns results.
   */
  async search(libId: string, version: string, query: string): Promise<any[]> {
    const indexPath = path.join(Env.storageDir, libId, version, 'search-index.json');

    if (!(await fs.pathExists(indexPath))) {
      return [];
    }

    const indexData = await fs.readJson(indexPath);
    const miniSearch = MiniSearch.loadJSON(JSON.stringify(indexData), {
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    return miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 2 },
    });
  }
}
