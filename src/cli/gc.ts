/**
 * gc — garbage collect the content-addressable store.
 *
 * Diamond stores every synced page as a blob in the CAS (content-addressable
 * store) and then hardlinks those blobs into versioned storage directories.
 * When a library is removed with `diamond remove`, the versioned storage
 * directory is deleted, but the CAS blobs are intentionally left behind —
 * they might be shared with other library versions.
 *
 * Over time this can leave blobs in the CAS that are no longer referenced by
 * any versioned directory. These orphaned blobs are safe to delete.
 *
 * Detection strategy:
 *   A hardlink increments a file's link count (`nlink`). A CAS blob starts
 *   with `nlink = 1` (the store entry itself). Every hardlink from a versioned
 *   storage directory adds one more. So if `nlink === 1`, no storage file
 *   references this blob — it's orphaned and can be removed.
 *
 *   This approach is O(n blobs) and requires no cross-referencing against the
 *   storage tree — the filesystem tracks reference counts for us.
 */

import path from 'node:path';
import fs from 'fs-extra';
import { Env } from '#src/core/env.js';

export async function gcCommand(): Promise<void> {
  if (!(await fs.pathExists(Env.storeDir))) {
    console.warn('CAS store is empty — nothing to collect.');
    return;
  }

  let checked = 0;
  let removed = 0;
  let bytesFreed = 0;

  // The store is two levels deep: store/{2-char-prefix}/{full-hash}
  const prefixDirs = await fs.readdir(Env.storeDir);

  for (const prefix of prefixDirs) {
    const prefixPath = path.join(Env.storeDir, prefix);
    const stat = await fs.stat(prefixPath);
    if (!stat.isDirectory()) continue;

    const blobs = await fs.readdir(prefixPath);
    for (const blob of blobs) {
      const blobPath = path.join(prefixPath, blob);
      const blobStat = await fs.stat(blobPath);
      checked++;

      // nlink === 1 means no hardlinks from versioned storage exist.
      if (blobStat.nlink === 1) {
        bytesFreed += blobStat.size;
        await fs.remove(blobPath);
        removed++;
      }
    }

    // Clean up empty prefix directories left behind after blob removal.
    const remaining = await fs.readdir(prefixPath);
    if (remaining.length === 0) {
      await fs.remove(prefixPath);
    }
  }

  if (removed === 0) {
    console.warn(`Checked ${checked} blob(s) — nothing to collect.`);
  } else {
    const kb = (bytesFreed / 1024).toFixed(1);
    console.warn(`Removed ${removed} orphaned blob(s), freed ${kb} KB. (${checked} checked)`);
  }
}
