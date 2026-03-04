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
import { SearchService } from '#src/core/search.js';
import { getLogger } from '#src/logger.js';

/**
 * Register a local git repository in Diamond's registry.
 *
 * @param localPath  Path to the repository root (relative or absolute).
 * @param options.key  Optional identifier override. Defaults to the directory name.
 */
export async function addRepoCommand(localPath: string, options: { key?: string; description?: string }) {
  const log = getLogger().child({ component: 'cli:repo' });
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
    description: options.description,
    config: {
      syncStrategy: 'git',
      autoPull: true,
    },
    syncedAt: new Date().toISOString(),
  });

  log.info({ repoId, localPath: absolutePath }, 'repo:registered');

  const search = new SearchService();
  log.info({ repoId }, 'repo:indexing');
  await search.indexRepo(repoId, absolutePath);

  log.info({ repoId, localPath: absolutePath }, 'repo:complete');
}
