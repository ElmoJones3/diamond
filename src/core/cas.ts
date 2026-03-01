import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { Env } from './env.js';

/**
 * Manages Diamond's Content-Addressable Store (CAS).
 * Deduplicates files based on their SHA256 content hash.
 */
export class CasStore {
  /**
   * Saves content to the global store and returns its hash.
   * If the content already exists, it skips the write.
   *
   * @param content The string content to store.
   * @returns The SHA256 hash of the content.
   */
  async save(content: string): Promise<string> {
    const hash = createHash('sha256').update(content).digest('hex');
    const storePath = path.join(Env.storeDir, hash.slice(0, 2), hash);

    // If the file already exists in the store, we're done.
    if (await fs.pathExists(storePath)) {
      return hash;
    }

    // Atomic write: save to a temp file and rename it into the store.
    const tempPath = path.join(Env.cacheDir, `temp-${hash}`);
    await fs.ensureDir(path.dirname(storePath));
    await fs.ensureDir(Env.cacheDir);

    await fs.writeFile(tempPath, content);
    await fs.move(tempPath, storePath, { overwrite: true });

    return hash;
  }

  /**
   * Retrieves content from the store by its hash.
   */
  async get(hash: string): Promise<string> {
    const storePath = path.join(Env.storeDir, hash.slice(0, 2), hash);
    return await fs.readFile(storePath, 'utf-8');
  }

  /**
   * Gets the physical path of a file in the store.
   */
  getStorePath(hash: string): string {
    return path.join(Env.storeDir, hash.slice(0, 2), hash);
  }
}
