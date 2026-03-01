/**
 * repo add command — register a local git repository with Diamond.
 *
 * Unlike `sync`, which crawls a remote website, `repo add` is for source code
 * you already have on disk. Diamond doesn't copy or index the files — it just
 * records the repository's location in the registry so the MCP server can
 * serve files from it on demand via the `repo://{id}/{path}` resource URI.
 *
 * This is useful for giving an AI assistant access to a private codebase or
 * a library you're actively developing, without needing to publish it anywhere.
 *
 * What gets stored:
 *   - The absolute path to the repo on the local filesystem.
 *   - The sync strategy (always "git" for repos).
 *   - A timestamp of when it was registered.
 *
 * What does NOT get stored:
 *   - Any file contents. Diamond reads directly from the original checkout.
 *
 * Example:
 *   diamond repo add ~/work/my-library --key my-library
 *   → Registered as repo://my-library/{path}
 */

import path from 'node:path';
import fs from 'fs-extra';
import { RegistryManager } from '#src/core/registry.js';

/**
 * Register a local git repository in Diamond's registry.
 *
 * @param localPath  Path to the repository root (relative or absolute).
 * @param options.key  Optional identifier override. Defaults to the directory name.
 */
export async function addRepoCommand(localPath: string, options: { key?: string }) {
  const registry = new RegistryManager();
  await registry.init();

  // Resolve to an absolute path so the registry entry works regardless of
  // what directory Diamond is invoked from in the future.
  const absolutePath = path.resolve(localPath);

  // Validate that this is actually a git repo before registering it.
  // The `.git` directory is the canonical indicator — we don't attempt to
  // support bare repositories (no working tree) at this stage.
  if (!(await fs.pathExists(path.join(absolutePath, '.git')))) {
    throw new Error(`The directory '${absolutePath}' is not a git repository.`);
  }

  // If no key is provided, use the directory name as a sensible default.
  // e.g. registering `/Users/sf/work/my-library` → id "my-library"
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

  console.warn(`\nSuccess! Repository '${repoId}' is now tracked in the registry.`);
  console.warn(`Local Path: ${absolutePath}`);
}
