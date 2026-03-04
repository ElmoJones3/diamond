/**
 * WatcherService — live indexing for local repositories.
 *
 * This service monitors the local filesystem for changes in any registered
 * 'repo' entries. When a file is added, changed, or deleted, the service
 * triggers an incremental update of the search index.
 *
 * Why use a watcher?
 *   - "Live" AI context: If you're developing a library and want your AI
 *     assistant to know about the new function you just added, you shouldn't
 *     have to run a manual `sync` command.
 *   - Efficiency: `chokidar` uses OS-native events (like FSEvents on macOS or
 *     inotify on Linux) to detect changes without polling the disk.
 *
 * Lifecycle:
 *   1. The watcher is started by the `diamond watch` CLI command.
 *   2. It loads all `repo` entries from the registry.
 *   3. It sets up a single `chokidar` instance to watch all repo roots.
 *   4. On change, it identifies which repo the file belongs to and calls
 *      `SearchService.updateRepoFile()` for an incremental re-index.
 */

import { type FSWatcher, watch } from 'chokidar';
import { RegistryManager } from '#src/core/registry.js';
import { SearchService } from '#src/core/search.js';
import { getLogger } from '#src/logger.js';

export class WatcherService {
  private watcher: FSWatcher | null = null;
  private registry = new RegistryManager();
  private search = new SearchService();

  /**
   * Start watching all registered repositories.
   */
  async start() {
    const log = getLogger().child({ component: 'core:WatcherService' });

    await this.registry.init();
    const repos = this.registry.listEntries().filter((e) => e.type === 'repo');

    if (repos.length === 0) {
      log.warn('watcher:no_repos');
      return;
    }

    const paths = repos.map((r) => r.localPath);
    log.info({ repoCount: repos.length, paths }, 'watcher:start');

    this.watcher = watch(paths, {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.cache/**'],
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher
      .on('add', (filePath) => this.handleChange(filePath, 'add'))
      .on('change', (filePath) => this.handleChange(filePath, 'change'))
      .on('unlink', (filePath) => this.handleChange(filePath, 'unlink'));

    log.info('watcher:active');
  }

  private async handleChange(filePath: string, type: 'add' | 'change' | 'unlink') {
    const log = getLogger().child({ component: 'core:WatcherService' });
    const entries = this.registry.listEntries().filter((e) => e.type === 'repo');
    const repo = entries.find((e) => filePath.startsWith(e.localPath));

    if (!repo) return;

    log.debug({ event: type, path: filePath, repoId: repo.id }, 'watcher:change');

    try {
      await this.search.updateRepoFile(repo.id, repo.localPath, filePath, type);
    } catch (e) {
      log.error({ err: e, filePath }, 'watcher:update_fail');
    }
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
