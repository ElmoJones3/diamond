/**
 * Diamond MCP Server
 *
 * This file wires Diamond up as a Model Context Protocol (MCP) server — the
 * standard way for AI assistants (like Claude) to reach beyond their training
 * data and interact with live tools and resources.
 *
 * MCP has two main primitives:
 *
 *   • Resources — addressable content an AI can read, similar to files or URLs.
 *     Diamond exposes two resource namespaces:
 *       - `docs://{lib}/{version}/{path}` — Markdown documentation pages that
 *         were crawled and stored locally.
 *       - `repo://{repo}/{path}` — files from locally indexed git repositories.
 *
 *   • Tools — functions an AI can call to perform actions or retrieve data.
 *     Diamond exposes three tools:
 *       - `sync_docs`      — crawl & store a library's documentation.
 *       - `search_library` — full-text search across a library's docs.
 *       - `list_registry`  — enumerate everything Diamond knows about.
 *
 * Transport: the server speaks over stdio (stdin/stdout), which is the most
 * common MCP transport. The host process (e.g. Claude Desktop) spawns Diamond
 * as a child process and communicates through JSON-RPC messages on those pipes.
 */

import path from 'node:path';
import { ResourceTemplate, McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'fs-extra';
import * as z from 'zod';

import { syncCommand } from '#src/cli/sync.js';
import { type RegistryEntry, RegistryManager } from '#src/core/registry.js';
import { type DiamondSearchResult, SearchService } from '#src/core/search.js';
import { StorageManager } from '#src/core/storage.js';

export class McpServer {
  private mcp: SdkMcpServer;

  // The registry is Diamond's source of truth: a JSON manifest that tracks
  // every library and repository Diamond has ever synced.
  private registry = new RegistryManager();

  // The storage manager handles the on-disk layout — versioned directories,
  // hardlinks into the CAS (content-addressable store), and `latest` symlinks.
  private storage = new StorageManager();

  // The search service builds and queries MiniSearch indices so the AI can
  // do keyword lookups without reading every file.
  private search = new SearchService();

  constructor() {
    this.mcp = new SdkMcpServer(
      { name: 'diamond', version: '1.0.0' },
      // Declare capabilities up-front so MCP clients know what to expect.
      { capabilities: { resources: {}, tools: {} } },
    );

    this.setupResources();
    this.setupTools();
  }

  // ---------------------------------------------------------------------------
  // Resources
  //
  // Resources are read-only content that an AI can pull into its context.
  // Each resource is addressed by a URI scheme that Diamond defines.
  //
  // The `list` callback lets clients discover what's available (like a
  // directory listing). The `read` callback fetches the actual content.
  // ---------------------------------------------------------------------------

  private setupResources() {
    // -- List helpers ----------------------------------------------------------
    // These run when a client asks "what resources exist?" and filter the
    // registry by type so docs and repos get separate namespace listings.

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

    // -- Read helpers ----------------------------------------------------------
    // These run when a client resolves a specific URI to its content.
    // The URI template variables (lib, version, path) are extracted by the SDK
    // and passed in as `variables`.

    /**
     * Serve a single documentation page from Diamond's local storage.
     *
     * URI pattern: docs://{lib}/{version}/{+path}
     *   lib     — the library id, e.g. "msw"
     *   version — "latest" or a semver string like "2.12.10"
     *   path    — the relative path to the Markdown file, e.g. "api/handlers"
     *
     * The `{+path}` syntax means the path segment is allowed to contain
     * slashes, so deep pages like `api/network/http` work correctly.
     */
    const readDocs = async (uri: URL, variables: Record<string, string | string[]>) => {
      const libId = String(variables.lib ?? '');
      const version = String(variables.version ?? 'latest');

      // `path` may arrive as an array when the template has multiple slashes —
      // join them back into a single string before splitting on `/`.
      const pathPart = Array.isArray(variables.path) ? variables.path.join('/') : String(variables.path ?? '');

      // StorageManager knows where Diamond keeps versioned docs on disk.
      // The `.filter(Boolean)` strips empty segments from a leading slash.
      const filePath = path.join(this.storage.getLibPath(libId, version), ...pathPart.split('/').filter(Boolean));

      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          contents: [{ uri: uri.toString(), mimeType: 'text/markdown', text: content }],
        };
      }

      throw new Error(`Resource not found: ${uri.toString()}`);
    };

    /**
     * Serve a file from a locally indexed git repository.
     *
     * URI pattern: repo://{repo}/{+path}
     *   repo — the repository id from the registry, e.g. "diamond-core"
     *   path — the file path relative to the repo root, e.g. "src/index.ts"
     *
     * Unlike docs, repos are reference-only: Diamond just points at the
     * actual checkout on disk and reads from it directly. No copying needed.
     */
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

    // -- Register resources with the MCP SDK -----------------------------------
    // ResourceTemplate accepts a URI pattern and a `list` callback. The SDK
    // uses the pattern to match incoming URIs and extract template variables.

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

  // ---------------------------------------------------------------------------
  // Tools
  //
  // Tools are callable functions — the AI can invoke them to take actions or
  // fetch data that wouldn't fit neatly into a static resource URI.
  //
  // Each tool declares an `inputSchema` (Zod-based) that the MCP host uses to
  // validate arguments before they reach the handler. This also powers
  // auto-generated UI in clients like Claude Desktop.
  // ---------------------------------------------------------------------------

  private setupTools() {
    /**
     * sync_docs — crawl a library's documentation site and store it locally.
     *
     * This is how Diamond learns about a new library. It fires up the Playwright
     * crawler, walks the docs site, converts HTML → Markdown, hashes each page
     * into the CAS, and updates the registry. Subsequent reads can then be
     * served entirely from disk — no network required.
     *
     * Example call:
     *   sync_docs({ lib: "msw", url: "https://mswjs.io/docs", recursive: true })
     */
    this.mcp.registerTool(
      'sync_docs',
      {
        description:
          'Crawl and store documentation for a library. ' +
          'Run this once (or when docs go stale) before searching or reading. ' +
          'Subsequent reads are served from local storage — no network needed.',
        inputSchema: {
          lib: z.string().describe('A short, unique identifier for the library (e.g. "msw", "zod", "react")'),
          url: z.string().describe('The root URL of the documentation site to crawl'),
          recursive: z
            .boolean()
            .optional()
            .default(true)
            .describe('Follow links to sub-pages (recommended). Set false to only fetch the root page.'),
          limit: z
            .number()
            .optional()
            .describe('Cap the number of pages crawled — useful for large doc sites during testing'),
        },
      },
      async ({ lib, url, recursive, limit }) => {
        await syncCommand(url, { key: lib, recursive, limit });
        return { content: [{ type: 'text' as const, text: `Successfully synced ${lib}` }] };
      },
    );

    /**
     * search_library — full-text search across a library's stored documentation.
     *
     * Uses MiniSearch under the hood: an in-process, zero-dependency search
     * engine. The index is built at sync time and persisted as JSON alongside
     * the Markdown files, so lookups are fast and fully offline.
     *
     * Search options include prefix matching and fuzzy matching (±20% edit
     * distance), with title matches boosted 2× over body content. Results are
     * returned as URI references so the AI can fetch the full page if needed.
     *
     * Example call:
     *   search_library({ lib: "msw", query: "request handlers", version: "latest" })
     */
    this.mcp.registerTool(
      'search_library',
      {
        description:
          "Full-text search across a library's stored documentation. " +
          'Returns matching page titles and their `docs://` URIs ranked by relevance. ' +
          'Use this to discover which pages to read before fetching full content.',
        inputSchema: {
          lib: z.string().describe('The library id to search (must have been synced first)'),
          query: z.string().describe('Keywords or a short phrase to search for'),
          version: z
            .string()
            .optional()
            .default('latest')
            .describe('The version to search. Defaults to "latest" (the most recently synced version)'),
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
                  // Hand back a fully-qualified docs:// URI so the AI can
                  // immediately use it with the Documentation Page resource.
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

    /**
     * list_registry — enumerate everything Diamond currently knows about.
     *
     * Returns the full registry manifest as pretty-printed JSON. Each entry is
     * either a `docs` library (with version history) or a `repo` (with a local
     * path). This is a good first call to orient the AI before deciding which
     * library to search or which resource URI to resolve.
     */
    this.mcp.registerTool(
      'list_registry',
      {
        description:
          'List all libraries and repositories tracked by Diamond. ' +
          "Call this first to see what's available before searching or reading docs.",
      },
      async () => {
        await this.registry.init();
        const entries = this.registry.listEntries();
        return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------

  /**
   * Connect the server to its stdio transport and start handling requests.
   *
   * The MCP host (e.g. Claude Desktop) expects the server process to be ready
   * as soon as it starts. `connect()` sets up the JSON-RPC message loop and
   * blocks until the transport closes (i.e. the host kills the process).
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    console.error('Diamond MCP Server running on stdio');
  }
}
