import path from 'node:path';
import fs from 'fs-extra';
import { RegistryManager } from '#src/core/registry.js';
import { Env } from '#src/core/env.js';

/**
 * Remove an entry from Diamond's registry.
 *
 * For `docs` entries, this also deletes the versioned storage directory
 * (the hardlinked Markdown files and search index). The CAS blobs are
 * intentionally left alone — they may be shared with other libraries.
 *
 * For `repo` entries, only the registry record is removed. The actual
 * repository on disk is not touched.
 */
export async function removeCommand(id: string): Promise<void> {
  const registry = new RegistryManager();
  await registry.init();

  const entry = registry.getEntry(id);
  if (!entry) {
    throw new Error(`No registry entry found with id "${id}"`);
  }

  if (entry.type === 'docs') {
    const libDir = path.join(Env.storageDir, id);
    if (await fs.pathExists(libDir)) {
      await fs.remove(libDir);
      console.warn(`Removed storage for "${id}" (${libDir})`);
    }
  }

  await registry.removeEntry(id);
  console.warn(`Removed "${id}" from registry`);
}
