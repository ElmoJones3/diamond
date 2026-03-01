/**
 * SearchService — full-text and semantic search over stored documentation.
 */

import path from 'node:path';
import fs from 'fs-extra';
import MiniSearch from 'minisearch';
import { Env } from '#src/core/env.js';
import { type VectorChunk, VectorService } from '#src/core/vector.js';

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

    if (!(await fs.pathExists(keywordPath))) return [];

    // 1. Keyword Search
    const keywordResults = await this.runKeywordSearch(keywordPath, query);

    // 2. Semantic Search
    const semanticResults = await this.runSemanticSearch(vectorPath, query);

    // 3. Hybrid Reranking
    return this.rerankHybrid(keywordResults, semanticResults);
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

  private async runSemanticSearch(vectorPath: string, query: string): Promise<DiamondSearchResult[]> {
    if (!(await fs.pathExists(vectorPath))) return [];

    const vectorIndexData: VectorChunk[] = await fs.readJson(vectorPath);
    const queryEmbedding = await this.vectorService.embed(query);

    const chunkScores = vectorIndexData.map((chunk) => ({
      docId: chunk.docId,
      title: chunk.title,
      url: chunk.url,
      similarity: this.vectorService.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    const docScores = new Map<string, { docId: string; title: string; url: string; similarity: number }>();
    for (const s of chunkScores) {
      const existing = docScores.get(s.docId);
      if (!existing || existing.similarity < s.similarity) {
        docScores.set(s.docId, s);
      }
    }

    return Array.from(docScores.values()).map((s) => ({
      id: s.docId,
      title: s.title,
      url: s.url,
      score: s.similarity,
      similarity: s.similarity,
    }));
  }

  private rerankHybrid(keyword: DiamondSearchResult[], semantic: DiamondSearchResult[]): DiamondSearchResult[] {
    const finalResults = new Map<string, DiamondSearchResult>();

    for (const res of keyword) {
      finalResults.set(res.id, {
        id: res.id,
        title: (res as unknown as { title: string }).title,
        url: (res as unknown as { url: string }).url,
        score: res.score,
        match: res.match,
        terms: res.terms,
      });
    }

    for (const res of semantic) {
      const existing = finalResults.get(res.id);
      if (existing) {
        existing.similarity = res.similarity;
        if (res.similarity !== undefined) {
          existing.score = existing.score * (1 + res.similarity);
        }
      } else if (res.similarity !== undefined && res.similarity > 0.5) {
        finalResults.set(res.id, res);
      }
    }

    return Array.from(finalResults.values()).sort((a, b) => b.score - a.score);
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
    const vectorPath = path.join(indexDir, 'vector-index.json');

    if (!(await fs.pathExists(keywordPath))) {
      if (type !== 'unlink') await this.indexRepo(repoId, localPath);
      return;
    }

    await this.updateKeywordFile(keywordPath, localPath, filePath, repoId, type);
    await this.updateVectorFile(vectorPath, localPath, filePath, repoId, type);
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

  private async updateVectorFile(
    vectorPath: string,
    localPath: string,
    filePath: string,
    repoId: string,
    type: 'add' | 'change' | 'unlink',
  ) {
    if (!(await fs.pathExists(vectorPath))) return;

    let vectorChunks: VectorChunk[] = await fs.readJson(vectorPath);
    const relPath = path.relative(localPath, filePath);

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
        /* ignore */
      }
    }
    await fs.writeJson(vectorPath, vectorChunks);
  }

  private isSupportedFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ['.md', '.mdx', '.txt', '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs'].includes(ext);
  }
}
