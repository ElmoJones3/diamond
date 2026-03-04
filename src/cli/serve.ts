import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { Env } from '#src/core/env.js';
import { McpServer } from '#src/mcp/server.js';

export interface ServerState {
  pid: number;
  port: number;
  startedAt: string;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function serveCommand(options: { port: number; bg: boolean }): Promise<void> {
  const { port, bg } = options;

  if (bg) {
    if (await fs.pathExists(Env.serverStatePath)) {
      const state: ServerState = await fs.readJson(Env.serverStatePath);
      if (isProcessAlive(state.pid)) {
        process.stderr.write(`Server already running (PID ${state.pid}) on port ${state.port}.\n`);
        process.stderr.write(`Use 'diamond view server' to monitor it.\n`);
        process.exit(0);
      }
    }

    // Re-exec self without --bg so the child runs as a foreground server
    const args = process.argv.slice(1).filter((a) => a !== '--bg');
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();

    const pid = child.pid;
    if (pid === undefined) {
      process.stderr.write('Failed to start server: could not obtain child PID.\n');
      process.exit(1);
    }

    // Write state file from parent since we know the PID immediately
    await fs.ensureDir(path.dirname(Env.serverStatePath));
    await fs.writeJson(Env.serverStatePath, { pid, port, startedAt: new Date().toISOString() } satisfies ServerState);

    process.stdout.write(`Server started (PID ${pid}) on port ${port}\n`);
    process.stdout.write(`Use 'diamond view server' to monitor it.\n`);
    process.exit(0);
  }

  const server = new McpServer();
  await server.runHttp(port);
}
