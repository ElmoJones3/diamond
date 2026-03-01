/**
 * install command — register Diamond as an MCP server in AI coding tools.
 *
 * Writes the Diamond MCP server entry into the config files for:
 *   - Claude Code  (~/.claude.json, user-scope mcpServers)
 *   - Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json)
 *   - Cursor (~/.cursor/mcp.json)
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

/**
 * Claude Code — user-scope MCP server stored in ~/.claude.json.
 *
 * Claude Code reads a top-level `mcpServers` map from ~/.claude.json for
 * servers that should be available across all projects (user scope).
 */
function installClaudeCode(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.claude.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

/**
 * Claude Desktop — standard MCP host config.
 *
 * macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * Linux: ~/.config/Claude/claude_desktop_config.json
 * Windows: %APPDATA%\Claude\claude_desktop_config.json
 *
 * Claude Desktop must be fully quit and restarted after editing this file.
 */
function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? os.homedir(), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  // Linux / other
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

/**
 * Cursor — MCP host config at ~/.cursor/mcp.json.
 *
 * Cursor reads this file on startup. Restart Cursor (or reload MCP servers
 * via the command palette) after editing.
 */
function installCursor(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
  return configPath;
}

/**
 * Gemini CLI — MCP host config at ~/.gemini/settings.json.
 */
function installGemini(entry: McpServerEntry): string {
  const configPath = path.join(os.homedir(), '.gemini', 'settings.json');
  const config = readJson(configPath);

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.diamond = entry;
  config.mcpServers = servers;

  writeJson(configPath, config);
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
];

// ─── Main export ──────────────────────────────────────────────────────────────

export async function installCommand(options: { targets: string[] }) {
  const diamondBin = resolveDiamondBin();
  const entry: McpServerEntry = { command: diamondBin, args: ['serve'] };

  // If the user passed specific --target flags, filter to just those.
  // Otherwise install into all known targets.
  const activeTargets = options.targets.length > 0 ? TARGETS.filter((t) => options.targets.includes(t.flag)) : TARGETS;

  console.warn(`\nDiamond install — binary: ${diamondBin}\n`);

  if (diamondBin.includes('/.nvm/versions/') || diamondBin.includes('/.fnm/node-versions/')) {
    console.warn('  ⚠  Binary is inside an nvm/fnm versioned path. If you switch Node versions, re-run `diamond install` to update the entry.\n');
  }

  for (const target of activeTargets) {
    try {
      const configPath = target.install(entry);
      console.warn(`  ✓  ${target.name}`);
      console.warn(`     Written to: ${configPath}`);
      if (target.restartNote) {
        console.warn(`     Note: ${target.restartNote}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗  ${target.name} — failed: ${msg}`);
    }
    console.warn('');
  }

  console.warn('Done. Diamond MCP server entry:');
  console.warn(`  command: ${entry.command}`);
  console.warn(`  args:    ${entry.args.join(' ')}`);
}
