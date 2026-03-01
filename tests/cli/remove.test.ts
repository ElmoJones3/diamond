import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeCommand } from '#src/cli/remove.js';
import { Env } from '#src/core/env.js';
import { RegistryManager } from '#src/core/registry.js';

describe('removeCommand', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-remove-'));
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');
    process.env.XDG_DATA_HOME = path.join(tmpDir, 'data');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('should remove a docs entry and its storage', async () => {
    const registry = new RegistryManager();
    const id = 'test-lib';

    // 1. Setup registry entry
    await registry.addEntry({
      id,
      type: 'docs',
      name: 'Test Lib',
      homepage: 'https://example.com',
      versions: { '1.0.0': { syncedAt: new Date().toISOString() } },
    });

    // 2. Setup storage directory
    const libDir = path.join(Env.storageDir, id);
    await fs.ensureDir(libDir);
    await fs.writeFile(path.join(libDir, 'test.md'), '# Test');

    // 3. Run remove
    await removeCommand(id);

    // 4. Verify registry entry is gone
    await registry.init();
    expect(registry.getEntry(id)).toBeUndefined();

    // 5. Verify storage directory is deleted
    expect(await fs.pathExists(libDir)).toBe(false);
  });

  it('should remove a repo entry but keep its local files', async () => {
    const registry = new RegistryManager();
    const id = 'test-repo';
    const localPath = path.join(tmpDir, 'my-repo');
    await fs.ensureDir(localPath);
    await fs.writeFile(path.join(localPath, 'README.md'), '# Repo');

    // 1. Setup registry entry
    await registry.addEntry({
      id,
      type: 'repo',
      name: 'Test Repo',
      localPath,
      config: { syncStrategy: 'git', autoPull: true },
      syncedAt: new Date().toISOString(),
    });

    // 2. Run remove
    await removeCommand(id);

    // 3. Verify registry entry is gone
    await registry.init();
    expect(registry.getEntry(id)).toBeUndefined();

    // 4. Verify local files still exist
    expect(await fs.pathExists(localPath)).toBe(true);
    expect(await fs.pathExists(path.join(localPath, 'README.md'))).toBe(true);
  });

  it('should throw if the entry does not exist', async () => {
    await expect(removeCommand('non-existent')).rejects.toThrow('No registry entry found with id "non-existent"');
  });
});
