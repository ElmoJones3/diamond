import fs from 'fs-extra';
import path from 'node:path';
import * as z from 'zod';

import { ResourceTemplate, McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { syncCommand } from '../cli/sync.js';
import { RegistryManager } from '../core/registry.js';
import { SearchService } from '../core/search.js';
import { StorageManager } from '../core/storage.js';

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
        description: 'Sync documentation for a library to the registry',
        inputSchema: {
          lib: z.string().describe('The identifier for the library'),
          url: z.string().describe('The documentation URL'),
          recursive: z.boolean().optional().default(true),
          limit: z.number().optional().describe('Optional limit on number of pages'),
        },
      },
      async ({ lib, url, recursive, limit }) => {
        await syncCommand(url, { key: lib, recursive, limit });
        return { content: [{ type: 'text' as const, text: `Successfully synced ${lib}` }] };
      },
    );

    this.mcp.registerTool(
      'search_library',
      {
        description: 'Search a library documentation for specific concepts',
        inputSchema: {
          lib: z.string().describe('The library ID'),
          query: z.string().describe('The search query'),
          version: z.string().optional().default('latest'),
        },
      },
      async ({ lib, query, version }) => {
        await this.registry.init();
        const results = await this.search.search(lib, version || 'latest', query);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                results.map((r) => ({
                  title: r.title,
                  uri: `docs://${lib}/${version || 'latest'}/${r.id}`,
                  score: r.score,
                })),
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    this.mcp.registerTool(
      'list_registry',
      { description: 'List all libraries and repositories in the Diamond registry' },
      async () => {
        await this.registry.init();
        const entries = this.registry.listEntries();
        return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
      },
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    console.error('Diamond MCP Server running on stdio');
  }
}
