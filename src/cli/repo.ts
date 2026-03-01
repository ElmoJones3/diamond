import path from 'node:path';
import fs from 'fs-extra';
import { RegistryManager } from '../core/registry.js';

export async function addRepoCommand(localPath: string, options: { key?: string }) {
  const registry = new RegistryManager();
  await registry.init();

  const absolutePath = path.resolve(localPath);

  if (!(await fs.pathExists(path.join(absolutePath, '.git')))) {
    throw new Error(`The directory '${absolutePath}' is not a git repository.`);
  }

  const repoId = options.key || path.basename(absolutePath);

  await registry.addEntry({
    id: repoId,
    type: 'repo',
    name: repoId,
    localPath: absolutePath,
    config: {
      syncStrategy: 'git',
      autoPull: true,
    },
    syncedAt: new Date().toISOString(),
  });

  console.warn(`
Success! Repository '${repoId}' is now tracked in the registry.`);
  console.warn(`Local Path: ${absolutePath}`);
}
