import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Env } from '#src/core/env.js';
import { StorageManager } from '#src/core/storage.js';

describe('StorageManager', () => {
  let tmpDir: string;
  let storage: StorageManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-storage-'));
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
    process.env.XDG_CACHE_HOME = path.join(tmpDir, 'cache');
    storage = new StorageManager();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('should create a versioned view with hardlinked files', async () => {
    const files = [
      { path: 'index.md', content: '# Welcome' },
      { path: 'api/core.md', content: 'Core API' },
    ];

    await storage.createVersion('test-lib', '1.0.0', files);

    const versionDir = path.join(Env.storageDir, 'test-lib', '1.0.0');
    expect(await fs.pathExists(path.join(versionDir, 'index.md'))).toBe(true);
    expect(await fs.pathExists(path.join(versionDir, 'api/core.md'))).toBe(true);

    const content = await fs.readFile(path.join(versionDir, 'index.md'), 'utf-8');
    expect(content).toBe('# Welcome');

    // Verify it's a hardlink by checking the inode (if supported by FS)
    const stats1 = await fs.stat(path.join(versionDir, 'index.md'));
    // We don't know the CAS path here easily without re-calculating hash,
    // but we can check nlink count which should be at least 2 (CAS + versioned view)
    // Note: Some filesystems/OSs might not report nlink correctly in all environments,
    // but on Darwin/Linux it should be 2.
    expect(stats1.nlink).toBeGreaterThanOrEqual(2);
  });

  it('should update the "latest" symlink', async () => {
    const files = [{ path: 'v1.md', content: 'v1' }];
    await storage.createVersion('test-lib', '1.0.0', files);

    const latestPath = path.join(Env.storageDir, 'test-lib', 'latest');
    expect(await fs.pathExists(latestPath)).toBe(true);

    const stats = await fs.lstat(latestPath);
    expect(stats.isSymbolicLink()).toBe(true);

    const target = await fs.readlink(latestPath);
    expect(target).toBe('1.0.0');

    // Update to v2
    await storage.createVersion('test-lib', '2.0.0', [{ path: 'v2.md', content: 'v2' }]);
    const newTarget = await fs.readlink(latestPath);
    expect(newTarget).toBe('2.0.0');
  });

  it('should overwrite existing version directory', async () => {
    await storage.createVersion('test-lib', '1.0.0', [{ path: 'old.md', content: 'old' }]);
    await storage.createVersion('test-lib', '1.0.0', [{ path: 'new.md', content: 'new' }]);

    const versionDir = path.join(Env.storageDir, 'test-lib', '1.0.0');
    expect(await fs.pathExists(path.join(versionDir, 'old.md'))).toBe(false);
    expect(await fs.pathExists(path.join(versionDir, 'new.md'))).toBe(true);
  });

  it('should handle nested directory structures in file paths', async () => {
    const files = [{ path: 'very/deep/nested/file.md', content: 'deep' }];
    await storage.createVersion('test-lib', '1.0.0', files);

    const filePath = path.join(Env.storageDir, 'test-lib', '1.0.0', 'very/deep/nested/file.md');
    expect(await fs.pathExists(filePath)).toBe(true);
    expect(await fs.readFile(filePath, 'utf-8')).toBe('deep');
  });
});
