/**
 * SearchService — full-text search over stored documentation.
 *
 * Diamond uses MiniSearch (https://lucaong.github.io/minisearch/) as its
 * search engine. MiniSearch is an in-process, zero-dependency library that
 * builds an inverted index in memory and supports:
 *
 *   • Prefix matching  — "hand" matches "handlers", "handleRequest", etc.
 *   • Fuzzy matching   — tolerates typos (configurable edit distance).
 *   • Field boosting   — title matches score higher than body matches.
 *
 * Why not a database or an external search service?
 *   Diamond's core design principle is "offline by default". Once docs are
 *   synced, everything — storage and search — should work without a network
 *   connection. MiniSearch fits perfectly: it's fast, tiny, and the index
 *   serializes to a plain JSON file that lives alongside the Markdown content.
 *
 * Index lifecycle:
 *   1. `indexVersion()` is called once after a sync completes. It builds the
 *      index from all crawled pages and writes it to disk as JSON.
 *   2. `search()` is called at query time. It deserializes the JSON index
 *      back into a MiniSearch instance and runs the query.
 *
 * Index location:
 *   `$STORAGE_DIR/{libId}/{version}/search-index.json`
 *   e.g. `~/.local/share/diamond/storage/msw/2.12.10/search-index.json`
 */

import path from 'node:path';
import fs from 'fs-extra';
import MiniSearch from 'minisearch';
import { Env } from '#src/core/env.js';

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
  match: Record<string, string[]>;
  terms: string[];
}

export class SearchService {
  /**
   * Build a search index for a library version and persist it to disk.
   *
   * This runs once per sync. The index is serialized to JSON and stored
   * alongside the Markdown files so it survives across process restarts.
   *
   * MiniSearch configuration:
   *   - `fields`       — which document fields to tokenize and index.
   *   - `storeFields`  — which fields to include in search results (these
   *                      are stored verbatim, not indexed for search).
   *   - `idField`      — the unique document identifier.
   *
   * @param libId   The library identifier (e.g. "msw").
   * @param version The version being indexed (e.g. "2.12.10").
   * @param docs    The array of documents to index.
   */
  async indexVersion(libId: string, version: string, docs: SearchDoc[]): Promise<void> {
    const miniSearch = new MiniSearch({
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    // Deduplicate by ID before indexing. Duplicate paths can occur when a
    // sitemap and link-following both discover the same page under slightly
    // different URLs (e.g. with/without trailing slash). Last write wins.
    const seen = new Map<string, SearchDoc>();
    for (const doc of docs) seen.set(doc.id, doc);
    miniSearch.addAll(Array.from(seen.values()));

    const indexPath = path.join(Env.storageDir, libId, version, 'search-index.json');
    await fs.ensureDir(path.dirname(indexPath));
    await fs.writeJson(indexPath, miniSearch.toJSON());
  }

  /**
   * Search a library's index and return ranked results.
   *
   * Deserializes the persisted JSON index and runs the query with:
   *   - Prefix matching (`prefix: true`) — so partial words like "hand" match
   *     "handlers" without the user typing the full term.
   *   - Fuzzy matching (`fuzzy: 0.2`) — allows up to 20% edit distance, so a
   *     single typo like "hanlers" still finds "handlers".
   *   - Title boost (`boost: { title: 2 }`) — pages whose title matches the
   *     query score twice as high as pages where only the body matches.
   *
   * Returns an empty array if no index exists for the requested version
   * (i.e. the library hasn't been synced yet) rather than throwing.
   *
   * @param libId   The library identifier to search.
   * @param version The version to search (use "latest" for the current version).
   * @param query   The search query string.
   * @returns       An array of MiniSearch result objects, ordered by relevance score.
   */
  async search(libId: string, version: string, query: string): Promise<DiamondSearchResult[]> {
    const indexPath = path.join(Env.storageDir, libId, version, 'search-index.json');

    if (!(await fs.pathExists(indexPath))) {
      return [];
    }

    // MiniSearch.loadJSON requires a string, not a parsed object — convert back.
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
    }) as unknown as DiamondSearchResult[];
  }
}
