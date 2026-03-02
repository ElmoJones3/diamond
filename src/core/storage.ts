import path from 'node:path';
import fs from 'fs-extra';
import { CasStore } from '#src/core/cas.js';
import { Env } from '#src/core/env.js';

/**
 * Manages the "Project" view (hardlinks and symlinks) of Diamond's storage.
 */
export class StorageManager {
  private cas = new CasStore();

  /**
   * Creates a versioned view for a library by hardlinking files from the CAS.
   *
   * @param libId The identifier for the library (e.g., 'lexical').
   * @param version The version string (e.g., '0.21.0').
   * @param files An array of { path, content } objects to be stored and linked.
   */
  async createVersion(libId: string, version: string, files: { path: string; content: string }[]): Promise<void> {
    const versionDir = path.join(Env.storageDir, libId, version);

    // Clear the version directory so stale files from a previous sync are removed.
    await fs.remove(versionDir);
    await fs.ensureDir(versionDir);

    for (const file of files) {
      // 1. Save to CAS
      const hash = await this.cas.save(file.content);
      const storePath = this.cas.getStorePath(hash);

      // 2. Resolve target path
      const targetPath = path.join(versionDir, file.path);
      await fs.ensureDir(path.dirname(targetPath));

      // 3. Create hardlink (atomic)
      try {
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
        }
        await fs.link(storePath, targetPath);
      } catch (_e) {
        // Fallback to copy if hardlink fails (e.g., cross-device)
        await fs.copy(storePath, targetPath);
      }
    }

    // Update the 'latest' symlink (skip if version is already 'latest')
    if (version !== 'latest') {
      await this.updateLatest(libId, version);
    }
  }

  /**
   * Updates the 'latest' symlink for a library to point to the specified version.
   */
  private async updateLatest(libId: string, version: string): Promise<void> {
    const latestPath = path.join(Env.storageDir, libId, 'latest');
    const _versionDir = path.join(Env.storageDir, libId, version);

    // Ensure the symlink is relative for portability
    const relativeTarget = version;

    if (await fs.pathExists(latestPath)) {
      await fs.remove(latestPath);
    }
    await fs.ensureDir(path.dirname(latestPath));
    await fs.symlink(relativeTarget, latestPath, 'dir');
  }

  /**
   * Returns the absolute path for a library's version.
   */
  getLibPath(libId: string, version: string = 'latest'): string {
    return path.join(Env.storageDir, libId, version);
  }
}
