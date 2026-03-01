import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Env } from '#src/core/env.js';
import { type RegistryEntry, RegistryManager } from '#src/core/registry.js';

describe('RegistryManager', () => {
  let tmpDir: string;
  let registry: RegistryManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-test-registry-'));
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, 'config');
    registry = new RegistryManager();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  const mockDocsEntry: RegistryEntry = {
    id: 'msw',
    type: 'docs',
    name: 'Mock Service Worker',
    homepage: 'https://mswjs.io',
    versions: {
      '2.12.10': { syncedAt: new Date().toISOString() },
    },
  };

  const mockRepoEntry: RegistryEntry = {
    id: 'local-app',
    type: 'repo',
    name: 'Local App',
    localPath: '/Users/sf/work/local-app',
    config: {
      syncStrategy: 'git',
      branch: 'main',
      autoPull: true,
    },
    syncedAt: new Date().toISOString(),
  };

  it('should initialize empty if no registry file exists', async () => {
    await registry.init();
    expect(registry.listEntries()).toEqual([]);
  });

  it('should add and retrieve entries', async () => {
    await registry.addEntry(mockDocsEntry);

    const entry = registry.getEntry('msw');
    expect(entry).toEqual(mockDocsEntry);

    const all = registry.listEntries();
    expect(all).toContainEqual(mockDocsEntry);
  });

  it('should persist entries to disk', async () => {
    await registry.addEntry(mockDocsEntry);

    expect(await fs.pathExists(Env.registryPath)).toBe(true);
    const data = await fs.readJson(Env.registryPath);
    expect(data.msw).toEqual(mockDocsEntry);
  });

  it('should load entries from disk on init', async () => {
    // Manually create registry file
    await fs.ensureDir(Env.configDir);
    await fs.writeJson(Env.registryPath, {
      msw: mockDocsEntry,
      'local-app': mockRepoEntry,
    });

    await registry.init();

    expect(registry.getEntry('msw')).toEqual(mockDocsEntry);
    expect(registry.getEntry('local-app')).toEqual(mockRepoEntry);
    expect(registry.listEntries().length).toBe(2);
  });

  it('should handle corrupted registry file gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await fs.ensureDir(Env.configDir);
    await fs.writeFile(Env.registryPath, 'not-json');

    await registry.init();

    expect(registry.listEntries()).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle schema validation errors during init', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await fs.ensureDir(Env.configDir);
    await fs.writeJson(Env.registryPath, {
      invalid: { type: 'docs', id: 'invalid' }, // Missing required fields
    });

    await registry.init();

    expect(registry.listEntries()).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should remove entries and persist the change', async () => {
    await registry.addEntry(mockDocsEntry);
    await registry.removeEntry('msw');

    expect(registry.getEntry('msw')).toBeUndefined();

    const data = await fs.readJson(Env.registryPath);
    expect(data.msw).toBeUndefined();
  });

  it('should overwrite entry if added with same ID', async () => {
    await registry.addEntry(mockDocsEntry);

    const updatedEntry = { ...mockDocsEntry, name: 'Updated MSW' };
    await registry.addEntry(updatedEntry);

    expect(registry.getEntry('msw')?.name).toBe('Updated MSW');
    expect(registry.listEntries().length).toBe(1);
  });
});
