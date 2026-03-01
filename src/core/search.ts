/**
 * SearchService — full-text and semantic search over stored documentation.
 *
 * Diamond uses a hybrid search strategy that combines two complementary engines:
 *
 *   1. MiniSearch (Keyword Engine)
 *      - Fast, in-memory, inverted index.
 *      - Perfect for matching exact technical terms like "useEffect" or "cli --key".
 *      - Supports fuzzy/prefix matching for typo-tolerance.
 *      - MiniSearch is an in-process, zero-dependency library that builds
 *        an inverted index in memory.
 *
 *   2. Semantic Search (Embedding Engine via VectorService)
 *      - Local SBERT model (Xenova/all-MiniLM-L6-v2) generates document vectors.
 *      - Perfect for "natural language" queries like "how to handle errors" where
 *        exact keywords might not match the documentation text.
 *      - Works by calculating the cosine similarity between the query vector
 *        and the stored document/chunk vectors.
 *
 * Why not a database or an external search service?
 *   Diamond's core design principle is "offline by default". Once docs are
 *   synced, everything — storage and search — should work without a network
 *   connection. This hybrid approach fits perfectly: it's fast, tiny, and both
 *   indices serialize to plain JSON files that live alongside the Markdown content.
 *
 * Ranking (Hybrid Search):
 *   Final search scores are a weighted combination of keyword and semantic scores.
 *   This gives the best of both worlds: precision for specific technical lookups
 *   and recall for conceptual questions.
 *
 * Index lifecycle:
 *   1. `indexVersion()` is called once after a sync completes. It builds the
 *      keyword index and generates semantic embeddings for all crawled pages,
 *      writing both to disk as JSON.
 *   2. `search()` is called at query time. It deserializes both indices,
 *      generates a query embedding, and runs the hybrid search.
 *
 * Index location:
 *   `$STORAGE_DIR/{libId}/{version}/search-index.json` (Keyword)
 *   `$STORAGE_DIR/{libId}/{version}/vector-index.json` (Semantic)
 */

import path from 'node:path';
import fs from 'fs-extra';
import MiniSearch from 'minisearch';
import { Env } from '#src/core/env.js';
import { VectorService, type VectorChunk } from '#src/core/vector.js';

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
  /** High-level indicator of the match quality (0 to 1). */
  similarity?: number;
}

export class SearchService {
  private vectorService = new VectorService();

  /**
   * Build a search index for a library version and persist it to disk.
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

    const vectorChunks: VectorChunk[] = [];
    await this.vectorService.init();

    // Deduplicate by ID before indexing
    const seen = new Map<string, SearchDoc>();
    for (const doc of docs) seen.set(doc.id, doc);
    const uniqueDocs = Array.from(seen.values());

    miniSearch.addAll(uniqueDocs);

    // Generate semantic chunks and embeddings
    for (const doc of uniqueDocs) {
      const textChunks = this.vectorService.chunkMarkdown(doc.content);
      for (const text of textChunks) {
        const embedding = await this.vectorService.embed(text);
        vectorChunks.push({
          docId: doc.id,
          text,
          title: doc.title,
          url: doc.url,
          embedding,
        });
      }
    }

    const indexDir = path.join(Env.storageDir, libId, version);
    await fs.ensureDir(indexDir);

    // Persist both indices
    await fs.writeJson(path.join(indexDir, 'search-index.json'), miniSearch.toJSON());
    await fs.writeJson(path.join(indexDir, 'vector-index.json'), vectorChunks);
  }

  /**
   * Search a library's index and return ranked results.
   */
  async search(libId: string, version: string, query: string): Promise<DiamondSearchResult[]> {
    const indexDir = path.join(Env.storageDir, libId, version);
    const keywordPath = path.join(indexDir, 'search-index.json');
    const vectorPath = path.join(indexDir, 'vector-index.json');

    if (!(await fs.pathExists(keywordPath))) {
      return [];
    }

    // 1. Keyword Search (MiniSearch)
    const keywordIndexData = await fs.readJson(keywordPath);
    const miniSearch = MiniSearch.loadJSON(JSON.stringify(keywordIndexData), {
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    const keywordResults = miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 2 },
    });

