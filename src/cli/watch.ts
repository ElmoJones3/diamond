/**
 * watch command — start the live repository indexer.
 *
 * This command keeps a long-running process that watches all registered
 * local repositories for file changes and updates their search indices
 * in real-time.
 */

import { WatcherService } from '#src/core/watcher.js';

/**
 * Start the live repository watcher.
 */
export async function watchCommand(): Promise<void> {
  const watcher = new WatcherService();

  try {
    await watcher.start();

    // Keep process alive
    process.on('SIGINT', async () => {
      await watcher.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await watcher.stop();
      process.exit(0);
    });
  } catch (e) {
    console.error('Fatal error in watcher:', e);
    await watcher.stop();
    process.exit(1);
  }
}
