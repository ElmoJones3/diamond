/**
 * CasStore — Diamond's content-addressable store.
 *
 * A content-addressable store (CAS) is a storage system where the *address*
 * of a piece of data is derived from its *content* — specifically its
 * cryptographic hash. This has two powerful properties:
 *
 *   1. Automatic deduplication
 *      The same content can never be stored twice. If two documentation pages
 *      across different library versions are identical (e.g. a changelog page
 *      that didn't change between v1.0 and v1.1), only one copy lives on disk.
 *
 *   2. Built-in integrity checking
 *      Because the filename IS the hash of the content, corruption is
 *      detectable at any time by re-hashing the file and comparing.
 *
 * On-disk layout:
 *   The store uses a two-level directory structure sharded by the first two
 *   hex characters of the hash. This is the same approach used by Git's
 *   object store and npm's cache, and prevents any single directory from
 *   accumulating too many entries (which degrades performance on most
 *   filesystems beyond ~10,000 files per directory).
 *
 *   Example:
 *     hash:  "a3f1b2c4d5..."
 *     path:  $STORE_DIR/a3/a3f1b2c4d5...
 *
 * Writes are atomic:
 *   Content is written to a temp file in the cache directory first, then
 *   renamed into the store with `fs.move()`. A rename is atomic on most
 *   operating systems — the file is never in a partially-written state from
 *   the perspective of other readers. This is important when multiple syncs
 *   could theoretically run concurrently.
 *
 * StorageManager uses the CAS paths to create hardlinks rather than copying
 * files — see `storage.ts` for how the versioned directory views work.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { Env } from './env.js';

export class CasStore {
  /**
   * Store a string in the CAS and return its SHA256 hash.
   *
   * If the content is already in the store (same hash), the write is skipped
   * entirely — the CAS is append-only and immutable, so re-saving the same
   * content is always safe and cheap.
   *
   * @param content The string content to store (e.g. a Markdown page).
   * @returns The hex-encoded SHA256 hash, which also serves as the content's address.
   */
  async save(content: string): Promise<string> {
    const hash = createHash('sha256').update(content).digest('hex');
    const storePath = path.join(Env.storeDir, hash.slice(0, 2), hash);

    // Content already in the store — nothing to do.
    if (await fs.pathExists(storePath)) {
      return hash;
    }

    // Atomic write pattern:
    //   Write to a temp file → rename into the store.
    // If the process crashes mid-write, only the temp file is corrupt; the
    // store entry either fully exists or doesn't exist at all.
    const tempPath = path.join(Env.cacheDir, `temp-${hash}`);
    await fs.ensureDir(path.dirname(storePath));
    await fs.ensureDir(Env.cacheDir);

    await fs.writeFile(tempPath, content);
    await fs.move(tempPath, storePath, { overwrite: true });

    return hash;
  }

  /**
   * Read content from the store by its hash.
   *
   * Throws if the hash doesn't exist in the store — callers should only call
   * this with hashes previously returned by `save()`.
   *
   * @param hash The SHA256 hash returned by a previous `save()` call.
   */
  async get(hash: string): Promise<string> {
    const storePath = path.join(Env.storeDir, hash.slice(0, 2), hash);
    return await fs.readFile(storePath, 'utf-8');
  }

  /**
   * Return the absolute filesystem path for a given hash.
   *
   * StorageManager uses this to create hardlinks pointing into the store,
   * rather than copying the content. Multiple hardlinks to the same inode
   * mean the bytes live on disk exactly once regardless of how many library
   * versions reference them.
   *
   * @param hash The SHA256 hash of the content.
   */
  getStorePath(hash: string): string {
    return path.join(Env.storeDir, hash.slice(0, 2), hash);
  }
}
