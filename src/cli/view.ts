import path from 'node:path';
import fs from 'fs-extra';
import { isProcessAlive, type ServerState } from '#src/cli/serve.js';
import { Env } from '#src/core/env.js';

function formatUptime(startedAt: string): string {
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export async function viewServerCommand(): Promise<void> {
  if (!(await fs.pathExists(Env.serverStatePath))) {
    process.stderr.write('No server is running. Start one with: diamond serve --bg\n');
    process.exit(1);
  }

  const state: ServerState = await fs.readJson(Env.serverStatePath);

  if (!isProcessAlive(state.pid)) {
    process.stderr.write(`Server is not running (stale state, PID ${state.pid}).\n`);
    process.stderr.write('Start one with: diamond serve --bg\n');
    process.exit(1);
  }

  process.stdout.write('Diamond MCP Server\n');
  process.stdout.write(`  PID:    ${state.pid}\n`);
  process.stdout.write(`  Port:   ${state.port}\n`);
  process.stdout.write(`  Uptime: ${formatUptime(state.startedAt)}\n`);
  process.stdout.write(`  URL:    http://127.0.0.1:${state.port}/mcp\n`);
  process.stdout.write('\nTailing logs (Ctrl-C to exit)...\n\n');

  const logPath = path.join(Env.dataDir, 'logs', 'diamond.log');

  if (!(await fs.pathExists(logPath))) {
    process.stderr.write('Log file not found.\n');
    process.exit(1);
  }

  let offset = (await fs.stat(logPath)).size;

  async function readNewContent() {
    const { size } = await fs.stat(logPath);
    if (size > offset) {
      const chunk = Buffer.alloc(size - offset);
      const fd = await fs.open(logPath, 'r');
      await fs.read(fd, chunk, 0, chunk.length, offset);
      await fs.close(fd);
      process.stdout.write(chunk);
      offset = size;
    }
  }

  const watcher = fs.watch(logPath, () => {
    readNewContent().catch(() => {});
  });

  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
}
