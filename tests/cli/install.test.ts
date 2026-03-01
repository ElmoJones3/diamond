import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCommand } from '#src/cli/install.js';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('installCommand', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diamond-install-test-'));
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    (execSync as any).mockReturnValue('/usr/local/bin/diamond');
    
    // Silence console.warn for tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should install into Gemini CLI settings', async () => {
    const geminiDir = path.join(tmpHome, '.gemini');
    const settingsPath = path.join(geminiDir, 'settings.json');
    
    await installCommand({ targets: ['gemini-cli'] });
    
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.mcpServers.diamond).toEqual({
      command: '/usr/local/bin/diamond',
      args: ['serve']
    });
  });

  it('should install into Claude Code settings', async () => {
    const configPath = path.join(tmpHome, '.claude.json');
    
    await installCommand({ targets: ['claude-code'] });
    
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcpServers.diamond).toEqual({
      command: '/usr/local/bin/diamond',
      args: ['serve']
    });
  });

  it('should merge with existing settings', async () => {
    const geminiDir = path.join(tmpHome, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });
    const settingsPath = path.join(geminiDir, 'settings.json');
    
    const existingSettings = {
      mcpServers: {
        existing: { command: 'test', args: [] }
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existingSettings));
    
    await installCommand({ targets: ['gemini-cli'] });
    
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(settings.mcpServers.existing).toBeDefined();
    expect(settings.mcpServers.diamond).toBeDefined();
  });

  it('should install into multiple targets at once', async () => {
    await installCommand({ targets: ['gemini-cli', 'claude-code'] });
    
    expect(fs.existsSync(path.join(tmpHome, '.gemini', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.claude.json'))).toBe(true);
  });
});
