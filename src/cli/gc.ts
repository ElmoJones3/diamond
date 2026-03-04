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
import { getLogger } from '#src/logger.js';

export async function gcCommand(): Promise<void> {
  const log = getLogger().child({ component: 'cli:gc' });

  if (!(await fs.pathExists(Env.storeDir))) {
    log.info('gc:empty');
    return;
  }

  let checked = 0;
  let removed = 0;
  let bytesFreed = 0;

  log.info('gc:start');

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
        log.debug({ hash: blob, bytes: blobStat.size }, 'gc:removed');
      }
    }

    const remaining = await fs.readdir(prefixPath);
    if (remaining.length === 0) {
      await fs.remove(prefixPath);
    }
  }

  log.info({ checked, removed, bytesFreed }, 'gc:complete');
}