    // 2. Semantic Search (Embeddings)
    let semanticResults: DiamondSearchResult[] = [];
    if (await fs.pathExists(vectorPath)) {
      const vectorIndexData: VectorChunk[] = await fs.readJson(vectorPath);
      const queryEmbedding = await this.vectorService.embed(query);

      // Rank chunks by cosine similarity
      const chunkScores = vectorIndexData.map(chunk => ({
        docId: chunk.docId,
        title: chunk.title,
        url: chunk.url,
        similarity: this.vectorService.cosineSimilarity(queryEmbedding, chunk.embedding),
      }));

      // Group by document (keeping highest similarity per doc)
      const docScores = new Map<string, any>();
      for (const s of chunkScores) {
        if (!docScores.has(s.docId) || docScores.get(s.docId).similarity < s.similarity) {
          docScores.set(s.docId, s);
        }
      }

      semanticResults = Array.from(docScores.values()).map(s => ({
        id: s.docId,
        title: s.title,
        url: s.url,
        score: s.similarity, // Use similarity as base score for now
        similarity: s.similarity,
      }));
    }

    // 3. Hybrid Reranking
    const finalResults = new Map<string, DiamondSearchResult>();

    // Start with keyword results
    for (const res of keywordResults) {
      finalResults.set(res.id, {
        id: res.id,
        title: (res as any).title,
        url: (res as any).url,
        score: res.score,
        match: res.match,
        terms: res.terms,
      });
    }

    // Merge/Boost with semantic results
    for (const res of semanticResults) {
      const existing = finalResults.get(res.id);
      if (existing) {
        // Boost existing keyword match
        existing.similarity = res.similarity;
        existing.score = existing.score * (1 + res.similarity!);
      } else if (res.similarity! > 0.5) { // Only add new semantic-only matches if they are strong
        finalResults.set(res.id, res);
      }
    }

    return Array.from(finalResults.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Build an initial search index for a local repository.
   *
   * Walks the local filesystem, reads supported files (Markdown, code),
   * and builds both keyword and vector indices.
   *
   * @param repoId    The repository identifier.
   * @param localPath Absolute path to the repo root.
   */
  async indexRepo(repoId: string, localPath: string): Promise<void> {
    const docs: SearchDoc[] = [];
    const walk = async (dir: string) => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = path.relative(localPath, fullPath);

        // Skip common ignored directories
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build') {
          continue;
        }

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
   *
   * This is called by the WatcherService for "live" updates.
   * It performs an incremental update of both keyword and vector indices.
   */
  async updateRepoFile(
    repoId: string,
    localPath: string,
    filePath: string,
    type: 'add' | 'change' | 'unlink',
  ): Promise<void> {
    const indexDir = path.join(Env.storageDir, repoId, 'latest');
    const keywordPath = path.join(indexDir, 'search-index.json');
    const vectorPath = path.join(indexDir, 'vector-index.json');

    if (!(await fs.pathExists(keywordPath))) {
      // If no index exists, do a full index instead of incremental
      if (type !== 'unlink') await this.indexRepo(repoId, localPath);
      return;
    }

    // 1. Update Keyword Index
    const keywordIndexData = await fs.readJson(keywordPath);
    const miniSearch = MiniSearch.loadJSON(JSON.stringify(keywordIndexData), {
      fields: ['title', 'content'],
      storeFields: ['title', 'url'],
      idField: 'id',
    });

    const relPath = path.relative(localPath, filePath);

    if (type === 'unlink') {
      if (miniSearch.has(relPath)) miniSearch.removeById(relPath);
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
        // file might have been deleted between event and read
        if (miniSearch.has(relPath)) miniSearch.removeById(relPath);
      }
    }

    await fs.writeJson(keywordPath, miniSearch.toJSON());

    // 2. Update Vector Index (Simple replacement for now)
    if (await fs.pathExists(vectorPath)) {
      let vectorChunks: VectorChunk[] = await fs.readJson(vectorPath);

      // Remove old chunks for this file
      vectorChunks = vectorChunks.filter((c) => c.docId !== relPath);

      if (type !== 'unlink' && this.isSupportedFile(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const textChunks = this.vectorService.chunkMarkdown(content);
          for (const text of textChunks) {
            const embedding = await this.vectorService.embed(text);
            vectorChunks.push({
              docId: relPath,
              text,
              title: path.basename(filePath),
              url: `repo://${repoId}/${relPath}`,
              embedding,
            });
          }
        } catch (_e) {
          // ignore
        }
      }
      await fs.writeJson(vectorPath, vectorChunks);
    }
  }

  private isSupportedFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.md', '.mdx', '.txt', '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs'].includes(ext);
  }
}
