/**
 * watch command — start the live repository indexer.
 *
 * This command keeps a long-running process that watches all registered
 * local repositories for file changes and updates their search indices
 * in real-time.
 */

import { WatcherService } from '#src/core/watcher.js';
import { getLogger } from '#src/logger.js';

/**
 * Start the live repository watcher.
 */
export async function watchCommand(): Promise<void> {
  const log = getLogger().child({ component: 'cli:watch' });
  const watcher = new WatcherService();

  try {
    await watcher.start();

    process.on('SIGINT', async () => {
      log.info('watch:stopping');
      await watcher.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('watch:stopping');
      await watcher.stop();
      process.exit(0);
    });
  } catch (e) {
    log.error({ err: e }, 'Fatal error in watcher');
    await watcher.stop();
    process.exit(1);
  }
}
