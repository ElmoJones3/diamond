/**
 * Diamond MCP Server
 *
 * This file wires Diamond up as a Model Context Protocol (MCP) server — the
 * standard way for AI assistants (like Claude) to reach beyond their training
 * data and interact with live tools and resources.
 */

import http from 'node:http';
import path from 'node:path';
import { ResourceTemplate, McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import fs from 'fs-extra';
import * as z from 'zod';

import { removeCommand } from '#src/cli/remove.js';
import { syncCommand } from '#src/cli/sync.js';
import { Env } from '#src/core/env.js';
import { RegistryManager } from '#src/core/registry.js';
import { SearchService } from '#src/core/search.js';
import { StorageManager } from '#src/core/storage.js';
import { getLogger } from '#src/logger.js';

export class McpServer {
  private mcp: SdkMcpServer;
  private registry = new RegistryManager();
  private storage = new StorageManager();
  private search = new SearchService();

  constructor() {
    this.mcp = new SdkMcpServer({ name: 'diamond', version: '1.0.0' }, { capabilities: { resources: {}, tools: {} } });

    this.setupResources();
    this.setupTools();
  }

  private setupResources() {
    const listDocs = async () => {
      await this.registry.init();
      const entries = this.registry.listEntries().filter((e) => e.type === 'docs');
      return {
        resources: entries.map((e) => ({
          uri: `docs://${e.id}/latest`,
          name: `${e.name} Documentation (Latest)`,
          mimeType: 'text/markdown',
        })),
      };
    };

    const listRepos = async () => {
      await this.registry.init();
      const entries = this.registry.listEntries().filter((e) => e.type === 'repo');
      return {
        resources: entries.map((e) => ({
          uri: `repo://${e.id}`,
          name: `${e.name} Repository`,
          mimeType: 'text/plain',
        })),
      };
    };

    const readDocs = async (uri: URL, variables: Record<string, string | string[]>) => {
      const libId = String(variables.lib ?? '');
      const version = String(variables.version ?? 'latest');
      const pathPart = Array.isArray(variables.path) ? variables.path.join('/') : String(variables.path ?? '');
      const filePath = path.join(this.storage.getLibPath(libId, version), ...pathPart.split('/').filter(Boolean));

      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          contents: [{ uri: uri.toString(), mimeType: 'text/markdown', text: content }],
        };
      }
      throw new Error(`Resource not found: ${uri.toString()}`);
    };

    const readRepo = async (uri: URL, variables: Record<string, string | string[]>) => {
      const repoId = String(variables.repo ?? '');
      const pathPart = Array.isArray(variables.path) ? variables.path.join('/') : String(variables.path ?? '');
      const entry = this.registry.getEntry(repoId);
      if (entry?.type === 'repo') {
        const filePath = path.join(entry.localPath, ...pathPart.split('/').filter(Boolean));
        if (await fs.pathExists(filePath)) {
          const content = await fs.readFile(filePath, 'utf-8');
          return {
            contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: content }],
          };
        }
      }
      throw new Error(`Resource not found: ${uri.toString()}`);
    };

    this.mcp.registerResource(
      'Documentation Page',
      new ResourceTemplate('docs://{lib}/{version}/{+path}', { list: listDocs }),
      { description: 'Read a specific documentation page (Markdown)', mimeType: 'text/markdown' },
      readDocs,
    );

    this.mcp.registerResource(
      'Repository File',
      new ResourceTemplate('repo://{repo}/{+path}', { list: listRepos }),
      { description: 'Read a specific file from a local repository', mimeType: 'text/plain' },
      readRepo,
    );
  }

  private setupTools() {
    this.mcp.registerTool(
      'sync_docs',
      {
        description: 'Crawl and store documentation for a library.',
        inputSchema: {
          lib: z.string().describe('A short, unique identifier for the library'),
          url: z.string().describe('The root URL of the documentation site to crawl'),
          recursive: z.boolean().optional().default(true),
          limit: z.number().optional(),
          description: z.string().optional(),
          version: z.string().optional(),
          ignoreRobots: z.boolean().optional().describe('Ignore robots.txt restrictions (for personal offline use)'),
        },
      },
      async ({ lib, url, recursive, limit, description, version, ignoreRobots }) => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'sync_docs', correlationId, lib, url }, 'mcp:tool_call');
        await syncCommand(url, { key: lib, recursive, limit, description, version, ignoreRobots });
        log.info({ tool: 'sync_docs', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return { content: [{ type: 'text' as const, text: `Successfully synced ${lib}` }] };
      },
    );

    this.mcp.registerTool(
      'search_library',
      {
        description:
          "Full-text keyword search across a library's stored documentation. " +
          'This is the primary and recommended search interface — use it for most queries. ' +
          'Keyword search (MiniSearch) is always available immediately after a sync_docs call.',
        inputSchema: {
          lib: z.string().describe('The library id to search'),
          query: z.string().describe('Keywords to search for'),
          version: z.string().optional().default('latest'),
        },
      },
      async ({ lib, query, version }) => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'search_library', correlationId, lib, query }, 'mcp:tool_call');
        await this.registry.init();
        const entry = this.registry.getEntry(lib);
        const results = await this.search.search(lib, version || 'latest', query);
        log.info({ tool: 'search_library', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                results.map((r) => {
                  const isRepo = entry?.type === 'repo';
                  const uri = isRepo ? `repo://${lib}/${r.id}` : `docs://${lib}/${version || 'latest'}/${r.id}`;
                  return { title: r.title, uri, score: r.score };
                }),
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    this.mcp.registerTool(
      'remove_library',
      {
        description: 'Remove a library or repository from the Diamond registry.',
        inputSchema: { id: z.string().describe('The registry id to remove') },
      },
      async ({ id }) => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'remove_library', correlationId, id }, 'mcp:tool_call');
        await removeCommand(id);
        log.info({ tool: 'remove_library', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return { content: [{ type: 'text' as const, text: `Successfully removed "${id}" from registry` }] };
      },
    );

    this.mcp.registerTool(
      'describe_library',
      {
        description: 'Set or update the description for a library or repository.',
        inputSchema: {
          id: z.string().describe('The registry id to update'),
          description: z.string().describe('The description to set'),
        },
      },
      async ({ id, description }) => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'describe_library', correlationId, id }, 'mcp:tool_call');
        await this.registry.init();
        const entry = this.registry.getEntry(id);
        if (!entry) throw new Error(`No registry entry found with id "${id}"`);
        await this.registry.addEntry({ ...entry, description });
        log.info({ tool: 'describe_library', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return { content: [{ type: 'text' as const, text: `Updated description for "${id}"` }] };
      },
    );

    this.mcp.registerTool(
      'list_repo_files',
      {
        description: 'List files in a registered repository.',
        inputSchema: {
          id: z.string().describe('The repository id from the registry'),
          path: z.string().optional().describe('Subdirectory to list'),
        },
      },
      async ({ id, path: subPath }) => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'list_repo_files', correlationId, id }, 'mcp:tool_call');
        await this.registry.init();
        const entry = this.registry.getEntry(id);
        if (entry?.type !== 'repo') throw new Error(`No repo entry found with id "${id}"`);

        const root = subPath ? path.join(entry.localPath, subPath) : entry.localPath;
        const files: string[] = [];
        await this.walkRepo(root, entry.localPath, files);
        files.sort();

        const results = files.map((f) => ({ path: f, uri: `repo://${id}/${f}` }));
        log.info({ tool: 'list_repo_files', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
      },
    );

    this.mcp.registerTool(
      'list_registry',
      {
        description: 'List all libraries and repositories tracked by Diamond.',
      },
      async () => {
        const log = getLogger().child({ component: 'mcp:server' });
        const correlationId = crypto.randomUUID();
        const startTime = Date.now();
        log.info({ tool: 'list_registry', correlationId }, 'mcp:tool_call');
        await this.registry.init();
        const entries = this.registry.listEntries();
        log.info({ tool: 'list_registry', correlationId, duration_ms: Date.now() - startTime }, 'mcp:tool_result');
        return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
      },
    );
  }

  async run() {
    const log = getLogger().child({ component: 'mcp:server' });
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    log.debug('mcp:ready');
  }

  async runHttp(port: number) {
    const log = getLogger().child({ component: 'mcp:server' });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await this.mcp.connect(transport);

    const httpServer = http.createServer((req, res) => {
      if (req.url === '/mcp') {
        transport.handleRequest(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.on('error', reject);
      httpServer.listen(port, '127.0.0.1', resolve);
    });

    await fs.ensureDir(path.dirname(Env.serverStatePath));
    await fs.writeJson(Env.serverStatePath, { pid: process.pid, port, startedAt: new Date().toISOString() });

    log.info({ port }, 'mcp:http_ready');
    process.stderr.write(`Diamond MCP server running on http://127.0.0.1:${port}/mcp\n`);

    const cleanup = async () => {
      await fs.remove(Env.serverStatePath).catch(() => {});
      await transport.close();
      httpServer.close();
      process.exit(0);
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
  }

  private async walkRepo(dir: string, localPath: string, files: string[]) {
    const IGNORED = new Set(['.git', 'node_modules', 'dist', '.next', '.nuxt', '__pycache__', '.venv']);
    const IGNORED_EXTS = new Set([
      '.lock',
      '.log',
      '.map',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.ico',
      '.woff',
      '.woff2',
      '.ttf',
    ]);

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (IGNORED.has(ent.name)) continue;
      if (ent.name.startsWith('.') && ent.isDirectory()) continue;

      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await this.walkRepo(full, localPath, files);
      } else if (ent.isFile()) {
        if (!IGNORED_EXTS.has(path.extname(ent.name))) {
          files.push(path.relative(localPath, full));
        }
      }
    }
  }
}
