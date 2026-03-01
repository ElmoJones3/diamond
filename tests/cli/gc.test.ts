import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gcCommand } from '#src/cli/gc.js';
import { CasStore } from '#src/core/cas.js';
import { Env } from '#src/core/env.js';

describe('gcCommand', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-gc-'));
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
    process.env.XDG_CACHE_HOME = path.join(tmpDir, 'cache');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('should remove orphaned blobs (nlink === 1)', async () => {
    const cas = new CasStore();
    const hash = await cas.save('orphaned content');
    const blobPath = cas.getStorePath(hash);

    expect(await fs.pathExists(blobPath)).toBe(true);

    await gcCommand();

    expect(await fs.pathExists(blobPath)).toBe(false);
  });

  it('should preserve blobs that have hardlinks from storage', async () => {
    const cas = new CasStore();
    const hash = await cas.save('live content');
    const blobPath = cas.getStorePath(hash);

    // Create a hardlink simulating what StorageManager does
    const linkedPath = path.join(Env.storageDir, 'test-lib', 'latest', 'page.md');
    await fs.ensureDir(path.dirname(linkedPath));
    await fs.link(blobPath, linkedPath);

    await gcCommand();

    // Blob should still exist because nlink > 1
    expect(await fs.pathExists(blobPath)).toBe(true);

    // Clean up the hardlink
    await fs.remove(linkedPath);
  });

  it('should report nothing to collect when the store is empty', async () => {
    // Store dir does not exist yet — should exit cleanly
    await expect(gcCommand()).resolves.not.toThrow();
  });

  it('should clean up empty prefix directories after removing blobs', async () => {
    const cas = new CasStore();
    const hash = await cas.save('another orphan');
    const prefix = hash.slice(0, 2);
    const prefixDir = path.join(Env.storeDir, prefix);

    expect(await fs.pathExists(prefixDir)).toBe(true);

    await gcCommand();

    // The prefix directory should be removed along with the blob
    expect(await fs.pathExists(prefixDir)).toBe(false);
  });
});
