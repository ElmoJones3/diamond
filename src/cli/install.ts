/**
 * install command — register Diamond as an MCP server in AI coding tools.
 *
 * Writes the Diamond MCP server entry into the config files for:
 *   - Claude Code  (~/.claude.json, user-scope mcpServers)
 *   - Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json)
 *   - Cursor (~/.cursor/mcp.json)
 *   - Codex (~/.codex/config.toml)
 *
 * Each target is attempted independently — a failure for one doesn't block
 * the others. The command reports success/skip/failure for each target.
 *
 * The server entry uses the absolute path to the `diamond` binary (resolved
 * via `which`), falling back to the bare command name if which isn't available.
 * Absolute paths are more reliable because MCP hosts often launch servers with
 * a minimal PATH that doesn't include the user's shell PATH.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLogger } from '#src/logger.js';

type McpServerEntry = {
  command: string;
  args: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDiamondBin(): string {
  try {
    const resolved = execSync('which diamond', { encoding: 'utf8' }).trim();
    if (resolved) return resolved;
  } catch {
    // `which` not available or diamond not in PATH
  }
  return 'diamond';
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ─── Per-target installers ────────────────────────────────────────────────────

function installClaudeCode(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.claude.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'Claude',
    'claude_desktop_config.json',
  );
}

function installClaudeDesktop(entry: McpServerEntry): string {
  const configPath = claudeDesktopConfigPath();
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

function installCursor(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

function installGemini(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.gemini', 'settings.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map((v) => formatTomlString(v)).join(', ')}]`;
}

function upsertCodexMcpServer(configText: string, name: string, entry: McpServerEntry): string {
  const header = `[mcp_servers.${name}]`;
  const sectionLines = [
    header,
    `command = ${formatTomlString(entry.command)}`,
    `args = ${formatTomlStringArray(entry.args)}`,
  ];
  const section = sectionLines.join('\n');

  const lines = configText.split('\n');
  const start = lines.findIndex((line) => line.trim() === header);

  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !lines[end]?.trim().startsWith('[')) end += 1;
    lines.splice(start, end - start, ...sectionLines);
    return `${lines.join('\n').replace(/\s+$/, '')}\n`;
  }

  const trimmed = configText.replace(/\s+$/, '');
  if (!trimmed) return `${section}\n`;
  return `${trimmed}\n\n${section}\n`;
}

function installCodex(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const updated = upsertCodexMcpServer(existing, 'diamond', entry);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, updated, 'utf8');
  return configPath;
}

// ─── Target registry ─────────────────────────────────────────────────────────

type Target = {
  name: string;
  flag: string;
  install: (entry: McpServerEntry) => string;
  restartNote?: string;
};

const TARGETS: Target[] = [
  {
    name: 'Claude Code',
    flag: 'claude-code',
    install: installClaudeCode,
  },
  {
    name: 'Claude Desktop',
    flag: 'claude-desktop',
    install: installClaudeDesktop,
    restartNote: 'Fully quit and reopen Claude Desktop to load the new server.',
  },
  {
    name: 'Cursor',
    flag: 'cursor',
    install: installCursor,
    restartNote: 'Restart Cursor or reload MCP servers via the command palette.',
  },
  {
    name: 'Gemini CLI',
    flag: 'gemini-cli',
    install: installGemini,
    restartNote: 'New sessions will automatically include the Diamond MCP server.',
  },
  {
    name: 'Codex',
    flag: 'codex',
    install: installCodex,
    restartNote: 'Restart Codex or open a new session to load the new MCP server.',
  },
];

// ─── Main export ──────────────────────────────────────────────────────────────

export async function installCommand(options: { targets: string[] }) {
  const log = getLogger().child({ component: 'cli:install' });
  const diamondBin = resolveDiamondBin();
  const entry: McpServerEntry = { command: diamondBin, args: ['mcp'] };

  const activeTargets = options.targets.length > 0 ? TARGETS.filter((t) => options.targets.includes(t.flag)) : TARGETS;

  log.info({ diamondBin, targets: activeTargets.map((t) => t.flag) }, 'install:start');

  if (diamondBin.includes('/.nvm/versions/') || diamondBin.includes('/.fnm/node-versions/')) {
    log.warn({ diamondBin }, 'install:versioned_path');
    process.stderr.write(
      '  ⚠  Binary is inside an nvm/fnm versioned path. If you switch Node versions, re-run `diamond install` to update the entry.\n\n',
    );
  }

  for (const target of activeTargets) {
    try {
      const configPath = target.install(entry);
      log.info({ target: target.flag, configPath }, 'install:target_ok');
      process.stderr.write(`  ✓  ${target.name}\n`);
      process.stderr.write(`     Written to: ${configPath}\n`);
      if (target.restartNote) {
        process.stderr.write(`     Note: ${target.restartNote}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ target: target.flag, err }, 'install:target_fail');
      process.stderr.write(`  ✗  ${target.name} — failed: ${msg}\n`);
    }
    process.stderr.write('\n');
  }

  log.info({ diamondBin }, 'install:complete');
}
