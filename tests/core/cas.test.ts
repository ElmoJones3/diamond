import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CasStore } from '#src/core/cas.js';
import { Env } from '#src/core/env.js';

describe('CasStore', () => {
  let tmpDir: string;
  let store: CasStore;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-'));

    // Override XDG environment variables to use our temp directory
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
    process.env.XDG_CACHE_HOME = path.join(tmpDir, 'cache');
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');

    store = new CasStore();
  });

  afterEach(async () => {
    // Clean up the temporary directory
    await fs.remove(tmpDir);
  });

  it('should save content and return its SHA256 hash', async () => {
    const content = 'Hello, Diamond!';
    const expectedHash = 'cd9c516da6d733d2d25e910aeba8f80067d416d9e4af8b22c2fe11680e203079';

    const hash = await store.save(content);

    expect(hash).toBe(expectedHash);

    // Check if file exists in the store with correct sharding
    const storePath = path.join(Env.storeDir, expectedHash.slice(0, 2), expectedHash);
    expect(await fs.pathExists(storePath)).toBe(true);

    const storedContent = await fs.readFile(storePath, 'utf-8');
    expect(storedContent).toBe(content);
  });

  it('should retrieve content by hash', async () => {
    const content = 'Retrieve me';
    const hash = await store.save(content);

    const retrieved = await store.get(hash);
    expect(retrieved).toBe(content);
  });

  it('should deduplicate identical content', async () => {
    const content = 'Duplicate';
    const hash1 = await store.save(content);

    // Get stats of the file after first save
    const storePath = store.getStorePath(hash1);
    const stats1 = await fs.stat(storePath);

    // Save again
    const hash2 = await store.save(content);

    expect(hash1).toBe(hash2);

    // Ensure it didn't actually write a new file (mtime should be same)
    const stats2 = await fs.stat(storePath);
    expect(stats1.mtimeMs).toBe(stats2.mtimeMs);
  });

  it('should throw when getting a non-existent hash', async () => {
    const nonExistentHash = 'abc1234567890';
    await expect(store.get(nonExistentHash)).rejects.toThrow();
  });

  it('should handle atomic writes via temp files', async () => {
    const content = 'Atomic write test';
    const hash = await store.save(content);

    // Verify it exists in the final location
    const storePath = store.getStorePath(hash);
    expect(await fs.pathExists(storePath)).toBe(true);

    // Verify cache is empty (temp files should be moved/cleaned up)
    const cacheFiles = await fs.readdir(Env.cacheDir);
    expect(cacheFiles.length).toBe(0);
  });
});
