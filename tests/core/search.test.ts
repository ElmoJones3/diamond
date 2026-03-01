import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Env } from '#src/core/env.js';
import { type SearchDoc, SearchService } from '#src/core/search.js';

describe('SearchService', () => {
  let tmpDir: string;
  let searchService: SearchService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-search-'));
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
    searchService = new SearchService();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  const mockDocs: SearchDoc[] = [
    {
      id: 'intro',
      title: 'Introduction to Diamond',
      content: 'Diamond is a documentation sync tool.',
      url: 'https://example.com/intro',
    },
    {
      id: 'cli/install',
      title: 'Installation Guide',
      content: 'Run npm install -g diamond to get started.',
      url: 'https://example.com/cli/install',
    },
    {
      id: 'api/cas',
      title: 'CAS Store API',
      content: 'The CasStore handles content-addressable storage.',
      url: 'https://example.com/api/cas',
    },
  ];

  it('should index documents and persist to disk', async () => {
    await searchService.indexVersion('test-lib', '1.0.0', mockDocs);

    const indexPath = path.join(Env.storageDir, 'test-lib', '1.0.0', 'search-index.json');
    expect(await fs.pathExists(indexPath)).toBe(true);

    const indexData = await fs.readJson(indexPath);
    expect(indexData).toBeDefined();
    expect(indexData.documentCount).toBe(3);
  });

  it('should return results for exact matches', async () => {
    await searchService.indexVersion('test-lib', '1.0.0', mockDocs);

    const results = await searchService.search('test-lib', '1.0.0', 'Diamond');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Introduction to Diamond');
  });

  it('should support prefix matching', async () => {
    await searchService.indexVersion('test-lib', '1.0.0', mockDocs);

    const results = await searchService.search('test-lib', '1.0.0', 'Instal');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Installation Guide');
  });

  it('should support fuzzy matching', async () => {
    await searchService.indexVersion('test-lib', '1.0.0', mockDocs);

    // "Diamon" (missing d) should match "Diamond"
    const results = await searchService.search('test-lib', '1.0.0', 'Diamon');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Introduction to Diamond');
  });

  it('should boost title matches over content matches', async () => {
    const docsWithConflict: SearchDoc[] = [
      { id: '1', title: 'Target', content: 'other', url: '' },
      { id: '2', title: 'Other', content: 'Target', url: '' },
    ];
    await searchService.indexVersion('test-lib', '1.0.0', docsWithConflict);

    const results = await searchService.search('test-lib', '1.0.0', 'Target');
    expect(results[0].id).toBe('1'); // Title match should come first
  });

  it('should return empty array if index does not exist', async () => {
    const results = await searchService.search('non-existent', 'latest', 'query');
    expect(results).toEqual([]);
  });

  it('should handle duplicate document IDs by using the last one', async () => {
    const duplicateDocs: SearchDoc[] = [
      { id: 'dup', title: 'First', content: 'v1', url: 'u1' },
      { id: 'dup', title: 'Second', content: 'v2', url: 'u2' },
    ];
    await searchService.indexVersion('test-lib', '1.0.0', duplicateDocs);

    const results = await searchService.search('test-lib', '1.0.0', 'Second');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Second');
  });

  it('should return semantic matches for conceptual queries', async () => {
    const docs: SearchDoc[] = [
      {
        id: 'error-handling',
        title: 'Error Handling',
        content: 'To catch exceptions, use a try/catch block in your async functions.',
        url: 'https://example.com/errors',
      },
      {
        id: 'installation',
        title: 'Installation',
        content: 'Run pnpm install to get all dependencies.',
        url: 'https://example.com/install',
      },
    ];
    await searchService.indexVersion('test-lib', '1.0.0', docs);

    // This query has no keywords in common with "Error Handling" doc content,
    // but is semantically related to "exceptions" and "try/catch".
    const results = await searchService.search('test-lib', '1.0.0', 'how to catch errors and exceptions');

    expect(results.length).toBeGreaterThan(0);
    // Find the error handling result
    const errorRes = results.find((r) => r.id === 'error-handling');
    expect(errorRes).toBeDefined();
    expect(errorRes?.similarity).toBeGreaterThan(0.4);
  }, 30000); // Increase timeout for model download/inference
});
