/**
 * Diamond structured logger — root logger factory and singleton accessor.
 *
 * Architecture:
 *   - One root logger is created at process start via `initLogger()`.
 *   - All modules call `getLogger()` to get it, then create child loggers
 *     with `logger.child({ component: 'layer:ClassName' })`.
 *   - Writes to two destinations simultaneously via pino.multistream:
 *       1. stderr (fd 2) — safe for both CLI and MCP stdio protocol.
 *       2. JSONL log file — inspectable with `jq`, pipeable to logstash.
 *
 * Default log file: ~/.local/share/diamond/logs/diamond.log
 * Overrides (highest priority first):
 *   1. `logFile` argument to `initLogger()`
 *   2. `DIAMOND_LOG_FILE` env var
 *   3. Default path above
 *
 * Usage in each module:
 *   const log = getLogger().child({ component: 'crawler:CrawlerService' });
 *
 * Inspecting logs:
 *   tail -f ~/.local/share/diamond/logs/diamond.log | pino-pretty
 *   cat ~/.local/share/diamond/logs/diamond.log | jq 'select(.correlationId == "abc")'
 */

import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { Env } from '#src/core/env.js';

let _logger: pino.Logger | null = null;

/**
 * Initialize the root logger. Call once at process start before any other
 * module uses `getLogger()`. Safe to call again — replaces the singleton.
 *
 * @param level   Pino log level string. Default 'info'. 'trace' for --verbose.
 * @param logFile Absolute path for the JSONL log file. Falls back to env var
 *                or the default XDG data dir path.
 */
export function initLogger(level = 'info', logFile?: string): pino.Logger {
  const filePath = logFile ?? process.env.DIAMOND_LOG_FILE ?? path.join(Env.dataDir, 'logs', 'diamond.log');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const streams = pino.multistream([
    { stream: pino.destination(2) }, // stderr — safe for MCP stdio protocol
    { stream: pino.destination(filePath) }, // JSONL file (append mode)
  ]);

  _logger = pino(
    {
      level,
      base: { name: 'diamond' },
      // Serialize Error objects as { message, stack } instead of '{}'
      serializers: { err: pino.stdSerializers.err },
    },
    streams,
  );

  return _logger;
}

/**
 * Return the singleton root logger, initializing with defaults if needed.
 *
 * Every module that wants structured logging should call this and then
 * create a child logger scoped to that module:
 *
 *   const log = getLogger().child({ component: 'core:RegistryManager' });
 */
export function getLogger(): pino.Logger {
  if (!_logger) _logger = initLogger();
  return _logger;
}

export type { Logger } from 'pino';
